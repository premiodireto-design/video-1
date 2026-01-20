import { useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { Header } from '@/components/layout/Header';
import { AdvancedTemplateUpload } from '@/components/advanced/AdvancedTemplateUpload';
import { AdvancedVideoUpload, type AdvancedVideoFile } from '@/components/advanced/AdvancedVideoUpload';
import { AdvancedSettings, type AdvancedSettingsType } from '@/components/advanced/AdvancedSettings';
import { AdvancedProcessingControls } from '@/components/advanced/AdvancedProcessingControls';
import { useToast } from '@/hooks/use-toast';
import { processAdvancedVideo, type AdvancedProcessingProgress } from '@/lib/advancedVideoProcessor';
import { convertWebMToMP4, loadFFmpegConverter } from '@/lib/videoConverter';
import { type GreenArea } from '@/lib/greenDetection';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AdvancedDashboard() {
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [greenArea, setGreenArea] = useState<GreenArea | null>(null);
  const [videos, setVideos] = useState<AdvancedVideoFile[]>([]);
  const [settings, setSettings] = useState<AdvancedSettingsType>({
    fitMode: 'cover',
    normalizeAudio: false,
    maxQuality: false,
    removeBlackBars: false,
    watermark: '',
    useAiFraming: true,
    enableCaptions: false,
    captionStyle: 'bottom',
    enableDubbing: false,
    dubbingLanguage: 'pt-BR',
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

  const updateVideoProgress = useCallback((progress: AdvancedProcessingProgress) => {
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

  const processVideos = useCallback(async (videosToProcess: AdvancedVideoFile[]) => {
    if (!templateFile || !greenArea) return;

    setIsProcessing(true);

    try {
      for (let i = 0; i < videosToProcess.length; i++) {
        const video = videosToProcess[i];
        
        setVideos(prev => prev.map(v => 
          v.id === video.id ? { ...v, status: 'processing', progress: 0 } : v
        ));

        try {
          const outputBlob = await processAdvancedVideo(
            video.file,
            templateFile,
            greenArea,
            settings,
            video.id,
            updateVideoProgress
          );

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
        
        if (i < videosToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      toast({
        title: 'Processamento concluído!',
        description: `${videosToProcess.length} vídeo(s) processado(s) com IA`,
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

    if (isAlreadyMp4) {
      const url = URL.createObjectURL(video.outputBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = video.name.replace(/\.[^/.]+$/, '') + '_advanced.mp4';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download iniciado!',
        description: 'MP4 gerado direto.',
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
      a.download = video.name.replace(/\.[^/.]+$/, '') + '_advanced.mp4';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download iniciado!',
        description: 'Conversão concluída com sucesso.',
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
      a.download = video.name.replace(/\.[^/.]+$/, '') + '_advanced.webm';
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

      const needsConversion = completedVideos.some(v => v.outputBlob && !v.outputBlob.type.includes('mp4'));
      if (needsConversion) {
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
        const filename = `${base}_advanced_${String(i + 1).padStart(3, '0')}.mp4`;

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
          const fallback = `${base}_advanced_${String(i + 1).padStart(3, '0')}.webm`;
          zip.file(fallback, video.outputBlob);
        }
      }

      toast({
        title: 'Gerando ZIP...',
        description: 'Finalizando o arquivo',
      });

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        streamFiles: true,
        compression: 'STORE',
      });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'videos_advanced_mp4.zip';
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

        const filename = video.name.replace(/\.[^/.]+$/, '') + `_advanced_${String(i + 1).padStart(3, '0')}.webm`;
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
      a.download = 'videos_advanced_webm.zip';
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
          <div className="flex items-center gap-4 mb-2">
            <Link to="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar ao Modo Simples
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Sparkles className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Modo Avançado de Edição</h1>
              <p className="text-muted-foreground">
                Legendas automáticas com IA e dublagem em português
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <AdvancedTemplateUpload
              onTemplateDetected={handleTemplateDetected}
              templateFile={templateFile}
              greenArea={greenArea}
            />
            
            <AdvancedVideoUpload
              videos={videos}
              onVideosChange={setVideos}
              disabled={isProcessing}
            />
          </div>

          <div className="space-y-6">
            <AdvancedSettings
              settings={settings}
              onSettingsChange={setSettings}
              disabled={isProcessing}
            />
          </div>
        </div>

        <div className="mt-6">
          <AdvancedProcessingControls
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
