import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { DebugLogPanel } from '@/components/debug/DebugLogPanel';
import { 
  Play, 
  Loader2, 
  Download, 
  Eye, 
  Archive, 
  AlertTriangle,
  FileDown
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { VideoFile } from '@/components/video/VideoUpload';

interface ProcessingControlsProps {
  videos: VideoFile[];
  isProcessing: boolean;
  isConverting?: boolean;
  conversionProgress?: { current: number; total: number; filename: string; mode: 'mp4' | 'webm' | 'init' };
  overallProgress: number;
  canProcess: boolean;
  onPreview: () => void;
  onProcessAll: () => void;
  onDownloadAllMp4: () => void;
  onDownloadAllWebm: () => void;
  onDownloadSingle: (videoId: string) => void;
  onDownloadIndividual?: () => void;
  onCancelConversion?: () => void;
}

export function ProcessingControls({
  videos,
  isProcessing,
  isConverting = false,
  conversionProgress,
  overallProgress,
  canProcess,
  onPreview,
  onProcessAll,
  onDownloadAllMp4,
  onDownloadAllWebm,
  onDownloadSingle,
  onDownloadIndividual,
  onCancelConversion,
}: ProcessingControlsProps) {
  const completedVideos = videos.filter(v => v.status === 'completed');
  const hasCompleted = completedVideos.length > 0;
  const [showZipWarning, setShowZipWarning] = useState(false);
  const [pendingDownloadType, setPendingDownloadType] = useState<'mp4' | 'webm' | null>(null);

  // Estimate ZIP info
  const zipEstimate = useMemo(() => {
    if (!hasCompleted) return null;
    
    let totalSize = 0;
    for (const video of completedVideos) {
      if (video.outputBlob) {
        totalSize += video.outputBlob.size;
      }
    }
    
    const MAX_FILES_PER_ZIP = 10;
    const MAX_ZIP_SIZE_MB = 100;
    const totalSizeMB = totalSize / (1024 * 1024);
    
    // Estimate number of ZIPs needed
    const zipsBySize = Math.ceil(totalSizeMB / MAX_ZIP_SIZE_MB);
    const zipsByCount = Math.ceil(completedVideos.length / MAX_FILES_PER_ZIP);
    const estimatedZips = Math.max(zipsBySize, zipsByCount, 1);
    
    return {
      totalFiles: completedVideos.length,
      estimatedZips,
      totalSizeMB: Math.round(totalSizeMB * 10) / 10,
    };
  }, [completedVideos, hasCompleted]);

  const handleDownloadClick = (type: 'mp4' | 'webm') => {
    if (zipEstimate && (zipEstimate.estimatedZips > 1 || zipEstimate.totalSizeMB > 50)) {
      setPendingDownloadType(type);
      setShowZipWarning(true);
    } else {
      if (type === 'mp4') {
        onDownloadAllMp4();
      } else {
        onDownloadAllWebm();
      }
    }
  };

  const confirmDownload = () => {
    setShowZipWarning(false);
    if (pendingDownloadType === 'mp4') {
      onDownloadAllMp4();
    } else if (pendingDownloadType === 'webm') {
      onDownloadAllWebm();
    }
    setPendingDownloadType(null);
  };

  return (
    <>
      <Card className="border-border/50 sticky bottom-4">
        <CardContent className="p-4">
          {/* Processing progress */}
          {isProcessing && (
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                  Processando vídeos...
                </span>
                <span className="font-medium">{Math.round(overallProgress)}%</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {videos.filter(v => v.status === 'completed').length} de {videos.length} concluído(s)
              </p>
            </div>
          )}

          {/* Conversion progress */}
          {isConverting && conversionProgress && conversionProgress.total > 0 && (
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {conversionProgress.mode === 'mp4' ? 'Convertendo para MP4...' : 'Gerando ZIP...'}
                </span>
                <span className="font-medium">{conversionProgress.current} de {conversionProgress.total}</span>
              </div>
              <Progress value={(conversionProgress.current / conversionProgress.total) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground truncate">
                {conversionProgress.filename}
              </p>
            </div>
          )}

          {isConverting && (!conversionProgress || conversionProgress.total === 0) && (
            <div className="mb-4 flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Preparando arquivos...</span>
            </div>
          )}

          {/* ZIP estimate info */}
          {hasCompleted && zipEstimate && !isConverting && !isProcessing && (
            <div className="mb-4 p-3 rounded-lg bg-muted/50 border border-border">
              <div className="flex items-start gap-2">
                <Archive className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="text-xs text-muted-foreground">
                  <p>
                    <strong>{zipEstimate.totalFiles} vídeo(s)</strong> • ~{zipEstimate.totalSizeMB} MB
                  </p>
                  {zipEstimate.estimatedZips > 1 && (
                    <p className="text-amber-600 dark:text-amber-500 mt-1">
                      ⚠️ Será dividido em ~{zipEstimate.estimatedZips} arquivos ZIP
                    </p>
                  )}
                  <p className="mt-1">
                    💡 Para muitos vídeos, use <strong>Download Individual</strong> para evitar erros de memória
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={onPreview}
              disabled={!canProcess || isProcessing || isConverting}
            >
              <Eye className="h-4 w-4 mr-2" />
              Pré-visualizar
            </Button>

            <Button
              onClick={onProcessAll}
              disabled={!canProcess || isProcessing || isConverting}
              className="flex-1 sm:flex-none"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Processar todos
                </>
              )}
            </Button>

            {hasCompleted && (
              <div className="flex flex-wrap gap-3 w-full sm:w-auto">
                <Button
                  variant="secondary"
                  onClick={() => handleDownloadClick('mp4')}
                  disabled={isProcessing || isConverting}
                >
                  <Archive className="h-4 w-4 mr-2" />
                  {isConverting ? 'Gerando...' : 'ZIP (MP4)'}
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => handleDownloadClick('webm')}
                  disabled={isProcessing || isConverting}
                >
                  <Archive className="h-4 w-4 mr-2" />
                  {isConverting ? 'Gerando...' : 'ZIP (WebM)'}
                </Button>
              </div>
            )}

            {isConverting && onCancelConversion && (
              <Button
                variant="outline"
                onClick={onCancelConversion}
              >
                Cancelar
              </Button>
            )}
          </div>

          {/* Individual download buttons for completed videos */}
          {hasCompleted && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm font-medium mb-2 flex items-center gap-2">
                <FileDown className="h-4 w-4" />
                Downloads individuais (MP4):
              </p>
              <div className="flex flex-wrap gap-2">
                {completedVideos.map((video) => (
                  <Button
                    key={video.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => onDownloadSingle(video.id)}
                    disabled={isConverting}
                    className="text-xs"
                  >
                    <Download className="h-3 w-3 mr-1" />
                    {video.name.replace(/\.[^/.]+$/, '')}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Debug logs (click to expand) */}
          <DebugLogPanel />

          {/* Help text */}
          {!canProcess && !isProcessing && (
            <p className="text-xs text-muted-foreground mt-3">
              Envie um template com área verde detectada e pelo menos um vídeo para começar
            </p>
          )}
        </CardContent>
      </Card>

      {/* ZIP Warning Dialog */}
      <Dialog open={showZipWarning} onOpenChange={setShowZipWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Arquivo Grande Detectado
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p>
                Você está prestes a baixar <strong>{zipEstimate?.totalFiles} vídeo(s)</strong> 
                {' '}(~{zipEstimate?.totalSizeMB} MB).
              </p>
              {zipEstimate && zipEstimate.estimatedZips > 1 && (
                <p className="text-amber-600 dark:text-amber-500">
                  O download será dividido em aproximadamente <strong>{zipEstimate.estimatedZips} arquivos ZIP</strong> para evitar erros de memória.
                </p>
              )}
              <p className="text-muted-foreground">
                Se o download falhar, tente baixar os vídeos individualmente usando os botões abaixo.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowZipWarning(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmDownload}>
              <Archive className="h-4 w-4 mr-2" />
              Continuar Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
