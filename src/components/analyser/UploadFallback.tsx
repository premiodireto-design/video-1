import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Upload, 
  FolderOpen, 
  FileJson, 
  FileSpreadsheet, 
  Info,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import type { AnalyserVideo } from '@/types/analyser';

interface UploadFallbackProps {
  platform: 'tiktok' | 'instagram';
  onVideosLoaded: (videos: AnalyserVideo[]) => void;
  videos: AnalyserVideo[];
}

export function UploadFallback({ platform, onVideosLoaded, videos }: UploadFallbackProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [metricsFile, setMetricsFile] = useState<File | null>(null);

  const handleVideoFilesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const videoFilesOnly = files.filter(f => 
      f.type.startsWith('video/') || f.name.endsWith('.mp4') || f.name.endsWith('.mov')
    );
    setVideoFiles(videoFilesOnly);
  }, []);

  const handleMetricsFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.name.endsWith('.json') || file.name.endsWith('.csv'))) {
      setMetricsFile(file);
    }
  }, []);

  const parseMetricsFile = async (file: File): Promise<Record<string, Partial<AnalyserVideo>>> => {
    const text = await file.text();
    const metrics: Record<string, Partial<AnalyserVideo>> = {};

    try {
      if (file.name.endsWith('.json')) {
        const data = JSON.parse(text);
        // Handle various JSON structures
        const items = Array.isArray(data) ? data : data.videos || data.items || data.data || [];
        items.forEach((item: any) => {
          const id = item.id || item.video_id || item.videoId;
          if (id) {
            metrics[id] = {
              views: item.views || item.view_count || item.playCount || 0,
              likes: item.likes || item.like_count || item.digg_count || item.likeCount || 0,
              comments: item.comments || item.comment_count || item.commentCount || 0,
              shares: item.shares || item.share_count || item.shareCount || 0,
              caption: item.caption || item.description || item.desc || '',
              publishedAt: item.published_at || item.create_time || item.timestamp || new Date().toISOString(),
            };
          }
        });
      } else if (file.name.endsWith('.csv')) {
        const lines = text.split('\n');
        const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => {
            row[h] = values[idx] || '';
          });
          
          const id = row.id || row.video_id || row.videoid;
          if (id) {
            metrics[id] = {
              views: parseInt(row.views || row.view_count || '0') || 0,
              likes: parseInt(row.likes || row.like_count || '0') || 0,
              comments: parseInt(row.comments || row.comment_count || '0') || 0,
              shares: parseInt(row.shares || row.share_count || '0') || 0,
              caption: row.caption || row.description || '',
              publishedAt: row.published_at || row.date || new Date().toISOString(),
            };
          }
        }
      }
    } catch (error) {
      console.error('Error parsing metrics file:', error);
    }

    return metrics;
  };

  const processFiles = async () => {
    if (videoFiles.length === 0) return;

    setIsProcessing(true);

    try {
      let metrics: Record<string, Partial<AnalyserVideo>> = {};
      
      if (metricsFile) {
        metrics = await parseMetricsFile(metricsFile);
      }

      const videos: AnalyserVideo[] = videoFiles.map((file, index) => {
        // Try to extract ID from filename
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        const possibleId = nameWithoutExt.split('-').pop() || nameWithoutExt;
        const fileMetrics = metrics[possibleId] || metrics[nameWithoutExt] || {};

        return {
          id: possibleId || `upload-${index}`,
          platform,
          thumbnail: '', // Will be generated from video if needed
          caption: fileMetrics.caption || nameWithoutExt,
          publishedAt: fileMetrics.publishedAt || new Date().toISOString(),
          views: fileMetrics.views || 0,
          likes: fileMetrics.likes || 0,
          comments: fileMetrics.comments || 0,
          shares: fileMetrics.shares || 0,
          permalink: '',
          videoUrl: URL.createObjectURL(file),
          downloadable: true, // User owns these files
          localFile: file,
        };
      });

      onVideosLoaded(videos);
    } catch (error) {
      console.error('Error processing files:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Modo Upload
        </CardTitle>
        <CardDescription>
          Carregue seus próprios vídeos e métricas exportadas para organizar e filtrar
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Use este modo quando você possui os vídeos localmente. Você pode exportar dados do {platform === 'tiktok' ? 'TikTok' : 'Instagram'} 
            através das configurações da sua conta e carregar aqui junto com os vídeos.
          </AlertDescription>
        </Alert>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Video Files */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              Arquivos de Vídeo
            </Label>
            <Input 
              type="file"
              multiple
              accept="video/*,.mp4,.mov,.avi,.webm"
              onChange={handleVideoFilesChange}
              className="cursor-pointer"
            />
            {videoFiles.length > 0 && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                {videoFiles.length} vídeo{videoFiles.length > 1 ? 's' : ''} selecionado{videoFiles.length > 1 ? 's' : ''}
              </p>
            )}
          </div>

          {/* Metrics File */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <FileJson className="h-4 w-4" />
              Arquivo de Métricas (opcional)
            </Label>
            <Input 
              type="file"
              accept=".json,.csv"
              onChange={handleMetricsFileChange}
              className="cursor-pointer"
            />
            {metricsFile && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                {metricsFile.name}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Aceita JSON ou CSV com colunas: id, views, likes, comments, caption, date
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button 
            onClick={processFiles}
            disabled={videoFiles.length === 0 || isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Carregar {videoFiles.length} Vídeo{videoFiles.length !== 1 ? 's' : ''}
          </Button>
        </div>

        {videos.length > 0 && (
          <Alert className="bg-green-500/10 border-green-500/20">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertDescription className="text-green-700 dark:text-green-300">
              {videos.length} vídeo{videos.length > 1 ? 's' : ''} carregado{videos.length > 1 ? 's' : ''} com sucesso!
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
