import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Download, 
  FileSpreadsheet, 
  Package, 
  X, 
  Loader2,
  Info
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DownloadProgress } from '@/types/analyser';

interface DownloadSectionProps {
  platform: 'tiktok' | 'instagram';
  selectedCount: number;
  totalCount: number;
  onDownloadSelected: () => void;
  onDownloadAll: () => void;
  onExportCSV: () => void;
  downloadProgress: DownloadProgress | null;
  isDownloading: boolean;
  onCancelDownload: () => void;
}

export function DownloadSection({ 
  platform,
  selectedCount, 
  totalCount, 
  onDownloadSelected,
  onDownloadAll,
  onExportCSV,
  downloadProgress,
  isDownloading,
  onCancelDownload
}: DownloadSectionProps) {
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Download className="h-5 w-5" />
            Exportar e Baixar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 border border-border">
            <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              Downloads são habilitados <strong>apenas</strong> para arquivos que você enviou no <strong>Modo Upload</strong> (conteúdo próprio). 
              Para conteúdo de terceiros, use as opções oficiais de exportação das plataformas.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button 
              onClick={onExportCSV}
              variant="outline"
              disabled={totalCount === 0}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Exportar CSV ({totalCount})
            </Button>

            <Button 
              onClick={onDownloadSelected}
              disabled={selectedCount === 0 || isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Package className="h-4 w-4 mr-2" />
              )}
              Baixar Seleção (.zip) ({selectedCount})
            </Button>

            <Button 
              onClick={onDownloadAll}
              variant="secondary"
              disabled={totalCount === 0 || isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Baixar Todos (.zip) ({totalCount})
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            <p><strong>Formato do arquivo:</strong> [posição]-[likes]-[views]-[data]-[id].mp4</p>
            <p>Os arquivos serão ordenados conforme a ordem atual da lista (após filtros e ordenação).</p>
          </div>
        </CardContent>
      </Card>

      {/* Progress Modal */}
      <Dialog open={isDownloading} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Baixando Vídeos</DialogTitle>
            <DialogDescription>
              Aguarde enquanto preparamos o arquivo ZIP...
            </DialogDescription>
          </DialogHeader>

          {downloadProgress && (
            <div className="space-y-4 py-4">
              <Progress value={downloadProgress.percentage} />
              
              <div className="text-center space-y-1">
                <p className="text-2xl font-bold">{downloadProgress.percentage}%</p>
                <p className="text-sm text-muted-foreground">
                  {downloadProgress.currentItem} de {downloadProgress.totalItems} vídeos
                </p>
                {downloadProgress.remainingItems > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Restantes: {downloadProgress.remainingItems}
                  </p>
                )}
              </div>

              <Button 
                variant="destructive" 
                onClick={onCancelDownload}
                className="w-full"
              >
                <X className="h-4 w-4 mr-2" />
                Cancelar Download
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
