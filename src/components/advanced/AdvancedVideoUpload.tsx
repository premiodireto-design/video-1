import { useCallback, useRef } from 'react';
import { Video, X, CheckCircle2, AlertCircle, Loader2, Upload } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';

export interface AdvancedVideoFile {
  id: string;
  file: File;
  name: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  outputBlob?: Blob;
  transcription?: { text: string; words: { word: string; start: number; end: number }[] };
}

interface AdvancedVideoUploadProps {
  videos: AdvancedVideoFile[];
  onVideosChange: (videos: AdvancedVideoFile[]) => void;
  disabled?: boolean;
}

export function AdvancedVideoUpload({ videos, onVideosChange, disabled }: AdvancedVideoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFiles = useCallback((files: FileList) => {
    const videoFiles = Array.from(files).filter(f => f.type.startsWith('video/'));
    
    if (videoFiles.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Nenhum vídeo encontrado',
        description: 'Por favor, selecione arquivos de vídeo.',
      });
      return;
    }

    const newVideos: AdvancedVideoFile[] = videoFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      name: file.name,
      status: 'queued',
      progress: 0,
    }));

    onVideosChange([...videos, ...newVideos]);
    toast({
      title: 'Vídeos adicionados',
      description: `${videoFiles.length} vídeo(s) na fila para processamento avançado`,
    });
  }, [videos, onVideosChange, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  }, [disabled, handleFiles]);

  const handleRemove = useCallback((id: string) => {
    onVideosChange(videos.filter(v => v.id !== id));
  }, [videos, onVideosChange]);

  const handleClearAll = useCallback(() => {
    onVideosChange([]);
  }, [onVideosChange]);

  const getStatusIcon = (status: AdvancedVideoFile['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      default:
        return <Video className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Vídeos para Processamento Avançado
            </CardTitle>
            <CardDescription>
              Adicione os vídeos que receberão legendas e/ou dublagem
            </CardDescription>
          </div>
          {videos.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearAll} disabled={disabled}>
              Limpar todos
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`
            border-2 border-dashed rounded-lg p-6 text-center transition-colors
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary/50'}
          `}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            disabled={disabled}
          />
          <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Arraste vídeos aqui ou clique para selecionar
          </p>
        </div>

        {videos.length > 0 && (
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                >
                  {getStatusIcon(video.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{video.name}</p>
                    {video.status === 'processing' && (
                      <Progress value={video.progress} className="h-1 mt-1" />
                    )}
                    {video.error && (
                      <p className="text-xs text-destructive mt-1">{video.error}</p>
                    )}
                  </div>
                  {video.status === 'queued' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(video.id)}
                      disabled={disabled}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {videos.length > 0 && (
          <div className="text-sm text-muted-foreground text-center">
            {videos.filter(v => v.status === 'completed').length} de {videos.length} processado(s)
          </div>
        )}
      </CardContent>
    </Card>
  );
}
