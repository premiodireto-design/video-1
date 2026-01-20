import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileJson, Upload, CheckCircle, AlertCircle, Chrome } from 'lucide-react';
import { ExtensionDownloader } from './ExtensionDownloader';
import type { AnalyserVideo } from '@/types/analyser';

interface TikTokJsonImportProps {
  onImport: (videos: AnalyserVideo[], username: string) => void;
  isLoading: boolean;
}

function parseJsonInput(jsonText: string): { videos: AnalyserVideo[]; username: string } | null {
  try {
    const data = JSON.parse(jsonText);
    
    // Handle array directly or object with videos
    const items = Array.isArray(data) ? data : data.videos || data.items || data.itemList || [];
    const extractedUsername = data.username || '';
    
    if (!items.length) return null;
    
    const videos: AnalyserVideo[] = [];
    let username = extractedUsername;
    
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

  const handleDownloadExtension = () => {
    // Create a zip file with the extension
    window.open('/extensions/tiktok-extractor/', '_blank');
  };
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <FileJson className="h-5 w-5" />
          Importar JSON
        </CardTitle>
        <CardDescription>
          Use nossa extensão gratuita para extrair dados do TikTok
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Extension download section */}
        <div className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg border border-primary/20">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary/20 p-2">
              <Chrome className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 space-y-2">
              <p className="font-medium text-sm">TikTok Video Extractor</p>
              <p className="text-xs text-muted-foreground">
                Extensão gratuita para Chrome que extrai todos os vídeos de um perfil do TikTok com métricas completas.
              </p>
              <div className="flex gap-2 pt-1">
                <ExtensionDownloader />
              </div>
            </div>
          </div>
        </div>

        <div className="text-sm text-muted-foreground space-y-2 p-4 bg-muted/50 rounded-lg">
          <p className="font-medium">Como usar:</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Baixe e extraia o arquivo ZIP da extensão</li>
            <li>Abra <code className="bg-muted px-1 rounded">chrome://extensions</code> no Chrome</li>
            <li>Ative o "Modo do desenvolvedor" no canto superior direito</li>
            <li>Clique em "Carregar sem compactação" e selecione a pasta extraída</li>
            <li>Acesse um perfil do TikTok e clique no ícone da extensão</li>
            <li>Clique em "Extrair Vídeos" e depois "Copiar JSON"</li>
            <li>Cole o JSON aqui!</li>
          </ol>
        </div>
        
        <Textarea
          placeholder='Cole o JSON aqui... Ex: {"username": "...", "videos": [...]}'
          value={jsonText}
          onChange={(e) => handleTextChange(e.target.value)}
          className="min-h-[120px] font-mono text-sm"
        />
        
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {parsedCount !== null && parsedCount > 0 && (
          <Alert className="border-primary/20 bg-primary/5">
            <CheckCircle className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">JSON válido</AlertTitle>
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
