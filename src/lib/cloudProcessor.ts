import { supabase } from '@/integrations/supabase/client';
import type { GreenArea } from './greenDetection';
import type { ProcessingSettings, ProcessingProgress, ProgressCallback } from './videoProcessor';

interface CloudProcessingResult {
  success: boolean;
  outputPath?: string;
  downloadUrl?: string;
  processingTimeSeconds?: number;
  error?: string;
}

/**
 * Upload a file to Supabase storage and return the path
 */
async function uploadToStorage(
  bucket: string,
  file: File | Blob,
  filename: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(`Falha ao validar login: ${userError.message}`);
  }

  if (!user) {
    throw new Error('Faça login para usar o processamento na nuvem. Vá em /auth para entrar ou criar conta.');
  }

  const timestamp = Date.now();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  // IMPORTANT: storage RLS expects files to be stored under "<user_id>/..."
  const path = `${user.id}/${timestamp}_${safeName}`;

  // For progress tracking, we'd need XHR but Supabase SDK doesn't expose it
  // So we'll simulate progress based on file size
  const chunkSize = 1024 * 1024; // 1MB
  const totalChunks = Math.ceil(file.size / chunkSize);
  
  onProgress?.(10); // Starting upload

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
    });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  onProgress?.(100);
  return data.path;
}

/**
 * Process a video using the cloud edge function
 * This is much faster than browser-based processing
 */
export async function processVideoCloud(
  videoFile: File,
  templateFile: File | Blob,
  greenArea: GreenArea,
  settings: ProcessingSettings,
  videoId: string,
  onProgress: ProgressCallback
): Promise<Blob> {
  const startTime = Date.now();

  try {
    // Stage 1: Upload video
    onProgress({
      videoId,
      progress: 5,
      stage: 'loading',
      message: 'Enviando vídeo para a nuvem...',
    });

    const videoPath = await uploadToStorage('videos', videoFile, videoFile.name, (p) => {
      onProgress({
        videoId,
        progress: 5 + (p * 0.25), // 5-30%
        stage: 'loading',
        message: 'Enviando vídeo...',
      });
    });

    // Stage 2: Upload template
    onProgress({
      videoId,
      progress: 30,
      stage: 'loading',
      message: 'Enviando template...',
    });

    const templateName = templateFile instanceof File ? templateFile.name : 'template.png';
    const templatePath = await uploadToStorage('templates', templateFile, templateName, (p) => {
      onProgress({
        videoId,
        progress: 30 + (p * 0.1), // 30-40%
        stage: 'loading',
        message: 'Enviando template...',
      });
    });

    // Stage 3: Call processing edge function
    onProgress({
      videoId,
      progress: 40,
      stage: 'processing',
      message: 'Processando na nuvem (FFmpeg)...',
    });

    const outputFilename = `${Date.now()}_${videoFile.name.replace(/\.[^/.]+$/, '')}_processed.mp4`;

    const { data, error } = await supabase.functions.invoke<CloudProcessingResult>('process-video', {
      body: {
        videoPath,
        templatePath,
        greenArea,
        settings: {
          fitMode: settings.fitMode,
          maxQuality: settings.maxQuality,
          trimStart: 0.5,
          trimEnd: 0.5,
        },
        outputFilename,
      },
    });

    if (error) {
      console.error('[CloudProcessor] Edge function error:', error);
      throw new Error(`Erro no processamento: ${error.message}`);
    }

    if (!data?.success || !data.downloadUrl) {
      console.error('[CloudProcessor] Processing failed:', data);
      throw new Error(data?.error || 'Processamento falhou sem mensagem de erro');
    }

    console.log(`[CloudProcessor] Processing complete in ${data.processingTimeSeconds?.toFixed(1)}s`);

    // Stage 4: Download processed video
    onProgress({
      videoId,
      progress: 85,
      stage: 'encoding',
      message: 'Baixando vídeo processado...',
    });

    const response = await fetch(data.downloadUrl);
    if (!response.ok) {
      throw new Error(`Erro ao baixar vídeo processado: ${response.status}`);
    }

    const outputBlob = await response.blob();

    // Cleanup: delete uploaded files from storage (optional, keeps storage clean)
    try {
      await Promise.all([
        supabase.storage.from('videos').remove([videoPath]),
        // Don't delete template - might be reused
      ]);
    } catch (cleanupError) {
      console.warn('[CloudProcessor] Cleanup warning:', cleanupError);
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`[CloudProcessor] Total time: ${totalTime.toFixed(1)}s for ${videoFile.name}`);

    onProgress({
      videoId,
      progress: 100,
      stage: 'done',
      message: 'Concluído!',
    });

    return outputBlob;

  } catch (error) {
    console.error('[CloudProcessor] Error:', error);
    
    onProgress({
      videoId,
      progress: 0,
      stage: 'error',
      message: error instanceof Error ? error.message : 'Erro desconhecido',
    });

    throw error;
  }
}

/**
 * Check if cloud processing is available
 * Returns true if the edge function is deployed and accessible
 */
export async function isCloudProcessingAvailable(): Promise<boolean> {
  try {
    // Quick health check - call with empty body to get validation error (not 404)
    const { error } = await supabase.functions.invoke('process-video', {
      body: {},
    });
    
    // If we get a 404, the function isn't deployed
    // Any other response (including validation errors) means it's available
    if (error?.message?.includes('404') || error?.message?.includes('not found')) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}
