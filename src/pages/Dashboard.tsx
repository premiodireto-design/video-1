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
  type ProcessingProgress
} from '@/lib/videoProcessor';
import { convertWebMToMP4, loadFFmpegConverter } from '@/lib/videoConverter';
import { type GreenArea } from '@/lib/greenDetection';

export default function Dashboard() {
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [greenArea, setGreenArea] = useState<GreenArea | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [settings, setSettings] = useState<ProcessingSettingsType>({
    fitMode: 'cover',
    normalizeAudio: false,
    maxQuality: false,
    removeBlackBars: false,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const conversionAbortRef = useRef<AbortController | null>(null);
  const [conversionProgress, setConversionProgress] = useState({ current: 0, total: 0, filename: '' });
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
      // Process videos one by one
      for (const video of videosToProcess) {
        // Update status to processing
        setVideos(prev => prev.map(v => 
          v.id === video.id ? { ...v, status: 'processing', progress: 0 } : v
        ));

        try {
          const outputBlob = await processVideo(
            video.file,
            templateFile,
            greenArea,
            settings,
            video.id,
            updateVideoProgress
          );

          // Update with output
          setVideos(prev => prev.map(v => 
            v.id === video.id ? { ...v, outputBlob, status: 'completed', progress: 100 } : v
          ));
        } catch (error) {
          console.error('Error processing video:', error);
          setVideos(prev => prev.map(v => 
            v.id === video.id ? { 
              ...v, 
              status: 'failed', 
              error: error instanceof Error ? error.message : 'Erro desconhecido',
              progress: 0 
            } : v
          ));
        }
      }

      const successCount = videosToProcess.filter(v => {
        const current = videos.find(cv => cv.id === v.id);
        return current?.status !== 'failed';
      }).length;

      toast({
        title: 'Processamento concluído!',
        description: `Vídeo(s) processado(s) com sucesso`,
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
  }, [templateFile, greenArea, settings, updateVideoProgress, toast, videos]);

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
    setConversionProgress({ current: 0, total: 0, filename: '' });

    toast({
      title: 'Conversão cancelada',
      description: 'Você pode tentar baixar novamente.',
    });
  }, [toast]);

  const handleDownloadSingle = useCallback(async (videoId: string) => {
    const video = videos.find(v => v.id === videoId);
    if (!video?.outputBlob) return;

    setIsConverting(true);
    conversionAbortRef.current = new AbortController();
    setConversionProgress({ current: 0, total: 100, filename: video.name });

    toast({
      title: 'Convertendo para MP4...',
      description: 'Aguarde enquanto convertemos o vídeo',
    });

    try {
      const mp4Blob = await convertWebMToMP4(video.outputBlob, video.name, {
        signal: conversionAbortRef.current.signal,
        onProgress: (p) => {
          setConversionProgress({ current: p, total: 100, filename: video.name });
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
      setConversionProgress({ current: 0, total: 0, filename: '' });
    }
  }, [videos, toast]);

  const handleDownloadAll = useCallback(async () => {
    const completedVideos = videos.filter(v => v.status === 'completed' && v.outputBlob);
    if (completedVideos.length === 0) return;

    setIsConverting(true);
    conversionAbortRef.current = new AbortController();

    toast({
      title: 'Carregando conversor...',
      description: 'Preparando para converter vídeos para MP4',
    });

    try {
      // Pre-load FFmpeg converter
      await loadFFmpegConverter();

      const zip = new JSZip();

      for (let i = 0; i < completedVideos.length; i++) {
        const video = completedVideos[i];
        if (!video.outputBlob) continue;

        setConversionProgress({
          current: i + 1,
          total: completedVideos.length,
          filename: video.name,
        });

        toast({
          title: `Convertendo ${i + 1} de ${completedVideos.length}`,
          description: video.name,
        });

        try {
          const mp4Blob = await convertWebMToMP4(video.outputBlob, video.name, {
            signal: conversionAbortRef.current?.signal,
          });
          const filename = video.name.replace(/\.[^/.]+$/, '') + `_canva_${String(i + 1).padStart(3, '0')}.mp4`;
          zip.file(filename, mp4Blob);
        } catch (err) {
          const isAbort = err instanceof DOMException && err.name === 'AbortError';
          if (isAbort) throw err;

          console.error('Error converting video:', video.name, err);
          // Add as WebM if conversion fails
          const filename = video.name.replace(/\.[^/.]+$/, '') + `_canva_${String(i + 1).padStart(3, '0')}.webm`;
          zip.file(filename, video.outputBlob);
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
      a.download = 'videos_processados.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download concluído!',
        description: `${completedVideos.length} vídeo(s) em MP4 incluído(s) no ZIP`,
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      if (isAbort) return;

      console.error('Conversion error:', error);
      toast({
        variant: 'destructive',
        title: 'Erro na conversão',
        description: 'Ocorreu um erro ao converter os vídeos',
      });
    } finally {
      conversionAbortRef.current = null;
      setIsConverting(false);
      setConversionProgress({ current: 0, total: 0, filename: '' });
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
            onDownloadAll={handleDownloadAll}
            onDownloadSingle={handleDownloadSingle}
            onCancelConversion={handleCancelConversion}
          />
        </div>
      </main>
    </div>
  );
}
