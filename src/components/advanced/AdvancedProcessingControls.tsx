import { Play, Zap, Download, X, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { type AdvancedVideoFile } from './AdvancedVideoUpload';

interface AdvancedProcessingControlsProps {
  videos: AdvancedVideoFile[];
  isProcessing: boolean;
  isConverting: boolean;
  conversionProgress: { current: number; total: number; filename: string; mode: 'mp4' | 'webm' | 'init' };
  overallProgress: number;
  canProcess: boolean;
  onPreview: () => void;
  onProcessAll: () => void;
  onDownloadAllMp4: () => void;
  onDownloadAllWebm: () => void;
  onDownloadSingle: (videoId: string) => void;
  onCancelConversion: () => void;
}

export function AdvancedProcessingControls({
  videos,
  isProcessing,
  isConverting,
  conversionProgress,
  overallProgress,
  canProcess,
  onPreview,
  onProcessAll,
  onDownloadAllMp4,
  onDownloadAllWebm,
  onCancelConversion,
}: AdvancedProcessingControlsProps) {
  const queuedCount = videos.filter(v => v.status === 'queued').length;
  const completedCount = videos.filter(v => v.status === 'completed').length;
  const hasCompleted = completedCount > 0;

  return (
    <Card>
      <CardContent className="p-4">
        {/* Progress indicator */}
        {(isProcessing || isConverting) && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {isConverting 
                  ? `Convertendo: ${conversionProgress.filename}` 
                  : 'Processando com IA...'}
              </span>
              <span className="font-medium">
                {isConverting 
                  ? `${conversionProgress.current}/${conversionProgress.total}` 
                  : `${Math.round(overallProgress)}%`}
              </span>
            </div>
            <Progress 
              value={isConverting 
                ? (conversionProgress.current / Math.max(conversionProgress.total, 1)) * 100 
                : overallProgress} 
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {/* Processing buttons */}
          <div className="flex gap-2">
            <Button
              onClick={onPreview}
              disabled={!canProcess || isProcessing || isConverting || queuedCount === 0}
              variant="outline"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Preview (1)
                </>
              )}
            </Button>

            <Button
              onClick={onProcessAll}
              disabled={!canProcess || isProcessing || isConverting || queuedCount === 0}
              className="bg-primary"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Processar Todos ({queuedCount})
                </>
              )}
            </Button>
          </div>

          {/* Download buttons */}
          {hasCompleted && (
            <div className="flex gap-2 ml-auto">
              <Button
                onClick={onDownloadAllMp4}
                disabled={isProcessing || isConverting}
                variant="secondary"
              >
                <Download className="h-4 w-4 mr-2" />
                ZIP MP4 ({completedCount})
              </Button>

              <Button
                onClick={onDownloadAllWebm}
                disabled={isProcessing || isConverting}
                variant="outline"
              >
                <Download className="h-4 w-4 mr-2" />
                ZIP WebM
              </Button>
            </div>
          )}

          {/* Cancel button */}
          {isConverting && (
            <Button
              onClick={onCancelConversion}
              variant="destructive"
              size="sm"
            >
              <X className="h-4 w-4 mr-2" />
              Cancelar
            </Button>
          )}
        </div>

        {/* Status summary */}
        <div className="mt-3 text-sm text-muted-foreground text-center">
          {videos.length === 0 
            ? 'Adicione vídeos para começar' 
            : `${completedCount} processado(s), ${queuedCount} na fila`}
        </div>
      </CardContent>
    </Card>
  );
}
