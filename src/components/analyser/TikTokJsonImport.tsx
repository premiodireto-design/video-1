import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileJson, Upload, CheckCircle, AlertCircle, ExternalLink, Copy } from 'lucide-react';
import type { AnalyserVideo } from '@/types/analyser';

interface TikTokJsonImportProps {
  onImport: (videos: AnalyserVideo[], username: string) => void;
  isLoading: boolean;
}

function parseJsonInput(jsonText: string): { videos: AnalyserVideo[]; username: string } | null {
  try {
    const data = JSON.parse(jsonText);
    
    // Handle array directly
    const items = Array.isArray(data) ? data : data.videos || data.items || data.itemList || [];
    
    if (!items.length) return null;
    
    const videos: AnalyserVideo[] = [];
    let username = '';
    
    for (const item of items) {
      // Try to extract username from first item
      if (!username) {
        username = item.author?.uniqueId || item.author?.unique_id || item.authorMeta?.name || 
                   item.username || item.user || 'unknown';
      }
      
      const id = item.id || item.aweme_id || item.video_id || String(Date.now() + Math.random());
      
      // Stats can be in many places
      const stats = item.stats || item.statistics || item.statsV2 || {};
      const views = Number(stats.playCount || stats.play_count || item.playCount || item.views || 0);
      const likes = Number(stats.diggCount || stats.digg_count || item.diggCount || item.likes || 0);
      const comments = Number(stats.commentCount || stats.comment_count || item.commentCount || item.comments || 0);
      const shares = Number(stats.shareCount || stats.share_count || item.shareCount || item.shares || 0);
      const saves = Number(stats.collectCount || stats.collect_count || item.collectCount || item.saves || item.bookmarks || 0);
      
      // Thumbnail
      const thumbnail = item.video?.cover || item.video?.dynamicCover || item.thumbnail || 
                        item.cover || item.image || '';
      
      // Description
      const caption = item.desc || item.description || item.caption || item.title || '';
      
      // Timestamp
      let createTime = item.createTime || item.create_time || item.timestamp;
      const publishedAt = createTime 
        ? new Date(typeof createTime === 'number' && createTime < 10000000000 ? createTime * 1000 : createTime).toISOString()
        : new Date().toISOString();
      
      // Permalink
      const authorId = item.author?.uniqueId || item.author?.unique_id || username;
      const permalink = item.permalink || item.url || item.link || 
                        `https://www.tiktok.com/@${authorId}/video/${id}`;
      
      videos.push({
        id: String(id),
        platform: 'tiktok',
        thumbnail,
        caption,
        publishedAt,
        views,
        likes,
        comments,
        shares,
        saves,
        permalink,
        videoUrl: item.video?.downloadAddr || item.video?.playAddr || '',
        downloadable: true,
      });
    }
    
    return { videos, username };
  } catch (err) {
    console.error('JSON parse error:', err);
    return null;
  }
}

export function TikTokJsonImport({ onImport, isLoading }: TikTokJsonImportProps) {
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState('');
  const [parsedCount, setParsedCount] = useState<number | null>(null);
  
  const handleTextChange = (text: string) => {
    setJsonText(text);
    setError('');
    setParsedCount(null);
    
    if (text.trim()) {
      const result = parseJsonInput(text);
      if (result) {
        setParsedCount(result.videos.length);
      } else {
        setError('Formato JSON inválido. Verifique se copiou corretamente.');
      }
    }
  };
  
  const handleImport = () => {
    const result = parseJsonInput(jsonText);
    if (result && result.videos.length > 0) {
      onImport(result.videos, result.username);
      setJsonText('');
      setParsedCount(null);
    } else {
      setError('Nenhum vídeo encontrado no JSON.');
    }
  };
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <FileJson className="h-5 w-5" />
          Importar JSON
        </CardTitle>
        <CardDescription>
          Cole os dados JSON exportados de uma extensão ou ferramenta
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground space-y-2 p-4 bg-muted/50 rounded-lg">
          <p className="font-medium">Como obter os dados:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Instale uma extensão como "Sort for TikTok" no Chrome</li>
            <li>Acesse o perfil desejado no TikTok</li>
            <li>A extensão vai mostrar os vídeos com métricas</li>
            <li>Use a função de exportar/copiar da extensão</li>
            <li>Cole o JSON aqui</li>
          </ol>
          <p className="text-xs mt-2">
            💡 Alternativamente, abra o DevTools (F12), vá em Network, busque por "item_list" e copie a resposta JSON.
          </p>
        </div>
        
        <Textarea
          placeholder='Cole o JSON aqui... Ex: [{"id": "123", "desc": "...", "stats": {...}}]'
          value={jsonText}
          onChange={(e) => handleTextChange(e.target.value)}
          className="min-h-[150px] font-mono text-sm"
        />
        
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {parsedCount !== null && parsedCount > 0 && (
          <Alert className="border-green-500/20 bg-green-500/5">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-600">JSON válido</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              {parsedCount} vídeos encontrados e prontos para importar
            </AlertDescription>
          </Alert>
        )}
        
        <Button 
          onClick={handleImport} 
          disabled={!parsedCount || isLoading}
          className="w-full"
        >
          <Upload className="h-4 w-4 mr-2" />
          Importar {parsedCount ? `${parsedCount} vídeos` : 'Vídeos'}
        </Button>
      </CardContent>
    </Card>
  );
}
