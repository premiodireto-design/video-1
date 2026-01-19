import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { DebugLogPanel } from '@/components/debug/DebugLogPanel';
import { Play, Loader2, Download, Eye, Archive } from 'lucide-react';
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
  onCancelConversion,
}: ProcessingControlsProps) {
  const completedVideos = videos.filter(v => v.status === 'completed');
  const hasCompleted = completedVideos.length > 0;

  return (
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
                Processando {videos.filter(v => v.status === 'processing').length} vídeo(s) em paralelo...
              </span>
              <span className="font-medium">{Math.round(overallProgress)}%</span>
            </div>
            <Progress value={overallProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {videos.filter(v => v.status === 'completed').length} de {videos.length} concluído(s) • 
              <span className="text-primary ml-1">Pode minimizar o navegador!</span>
            </p>
          </div>
        )}

        {/* Conversion progress */}
        {isConverting && conversionProgress && conversionProgress.total > 0 && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Convertendo para MP4...
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
            <span>Convertendo para MP4...</span>
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
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={onDownloadAllMp4}
                disabled={isProcessing || isConverting}
              >
                <Archive className="h-4 w-4 mr-2" />
                {isConverting ? 'Gerando...' : 'Baixar ZIP (MP4)'}
              </Button>

              <Button
                variant="secondary"
                onClick={onDownloadAllWebm}
                disabled={isProcessing || isConverting}
              >
                <Archive className="h-4 w-4 mr-2" />
                {isConverting ? 'Gerando...' : 'Baixar ZIP (WebM)'}
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
            <p className="text-sm font-medium mb-2">Downloads individuais (MP4):</p>
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
  );
}
