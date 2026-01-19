import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Eye, 
  Heart, 
  MessageCircle, 
  ExternalLink, 
  Calendar,
  Video,
  CheckSquare,
  Square
} from 'lucide-react';
import type { AnalyserVideo } from '@/types/analyser';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface VideoListProps {
  videos: AnalyserVideo[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  platform: 'tiktok' | 'instagram';
}

export function VideoList({ videos, selectedIds, onSelectionChange, platform }: VideoListProps) {
  const allSelected = videos.length > 0 && selectedIds.length === videos.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < videos.length;

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(videos.map(v => v.id));
    }
  };

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter(i => i !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toLocaleString('pt-BR');
  };

  const formatDate = (dateString: string): string => {
    try {
      return format(new Date(dateString), 'dd/MM/yyyy', { locale: ptBR });
    } catch {
      return dateString;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Video className="h-5 w-5" />
            Vídeos ({videos.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={toggleAll}
              className="gap-2"
            >
              {allSelected ? (
                <CheckSquare className="h-4 w-4" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
            </Button>
            {selectedIds.length > 0 && (
              <Badge variant="secondary">
                {selectedIds.length} selecionado{selectedIds.length > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead className="w-20">Thumb</TableHead>
                <TableHead>Legenda</TableHead>
                <TableHead className="text-center w-24">
                  <div className="flex items-center justify-center gap-1">
                    <Eye className="h-4 w-4" />
                    Views
                  </div>
                </TableHead>
                <TableHead className="text-center w-24">
                  <div className="flex items-center justify-center gap-1">
                    <Heart className="h-4 w-4" />
                    Likes
                  </div>
                </TableHead>
                <TableHead className="text-center w-24">
                  <div className="flex items-center justify-center gap-1">
                    <MessageCircle className="h-4 w-4" />
                    Coment.
                  </div>
                </TableHead>
                <TableHead className="text-center w-28">
                  <div className="flex items-center justify-center gap-1">
                    <Calendar className="h-4 w-4" />
                    Data
                  </div>
                </TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {videos.map((video, index) => (
                <TableRow key={video.id} className="group">
                  <TableCell>
                    <Checkbox 
                      checked={selectedIds.includes(video.id)}
                      onCheckedChange={() => toggleOne(video.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="relative w-16 h-16 rounded-md overflow-hidden bg-muted">
                      {video.thumbnail ? (
                        <img 
                          src={video.thumbnail} 
                          alt={video.caption || 'Video thumbnail'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Video className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-1 text-center">
                        #{index + 1}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="line-clamp-2 text-sm max-w-xs">
                      {video.caption || <span className="text-muted-foreground italic">Sem legenda</span>}
                    </p>
                  </TableCell>
                  <TableCell className="text-center font-medium">
                    {formatNumber(video.views)}
                  </TableCell>
                  <TableCell className="text-center font-medium">
                    {formatNumber(video.likes)}
                  </TableCell>
                  <TableCell className="text-center font-medium">
                    {formatNumber(video.comments)}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {formatDate(video.publishedAt)}
                  </TableCell>
                  <TableCell>
                    {video.permalink && (
                      <Button 
                        variant="ghost" 
                        size="icon"
                        asChild
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <a href={video.permalink} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {videos.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Video className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhum vídeo encontrado</p>
              <p className="text-sm">Ajuste os filtros ou carregue mais vídeos</p>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
