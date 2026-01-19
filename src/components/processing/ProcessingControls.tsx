import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Play, Loader2, Download, Eye, Archive } from 'lucide-react';
import type { VideoFile } from '@/components/video/VideoUpload';

interface ProcessingControlsProps {
  videos: VideoFile[];
  isProcessing: boolean;
  isFFmpegLoading: boolean;
  ffmpegLoadProgress: number;
  overallProgress: number;
  canProcess: boolean;
  onPreview: () => void;
  onProcessAll: () => void;
  onDownloadAll: () => void;
  onDownloadSingle: (videoId: string) => void;
}

export function ProcessingControls({
  videos,
  isProcessing,
  isFFmpegLoading,
  ffmpegLoadProgress,
  overallProgress,
  canProcess,
  onPreview,
  onProcessAll,
  onDownloadAll,
  onDownloadSingle,
}: ProcessingControlsProps) {
  const completedVideos = videos.filter(v => v.status === 'completed');
  const hasCompleted = completedVideos.length > 0;
  const allCompleted = completedVideos.length === videos.length && videos.length > 0;

  return (
    <Card className="border-border/50 sticky bottom-4">
      <CardContent className="p-4">
        {/* FFmpeg loading state */}
        {isFFmpegLoading && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Carregando processador de vídeo...</span>
            </div>
            <Progress value={ffmpegLoadProgress} className="h-2" />
          </div>
        )}

        {/* Processing progress */}
        {isProcessing && !isFFmpegLoading && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Processando vídeos...</span>
              <span className="font-medium">{Math.round(overallProgress)}%</span>
            </div>
            <Progress value={overallProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {videos.filter(v => v.status === 'completed').length} de {videos.length} concluído(s)
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={onPreview}
            disabled={!canProcess || isProcessing || isFFmpegLoading}
          >
            <Eye className="h-4 w-4 mr-2" />
            Pré-visualizar
          </Button>

          <Button
            onClick={onProcessAll}
            disabled={!canProcess || isProcessing || isFFmpegLoading}
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
            <>
              <Button
                variant="secondary"
                onClick={onDownloadAll}
                disabled={isProcessing}
              >
                <Archive className="h-4 w-4 mr-2" />
                Baixar tudo em ZIP
              </Button>
            </>
          )}
        </div>

        {/* Individual download buttons for completed videos */}
        {hasCompleted && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm font-medium mb-2">Downloads individuais:</p>
            <div className="flex flex-wrap gap-2">
              {completedVideos.map((video) => (
                <Button
                  key={video.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => onDownloadSingle(video.id)}
                  className="text-xs"
                >
                  <Download className="h-3 w-3 mr-1" />
                  {video.name.replace(/\.[^/.]+$/, '')}
                </Button>
              ))}
            </div>
          </div>
        )}

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
