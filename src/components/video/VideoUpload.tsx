import { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Upload, Video, X, FileVideo, Clock, Maximize } from 'lucide-react';
import { getVideoInfo } from '@/lib/videoProcessor';
import { cn } from '@/lib/utils';

export interface VideoFile {
  id: string;
  file: File;
  name: string;
  duration: number;
  width: number;
  height: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  outputBlob?: Blob;
}

interface VideoUploadProps {
  videos: VideoFile[];
  onVideosChange: (videos: VideoFile[]) => void;
  disabled?: boolean;
}

export function VideoUpload({ videos, onVideosChange, disabled }: VideoUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const processVideoFiles = useCallback(async (files: FileList) => {
    setIsLoading(true);
    const newVideos: VideoFile[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('video/')) {
        toast({
          variant: 'destructive',
          title: 'Arquivo inválido',
          description: `${file.name} não é um vídeo válido`,
        });
        continue;
      }

      try {
        const info = await getVideoInfo(file);
        newVideos.push({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          duration: info.duration,
          width: info.width,
          height: info.height,
          status: 'queued',
          progress: 0,
        });
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar vídeo',
          description: `Não foi possível carregar ${file.name}`,
        });
      }
    }

    if (newVideos.length > 0) {
      onVideosChange([...videos, ...newVideos]);
      toast({
        title: 'Vídeos adicionados',
        description: `${newVideos.length} vídeo(s) adicionado(s) à fila`,
      });
    }

    setIsLoading(false);
  }, [videos, onVideosChange, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (disabled) return;
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processVideoFiles(files);
    }
  }, [processVideoFiles, disabled]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processVideoFiles(files);
    }
    // Reset input so same files can be selected again
    e.target.value = '';
  }, [processVideoFiles]);

  const removeVideo = useCallback((id: string) => {
    onVideosChange(videos.filter(v => v.id !== id));
  }, [videos, onVideosChange]);

  const clearAll = useCallback(() => {
    onVideosChange([]);
  }, [onVideosChange]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (status: VideoFile['status']) => {
    switch (status) {
      case 'queued': return 'text-muted-foreground';
      case 'processing': return 'text-primary';
      case 'completed': return 'text-green-500';
      case 'failed': return 'text-destructive';
    }
  };

  const getStatusText = (status: VideoFile['status']) => {
    switch (status) {
      case 'queued': return 'Na fila';
      case 'processing': return 'Processando';
      case 'completed': return 'Concluído';
      case 'failed': return 'Erro';
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Enviar Vídeos (em massa)
            </CardTitle>
            <CardDescription>
              Envie de 1 a 30 vídeos para processar em lote
            </CardDescription>
          </div>
          {videos.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              disabled={disabled}
            >
              Limpar tudo
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload area */}
        <div
          className={cn(
            'border-2 border-dashed rounded-lg transition-all duration-200',
            isDragging ? 'border-primary bg-primary/5' : 'border-border',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div 
            className={cn(
              'flex flex-col items-center justify-center py-8 px-4',
              !disabled && 'cursor-pointer'
            )}
            onClick={() => !disabled && fileInputRef.current?.click()}
          >
            <div className="p-3 bg-muted rounded-full mb-3">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">
              {isLoading ? 'Carregando vídeos...' : 'Arraste e solte ou clique para enviar'}
            </p>
            <p className="text-xs text-muted-foreground">
              MP4, MOV, WEBM • Máximo 30 vídeos
            </p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          disabled={disabled}
        />

        {/* Video list */}
        {videos.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{videos.length} vídeo(s) na fila</span>
              <span>
                {videos.filter(v => v.status === 'completed').length} concluído(s)
              </span>
            </div>

            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-2">
                {videos.map((video) => (
                  <div
                    key={video.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border bg-card',
                      video.status === 'processing' && 'ring-2 ring-primary',
                      video.status === 'completed' && 'border-green-500/50',
                      video.status === 'failed' && 'border-destructive/50'
                    )}
                  >
                    <div className="p-2 bg-muted rounded">
                      <FileVideo className="h-4 w-4" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{video.name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(video.duration)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Maximize className="h-3 w-3" />
                          {video.width}x{video.height}
                        </span>
                      </div>
                      
                      {/* Progress bar */}
                      {video.status === 'processing' && (
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${video.progress}%` }}
                          />
                        </div>
                      )}
                      
                      {video.error && (
                        <p className="text-xs text-destructive mt-1">{video.error}</p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <span className={cn('text-xs font-medium', getStatusColor(video.status))}>
                        {video.status === 'processing' ? `${video.progress}%` : getStatusText(video.status)}
                      </span>
                      
                      {video.status === 'queued' && !disabled && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeVideo(video.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
