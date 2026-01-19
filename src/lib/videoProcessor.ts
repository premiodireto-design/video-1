import type { GreenArea } from './greenDetection';

export interface ProcessingSettings {
  fitMode: 'cover' | 'contain';
  normalizeAudio: boolean;
  maxQuality: boolean;
  removeBlackBars: boolean;
}

export interface ProcessingProgress {
  videoId: string;
  progress: number;
  stage: 'loading' | 'processing' | 'encoding' | 'done' | 'error';
  message: string;
}

export type ProgressCallback = (progress: ProcessingProgress) => void;

export async function getVideoInfo(videoFile: File): Promise<{
  duration: number;
  width: number;
  height: number;
}> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Não foi possível carregar o vídeo'));
    };
    
    video.src = URL.createObjectURL(videoFile);
  });
}

/**
 * Process video using Canvas API - simpler and more compatible approach
 * This creates a frame-by-frame composition of video + template
 */
export async function processVideo(
  videoFile: File,
  templateFile: File | Blob,
  greenArea: GreenArea,
  settings: ProcessingSettings,
  videoId: string,
  onProgress: ProgressCallback
): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    onProgress({
      videoId,
      progress: 5,
      stage: 'loading',
      message: 'Carregando arquivos...',
    });

    try {
      // Load template image
      const templateImg = await loadImage(templateFile);
      
      // Load video
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      
      const videoUrl = URL.createObjectURL(videoFile);
      
      await new Promise<void>((res, rej) => {
        video.onloadeddata = () => res();
        video.onerror = () => rej(new Error('Erro ao carregar vídeo'));
        video.src = videoUrl;
      });

      onProgress({
        videoId,
        progress: 15,
        stage: 'processing',
        message: 'Preparando canvas...',
      });

      // Create canvas for composition
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext('2d')!;

      // Calculate video scaling
      const { x, y, width: ww, height: wh } = greenArea;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      
      let scale: number;
      let offsetX: number;
      let offsetY: number;
      
      if (settings.fitMode === 'cover') {
        // Cover mode: scale to cover, crop from bottom
        scale = Math.max(ww / vw, wh / vh);
        const scaledW = vw * scale;
        const scaledH = vh * scale;
        offsetX = (ww - scaledW) / 2;
        offsetY = 0; // Top-aligned
      } else {
        // Contain mode: scale to fit, may have black bars
        scale = Math.min(ww / vw, wh / vh);
        const scaledW = vw * scale;
        const scaledH = vh * scale;
        offsetX = (ww - scaledW) / 2;
        offsetY = (wh - scaledH) / 2;
      }

      // Create template mask (green area transparent)
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = 1080;
      maskCanvas.height = 1920;
      const maskCtx = maskCanvas.getContext('2d')!;
      maskCtx.drawImage(templateImg, 0, 0, 1080, 1920);
      
      // Make green pixels transparent
      const maskData = maskCtx.getImageData(0, 0, 1080, 1920);
      const pixels = maskData.data;
      const tolerance = 60;
      
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        
        if (r < tolerance && g > 200 && b < tolerance) {
          pixels[i + 3] = 0; // Transparent
        }
      }
      maskCtx.putImageData(maskData, 0, 0);

      // Set up MediaRecorder for video capture
      const stream = canvas.captureStream(30);
      
      // Try to use video codec, fallback to default
      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
        }
      }
      
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: settings.maxQuality ? 8000000 : 4000000,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        URL.revokeObjectURL(videoUrl);
        const blob = new Blob(chunks, { type: 'video/webm' });
        
        onProgress({
          videoId,
          progress: 100,
          stage: 'done',
          message: 'Concluído!',
        });
        
        resolve(blob);
      };

      recorder.onerror = (e) => {
        URL.revokeObjectURL(videoUrl);
        reject(new Error('Erro na gravação do vídeo'));
      };

      // Start recording
      recorder.start();
      
      onProgress({
        videoId,
        progress: 20,
        stage: 'encoding',
        message: 'Processando frames...',
      });

      // Play video and capture frames
      video.currentTime = 0;
      await video.play();

      const duration = video.duration;
      let lastProgress = 20;

      const renderFrame = () => {
        if (video.ended || video.paused) {
          recorder.stop();
          return;
        }

        // Clear canvas
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 1080, 1920);

        // Draw video in the green area position
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, ww, wh);
        ctx.clip();
        
        const scaledW = vw * scale;
        const scaledH = vh * scale;
        ctx.drawImage(video, x + offsetX, y + offsetY, scaledW, scaledH);
        ctx.restore();

        // Draw template mask on top
        ctx.drawImage(maskCanvas, 0, 0);

        // Update progress
        const currentProgress = 20 + (video.currentTime / duration) * 75;
        if (currentProgress > lastProgress + 5) {
          lastProgress = currentProgress;
          onProgress({
            videoId,
            progress: Math.round(currentProgress),
            stage: 'encoding',
            message: `Processando: ${Math.round((video.currentTime / duration) * 100)}%`,
          });
        }

        requestAnimationFrame(renderFrame);
      };

      requestAnimationFrame(renderFrame);

      // Stop when video ends
      video.onended = () => {
        setTimeout(() => {
          if (recorder.state === 'recording') {
            recorder.stop();
          }
        }, 100);
      };

    } catch (error) {
      onProgress({
        videoId,
        progress: 0,
        stage: 'error',
        message: error instanceof Error ? error.message : 'Erro desconhecido',
      });
      reject(error);
    }
  });
}

async function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Erro ao carregar imagem'));
    };
    
    img.src = url;
  });
}
