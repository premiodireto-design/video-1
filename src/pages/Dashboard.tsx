import { useState, useCallback, useRef, useEffect } from 'react';
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
  type ProcessingProgress
} from '@/lib/videoProcessor';
import { convertWebMToMP4, loadFFmpegConverter } from '@/lib/videoConverter';
import { type GreenArea } from '@/lib/greenDetection';
import {
  saveProcessedVideo,
  getProcessedVideo,
  getAllStoredVideoIds,
  cleanupOldVideos,
} from '@/lib/videoStorage';

export default function Dashboard() {
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [greenArea, setGreenArea] = useState<GreenArea | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [settings, setSettings] = useState<ProcessingSettingsType>({
    fitMode: 'cover',
    normalizeAudio: false,
    maxQuality: false, // false = faster (720p internal render)
    removeBlackBars: false,
    watermark: '',
    useAiFraming: false, // Disabled by default for speed (AI analysis is slow)
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const conversionAbortRef = useRef<AbortController | null>(null);
  const [conversionProgress, setConversionProgress] = useState<{ current: number; total: number; filename: string; mode: 'mp4' | 'webm' | 'init' }>({ current: 0, total: 0, filename: '', mode: 'init' });
  const { toast } = useToast();

  // On mount: cleanup old videos and restore any saved processed videos
  useEffect(() => {
    const restoreVideos = async () => {
      try {
        // Clean up videos older than 24h
        await cleanupOldVideos();
        
        // Get stored video IDs
        const storedVideos = await getAllStoredVideoIds();
        
        if (storedVideos.length > 0) {
          // Restore blobs for videos that match current state
          for (const stored of storedVideos) {
            const blob = await getProcessedVideo(stored.id);
            if (blob) {
              setVideos(prev => {
                // Check if this video already exists in state
                const exists = prev.find(v => v.id === stored.id);
                if (exists && !exists.outputBlob) {
                  return prev.map(v => 
                    v.id === stored.id ? { ...v, outputBlob: blob, status: 'completed' as const, progress: 100 } : v
                  );
                }
                return prev;
              });
            }
          }
          
          toast({
            title: 'Vídeos restaurados',
            description: `${storedVideos.length} vídeo(s) processado(s) recuperado(s)`,
          });
        }
      } catch (error) {
        console.error('[Dashboard] Failed to restore videos:', error);
      }
    };
    
    restoreVideos();
  }, [toast]);

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
          let outputBlob: Blob;
          
          // Cloud processing is currently disabled (FFmpeg.wasm doesn't work in Edge Functions)
          // Always use local processing
          outputBlob = await processVideo(
            video.file,
            templateFile,
            greenArea,
            settings,
            video.id,
            updateVideoProgress
          );

          // Save to IndexedDB so it persists across refresh
          await saveProcessedVideo(video.id, video.name, outputBlob);

          // Update with output
          setVideos(prev => prev.map(v => 
            v.id === video.id ? { ...v, outputBlob, status: 'completed', progress: 100 } : v
          ));
        } catch (error) {
          console.error('Error processing video:', video.name, error);
          
          // Mostrar mensagem específica do erro
          const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
          const isTimeout = errorMsg.includes('Timeout');
          
          toast({
            variant: 'destructive',
            title: isTimeout ? 'Vídeo travou - pulando' : 'Erro no vídeo',
            description: `${video.name}: ${errorMsg}`,
          });
          
          setVideos(prev => prev.map(v => 
            v.id === video.id ? { 
              ...v, 
              status: 'failed', 
              error: errorMsg,
              progress: 0 
            } : v
          ));
          
          // Continuar para o próximo vídeo (não interromper o processamento)
          console.log(`Pulando vídeo ${video.name} devido a erro. Continuando...`);
        }
        
        // Minimal delay between videos (just enough for GC)
        if (i < videosToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const successCount = videosToProcess.filter(v => 
        videos.find(vx => vx.id === v.id)?.status === 'completed'
      ).length;
      const failedCount = videosToProcess.length - successCount;
      
      toast({
        title: 'Processamento concluído!',
        description: failedCount > 0 
          ? `${successCount} OK, ${failedCount} com erro(s)`
          : `${successCount} vídeo(s) processado(s) com sucesso`,
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

      const zipBlob = await zip.generateAsync({ type: 'blob' });
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

      const zipBlob = await zip.generateAsync({ type: 'blob' });
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
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Processar Vídeos em Lote</h1>
            <p className="text-muted-foreground">
              Crie vídeos profissionais usando seu template do Canva
            </p>
          </div>
          
          {/* Desktop App Download Banner */}
          <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg">
            <div className="hidden sm:block">
              <span className="text-sm font-medium">⚡ App Desktop</span>
              <span className="text-xs text-muted-foreground ml-1">10x mais rápido com GPU</span>
            </div>
            <div className="flex gap-2">
              <a 
                href="https://github.com/seu-usuario/videotemplate-pro/releases/latest/download/VideoTemplatePro-Setup.exe"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                download
              >
                Windows
              </a>
              <a 
                href="https://github.com/seu-usuario/videotemplate-pro/releases/latest/download/VideoTemplatePro.dmg"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                download
              >
                macOS
              </a>
              <a 
                href="https://github.com/seu-usuario/videotemplate-pro/releases/latest/download/VideoTemplatePro.AppImage"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                download
              >
                Linux
              </a>
            </div>
          </div>
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
