import { useState, useCallback } from 'react';
import JSZip from 'jszip';
import { Header } from '@/components/layout/Header';
import { TemplateUpload } from '@/components/template/TemplateUpload';
import { VideoUpload, type VideoFile } from '@/components/video/VideoUpload';
import { ProcessingSettings } from '@/components/settings/ProcessingSettings';
import { ProcessingControls } from '@/components/processing/ProcessingControls';
import { useToast } from '@/hooks/use-toast';
import { 
  loadFFmpeg, 
  processVideo, 
  type ProcessingSettings as ProcessingSettingsType,
  type ProcessingProgress 
} from '@/lib/ffmpegProcessor';
import { createTemplateMask, type GreenArea } from '@/lib/greenDetection';

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
  const [isFFmpegLoading, setIsFFmpegLoading] = useState(false);
  const [ffmpegLoadProgress, setFFmpegLoadProgress] = useState(0);
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
    setIsFFmpegLoading(true);

    try {
      // Load FFmpeg
      const ff = await loadFFmpeg((loaded, total) => {
        setFFmpegLoadProgress((loaded / total) * 100);
      });
      setIsFFmpegLoading(false);

      // Create template mask (green area transparent)
      const templateMask = await createTemplateMask(templateFile, greenArea);

      // Process videos one by one
      for (const video of videosToProcess) {
        // Update status to processing
        setVideos(prev => prev.map(v => 
          v.id === video.id ? { ...v, status: 'processing', progress: 0 } : v
        ));

        try {
          const outputBlob = await processVideo(
            ff,
            video.file,
            templateFile,
            templateMask,
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

      toast({
        title: 'Processamento concluído!',
        description: `${videosToProcess.filter(v => v.status !== 'failed').length} vídeo(s) processado(s) com sucesso`,
      });
    } catch (error) {
      console.error('FFmpeg loading error:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar processador',
        description: 'Não foi possível carregar o FFmpeg. Tente recarregar a página.',
      });
    } finally {
      setIsProcessing(false);
      setIsFFmpegLoading(false);
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

  const handleDownloadSingle = useCallback((videoId: string) => {
    const video = videos.find(v => v.id === videoId);
    if (!video?.outputBlob) return;

    const url = URL.createObjectURL(video.outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = video.name.replace(/\.[^/.]+$/, '') + '_canva.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [videos]);

  const handleDownloadAll = useCallback(async () => {
    const completedVideos = videos.filter(v => v.status === 'completed' && v.outputBlob);
    if (completedVideos.length === 0) return;

    toast({
      title: 'Preparando ZIP...',
      description: 'Isso pode levar alguns segundos',
    });

    const zip = new JSZip();
    
    completedVideos.forEach((video, index) => {
      if (video.outputBlob) {
        const filename = video.name.replace(/\.[^/.]+$/, '') + `_canva_${String(index + 1).padStart(3, '0')}.mp4`;
        zip.file(filename, video.outputBlob);
      }
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
      title: 'Download iniciado!',
      description: `${completedVideos.length} vídeo(s) incluído(s) no ZIP`,
    });
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
            isFFmpegLoading={isFFmpegLoading}
            ffmpegLoadProgress={ffmpegLoadProgress}
            overallProgress={overallProgress}
            canProcess={canProcess}
            onPreview={handlePreview}
            onProcessAll={handleProcessAll}
            onDownloadAll={handleDownloadAll}
            onDownloadSingle={handleDownloadSingle}
          />
        </div>
      </main>
    </div>
  );
}
