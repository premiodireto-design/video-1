import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
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
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';

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
    useOriginalFps: true, // Match original video FPS by default
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [singleDownloadFormat, setSingleDownloadFormat] = useState<'mp4' | 'webm'>('mp4');
  const conversionAbortRef = useRef<AbortController | null>(null);
  const [conversionProgress, setConversionProgress] = useState<{ current: number; total: number; filename: string; mode: 'mp4' | 'webm' | 'init' }>({ current: 0, total: 0, filename: '', mode: 'init' });
  const { toast } = useToast();

  const downloadZipBlob = useCallback((zipBlob: Blob, filename: string) => {
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

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
        
        // Small delay between videos to let browser recover resources
        if (i < videosToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
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

  const handleDownloadSingle = useCallback(async (videoId: string, format: 'mp4' | 'webm') => {
    const video = videos.find(v => v.id === videoId);
    if (!video?.outputBlob) return;

    const isAlreadyMp4 = video.outputBlob.type.includes('mp4');
    const isWebm = video.outputBlob.type.includes('webm');

    // If user chose WebM, only download WebM when available (no conversion).
    if (format === 'webm') {
      if (!isWebm) {
        toast({
          title: 'WebM indisponível',
          description: 'Este vídeo foi gerado em MP4. Baixando MP4.',
        });
      }

      const blobToDownload = isWebm ? video.outputBlob : video.outputBlob;
      const ext = isWebm ? 'webm' : 'mp4';
      const url = URL.createObjectURL(blobToDownload);
      const a = document.createElement('a');
      a.href = url;
      a.download = video.name.replace(/\.[^/.]+$/, '') + `_canva.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

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
          targetFps: (video.outputBlob as any).__targetFps,
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
                targetFps: (video.outputBlob as any).__targetFps,
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

        // Yield to the UI thread to reduce stalls when bundling many files
        await new Promise<void>((r) => setTimeout(r, 0));
      }

      toast({
        title: 'Gerando ZIP...',
        description: 'Finalizando o arquivo',
      });

      // For large batches, streaming + no-compression is MUCH more stable and avoids memory spikes.
      let zipBlob: Blob;
      try {
        zipBlob = await zip.generateAsync({
          type: 'blob',
          streamFiles: true,
          compression: 'STORE',
        });
        downloadZipBlob(zipBlob, 'videos_processados_mp4.zip');
      } catch (zipErr) {
        // Fallback: if the browser runs out of memory, split into two ZIPs (still MP4/WebM as added above)
        console.error('ZIP generation failed (MP4). Falling back to split ZIPs:', zipErr);
        const chunkSize = 25;
        for (let part = 0; part < Math.ceil(completedVideos.length / chunkSize); part++) {
          const chunk = completedVideos.slice(part * chunkSize, (part + 1) * chunkSize);
          const partZip = new JSZip();
          for (let i = 0; i < chunk.length; i++) {
            const v = chunk[i];
            if (!v.outputBlob) continue;
            const base = v.name.replace(/\.[^/.]+$/, '');
            const filename = `${base}_canva_${String(part * chunkSize + i + 1).padStart(3, '0')}.${v.outputBlob.type.includes('mp4') ? 'mp4' : 'webm'}`;
            partZip.file(filename, v.outputBlob);
          }
          const partBlob = await partZip.generateAsync({ type: 'blob', streamFiles: true, compression: 'STORE' });
          downloadZipBlob(partBlob, `videos_processados_mp4_parte_${part + 1}.zip`);
          await new Promise<void>((r) => setTimeout(r, 300));
        }
      }

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
  }, [videos, toast, downloadZipBlob]);

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

        await new Promise<void>((r) => setTimeout(r, 0));
      }

      try {
        const zipBlob = await zip.generateAsync({
          type: 'blob',
          streamFiles: true,
          compression: 'STORE',
        });
        downloadZipBlob(zipBlob, 'videos_processados_webm.zip');
      } catch (zipErr) {
        console.error('ZIP generation failed (WebM). Falling back to split ZIPs:', zipErr);
        const chunkSize = 25;
        for (let part = 0; part < Math.ceil(completedVideos.length / chunkSize); part++) {
          const chunk = completedVideos.slice(part * chunkSize, (part + 1) * chunkSize);
          const partZip = new JSZip();
          for (let i = 0; i < chunk.length; i++) {
            const v = chunk[i];
            if (!v.outputBlob) continue;
            const filename = v.name.replace(/\.[^/.]+$/, '') + `_canva_${String(part * chunkSize + i + 1).padStart(3, '0')}.webm`;
            partZip.file(filename, v.outputBlob);
          }
          const partBlob = await partZip.generateAsync({ type: 'blob', streamFiles: true, compression: 'STORE' });
          downloadZipBlob(partBlob, `videos_processados_webm_parte_${part + 1}.zip`);
          await new Promise<void>((r) => setTimeout(r, 300));
        }
      }

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
  }, [videos, toast, downloadZipBlob]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container py-6">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Processar Vídeos em Lote</h1>
              <p className="text-muted-foreground">
                Crie vídeos profissionais usando seu template do Canva
              </p>
            </div>
            <Link to="/advanced">
              <Button className="gap-2 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70">
                <Sparkles className="h-4 w-4" />
                MODO AVANÇADO de Edição
              </Button>
            </Link>
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
              testVideoFile={videos.length > 0 ? videos[0].file : null}
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
            singleDownloadFormat={singleDownloadFormat}
            onSingleDownloadFormatChange={setSingleDownloadFormat}
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
