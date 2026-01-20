import { useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { Header } from '@/components/layout/Header';
import { TemplateUpload } from '@/components/template/TemplateUpload';
import { VideoUpload, type VideoFile } from '@/components/video/VideoUpload';
import { ProcessingSettings } from '@/components/settings/ProcessingSettings';
import { ProcessingControls } from '@/components/processing/ProcessingControls';
import { useToast } from '@/hooks/use-toast';
import {
  processVideo,
  type ProcessingSettings as ProcessingSettingsType,
  type ProcessingProgress,
  type CaptionData
} from '@/lib/videoProcessor';
import { convertWebMToMP4, loadFFmpegConverter } from '@/lib/videoConverter';
import { type GreenArea } from '@/lib/greenDetection';
import { transcribeVideo } from '@/lib/transcriptionService';
import { dubVideo, textToSpeech, loadPuterSDK } from '@/lib/dubbingService';

export default function Dashboard() {
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [greenArea, setGreenArea] = useState<GreenArea | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [settings, setSettings] = useState<ProcessingSettingsType>({
    fitMode: 'cover',
    normalizeAudio: false,
    maxQuality: false,
    removeBlackBars: false,
    watermark: '',
    useAiFraming: true, // Enabled by default
    useCaptions: false, // Disabled by default (user can enable)
    useDubbing: false, // Disabled by default (user can enable)
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const conversionAbortRef = useRef<AbortController | null>(null);
  const [conversionProgress, setConversionProgress] = useState<{ current: number; total: number; filename: string; mode: 'mp4' | 'webm' | 'init' }>({ current: 0, total: 0, filename: '', mode: 'init' });
  const { toast } = useToast();

  const canProcess = templateFile !== null && greenArea !== null && videos.length > 0;

  const overallProgress = videos.length > 0
    ? videos.reduce((sum, v) => sum + v.progress, 0) / videos.length
    : 0;

  const handleTemplateDetected = useCallback((file: File, area: GreenArea) => {
    setTemplateFile(file);
    setGreenArea(area);
  }, []);

  const updateVideoProgress = useCallback((progress: ProcessingProgress) => {
    setVideos(prev => prev.map(v => {
      if (v.id === progress.videoId) {
        return {
          ...v,
          progress: progress.progress,
          status: progress.stage === 'done' ? 'completed' 
                : progress.stage === 'error' ? 'failed' 
                : 'processing',
          error: progress.stage === 'error' ? progress.message : undefined,
        };
      }
      return v;
    }));
  }, []);

  const processVideos = useCallback(async (videosToProcess: VideoFile[]) => {
    if (!templateFile || !greenArea) return;

    setIsProcessing(true);

    try {
      // Process videos sequentially for stability
      // Parallel processing causes resource conflicts with video playback
      for (let i = 0; i < videosToProcess.length; i++) {
        const video = videosToProcess[i];
        
        // Update status to processing
        setVideos(prev => prev.map(v => 
          v.id === video.id ? { ...v, status: 'processing', progress: 0 } : v
        ));

        try {
          // Transcribe audio if captions OR dubbing is enabled
          let captionData: CaptionData | undefined;
          let dubbedAudioBlob: Blob | undefined;
          
          if (settings.useCaptions || settings.useDubbing) {
            updateVideoProgress({
              videoId: video.id,
              progress: 2,
              stage: 'transcribing',
              message: 'Transcrevendo áudio com IA...',
            });
            
            try {
              captionData = await transcribeVideo(video.file);
              console.log('[Dashboard] Transcription result:', captionData?.text?.substring(0, 50));
              
              // If dubbing is enabled, translate and generate speech
              if (settings.useDubbing && captionData && captionData.text) {
                updateVideoProgress({
                  videoId: video.id,
                  progress: 10,
                  stage: 'translating',
                  message: 'Traduzindo para português...',
                });
                
                try {
                  // Load Puter SDK first
                  await loadPuterSDK();
                  
                  const dubbingResult = await dubVideo(captionData, 'pt-BR');
                  captionData = dubbingResult.translatedCaptions; // Use translated captions
                  dubbedAudioBlob = dubbingResult.dubbedAudioBlob;
                  console.log('[Dashboard] Dubbing complete, audio size:', dubbedAudioBlob?.size);
                  
                  updateVideoProgress({
                    videoId: video.id,
                    progress: 20,
                    stage: 'dubbing',
                    message: 'Áudio dublado gerado!',
                  });
                } catch (dubError) {
                  console.warn('[Dashboard] Dubbing failed, continuing without dubbing:', dubError);
                }
              }
            } catch (transcribeError) {
              console.warn('[Dashboard] Transcription failed, continuing without captions:', transcribeError);
            }
          }

          const outputBlob = await processVideo(
            video.file,
            templateFile,
            greenArea,
            settings,
            video.id,
            updateVideoProgress,
            captionData, // Pass caption data if available
            dubbedAudioBlob // Pass dubbed audio if available
          );

          // Update with output
          setVideos(prev => prev.map(v => 
            v.id === video.id ? { ...v, outputBlob, status: 'completed', progress: 100 } : v
          ));
        } catch (error) {
          console.error('Error processing video:', video.name, error);
          setVideos(prev => prev.map(v => 
            v.id === video.id ? { 
              ...v, 
              status: 'failed', 
              error: error instanceof Error ? error.message : 'Erro desconhecido',
              progress: 0 
            } : v
          ));
        }
        
        // Reduced delay between videos for faster processing
        if (i < videosToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }

      toast({
        title: 'Processamento concluído!',
        description: `${videosToProcess.length} vídeo(s) processado(s)`,
      });
    } catch (error) {
      console.error('Processing error:', error);
      toast({
        variant: 'destructive',
        title: 'Erro no processamento',
        description: 'Ocorreu um erro ao processar os vídeos.',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [templateFile, greenArea, settings, updateVideoProgress, toast]);

  const handlePreview = useCallback(() => {
    const queuedVideos = videos.filter(v => v.status === 'queued');
    if (queuedVideos.length > 0) {
      processVideos([queuedVideos[0]]);
    }
  }, [videos, processVideos]);

  const handleProcessAll = useCallback(() => {
    const queuedVideos = videos.filter(v => v.status === 'queued');
    if (queuedVideos.length > 0) {
      processVideos(queuedVideos);
    }
  }, [videos, processVideos]);

  const handleCancelConversion = useCallback(() => {
    conversionAbortRef.current?.abort();
    conversionAbortRef.current = null;
    setIsConverting(false);
    setConversionProgress({ current: 0, total: 0, filename: '', mode: 'init' });

    toast({
      title: 'Ação cancelada',
      description: 'Você pode tentar baixar novamente.',
    });
  }, [toast]);

  const handleDownloadSingle = useCallback(async (videoId: string) => {
    const video = videos.find(v => v.id === videoId);
    if (!video?.outputBlob) return;

    const isAlreadyMp4 = video.outputBlob.type.includes('mp4');

    // If we already produced MP4, download instantly (no conversion)
    if (isAlreadyMp4) {
      const url = URL.createObjectURL(video.outputBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = video.name.replace(/\.[^/.]+$/, '') + '_canva.mp4';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download iniciado!',
        description: 'MP4 gerado direto (sem conversão).',
      });
      return;
    }

    setIsConverting(true);
    conversionAbortRef.current = new AbortController();
    setConversionProgress({ current: 0, total: 100, filename: video.name, mode: 'mp4' });

    toast({
      title: 'Convertendo para MP4...',
      description: 'Aguarde enquanto convertemos o vídeo',
    });

    try {
      const mp4Blob = await convertWebMToMP4(video.outputBlob, video.name, {
        signal: conversionAbortRef.current.signal,
        onProgress: (p) => {
          setConversionProgress({ current: p, total: 100, filename: video.name, mode: 'mp4' });
        },
      });

      const url = URL.createObjectURL(mp4Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = video.name.replace(/\.[^/.]+$/, '') + '_canva.mp4';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download iniciado!',
        description: 'Se não baixar automaticamente, tente novamente (ou desative bloqueio de pop-up).',
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      if (isAbort) return;

      console.error('Conversion error:', error);
      toast({
        variant: 'destructive',
        title: 'Erro na conversão',
        description: 'Não foi possível converter para MP4. Baixando como WebM.',
      });

      const url = URL.createObjectURL(video.outputBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = video.name.replace(/\.[^/.]+$/, '') + '_canva.webm';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      conversionAbortRef.current = null;
      setIsConverting(false);
      setConversionProgress({ current: 0, total: 0, filename: '', mode: 'init' });
    }
  }, [videos, toast]);

  const handleDownloadAllMp4 = useCallback(async () => {
    const completedVideos = videos.filter(v => v.status === 'completed' && v.outputBlob);
    if (completedVideos.length === 0) return;

    setIsConverting(true);
    conversionAbortRef.current = new AbortController();
    setConversionProgress({ current: 0, total: 0, filename: '', mode: 'init' });

    toast({
      title: 'Carregando conversor...',
      description: 'Preparando para converter vídeos para MP4',
    });

    try {
      const zip = new JSZip();

      // Only load FFmpeg if at least one file needs conversion
      const needsConversion = completedVideos.some(v => v.outputBlob && !v.outputBlob.type.includes('mp4'));
      if (needsConversion) {
        // Pre-load FFmpeg converter
        await loadFFmpegConverter();
      }

      for (let i = 0; i < completedVideos.length; i++) {
        const video = completedVideos[i];
        if (!video.outputBlob) continue;

        setConversionProgress({
          current: i + 1,
          total: completedVideos.length,
          filename: video.name,
          mode: 'mp4',
        });

        toast({
          title: `Preparando ${i + 1} de ${completedVideos.length}`,
          description: video.name,
        });

        const base = video.name.replace(/\.[^/.]+$/, '');
        const filename = `${base}_canva_${String(i + 1).padStart(3, '0')}.mp4`;

        try {
          if (video.outputBlob.type.includes('mp4')) {
            zip.file(filename, video.outputBlob);
          } else {
            const mp4Blob = await convertWebMToMP4(video.outputBlob, video.name, {
              signal: conversionAbortRef.current?.signal,
            });
            zip.file(filename, mp4Blob);
          }
        } catch (err) {
          const isAbort = err instanceof DOMException && err.name === 'AbortError';
          if (isAbort) throw err;

          console.error('Error converting video:', video.name, err);
          // Add as WebM if conversion fails
          const fallback = `${base}_canva_${String(i + 1).padStart(3, '0')}.webm`;
          zip.file(fallback, video.outputBlob);
        }
      }

      toast({
        title: 'Gerando ZIP...',
        description: 'Finalizando o arquivo',
      });

      // For large batches, streaming + no-compression is MUCH more stable and avoids memory spikes.
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        streamFiles: true,
        compression: 'STORE',
      });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'videos_processados_mp4.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download concluído!',
        description: `${completedVideos.length} vídeo(s) incluído(s) no ZIP`,
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      if (isAbort) return;

      console.error('Conversion error:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao gerar ZIP',
        description: error instanceof Error ? error.message : 'Ocorreu um erro ao converter os vídeos',
      });
    } finally {
      conversionAbortRef.current = null;
      setIsConverting(false);
      setConversionProgress({ current: 0, total: 0, filename: '', mode: 'init' });
    }
  }, [videos, toast]);

  const handleDownloadAllWebm = useCallback(async () => {
    const completedVideos = videos.filter(v => v.status === 'completed' && v.outputBlob);
    if (completedVideos.length === 0) return;

    setIsConverting(true);
    conversionAbortRef.current = new AbortController();

    toast({
      title: 'Gerando ZIP (WebM)...',
      description: 'Preparando seus vídeos',
    });

    try {
      const zip = new JSZip();

      for (let i = 0; i < completedVideos.length; i++) {
        const video = completedVideos[i];
        if (!video.outputBlob) continue;

        if (conversionAbortRef.current?.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        setConversionProgress({
          current: i + 1,
          total: completedVideos.length,
          filename: video.name,
          mode: 'webm',
        });

        const filename = video.name.replace(/\.[^/.]+$/, '') + `_canva_${String(i + 1).padStart(3, '0')}.webm`;
        zip.file(filename, video.outputBlob);
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        streamFiles: true,
        compression: 'STORE',
      });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'videos_processados_webm.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download concluído!',
        description: `${completedVideos.length} vídeo(s) incluído(s) no ZIP`,
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      if (isAbort) return;

      console.error('ZIP error:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao gerar ZIP',
        description: error instanceof Error ? error.message : 'Ocorreu um erro ao gerar o ZIP',
      });
    } finally {
      conversionAbortRef.current = null;
      setIsConverting(false);
      setConversionProgress({ current: 0, total: 0, filename: '', mode: 'init' });
    }
  }, [videos, toast]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Processar Vídeos em Lote</h1>
          <p className="text-muted-foreground">
            Crie vídeos profissionais usando seu template do Canva
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left column - Template and Videos */}
          <div className="lg:col-span-2 space-y-6">
            <TemplateUpload
              onTemplateDetected={handleTemplateDetected}
              templateFile={templateFile}
              greenArea={greenArea}
            />
            
            <VideoUpload
              videos={videos}
              onVideosChange={setVideos}
              disabled={isProcessing}
            />
          </div>

          {/* Right column - Settings */}
          <div className="space-y-6">
            <ProcessingSettings
              settings={settings}
              onSettingsChange={setSettings}
              disabled={isProcessing}
            />
          </div>
        </div>

        {/* Processing controls - sticky at bottom */}
        <div className="mt-6">
          <ProcessingControls
            videos={videos}
            isProcessing={isProcessing}
            isConverting={isConverting}
            conversionProgress={conversionProgress}
            overallProgress={overallProgress}
            canProcess={canProcess}
            onPreview={handlePreview}
            onProcessAll={handleProcessAll}
            onDownloadAllMp4={handleDownloadAllMp4}
            onDownloadAllWebm={handleDownloadAllWebm}
            onDownloadSingle={handleDownloadSingle}
            onCancelConversion={handleCancelConversion}
          />
        </div>
      </main>
    </div>
  );
}
