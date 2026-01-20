import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Globe, Search, Loader2, AlertCircle, CheckCircle, Key } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { AnalyserVideo } from '@/types/analyser';

interface TikTokScraperModeProps {
  onLoadVideos: (videos: AnalyserVideo[], username: string) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export function TikTokScraperMode({ onLoadVideos, isLoading, setIsLoading }: TikTokScraperModeProps) {
  const [username, setUsername] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('firecrawl_api_key') || '');
  const [error, setError] = useState('');
  const [showApiInput, setShowApiInput] = useState(!apiKey);
  
  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('firecrawl_api_key', key);
    setShowApiInput(false);
  };
  
  const handleScrape = async () => {
    if (!username.trim()) {
      setError('Digite um nome de usuário');
      return;
    }
    
    if (!apiKey) {
      setError('Configure sua API key do Firecrawl primeiro');
      setShowApiInput(true);
      return;
    }
    
    setError('');
    setIsLoading(true);
    
    try {
      // Clean username
      let cleanUsername = username.trim();
      if (cleanUsername.startsWith('@')) cleanUsername = cleanUsername.slice(1);
      const urlMatch = cleanUsername.match(/tiktok\.com\/@([^\/\?]+)/i);
      if (urlMatch) cleanUsername = urlMatch[1];
      
      // Call scraper edge function
      const { data, error: fnError } = await supabase.functions.invoke('tiktok-scraper', {
        body: { 
          username: cleanUsername,
          apiKey,
        },
      });
      
      if (fnError) {
        throw new Error(fnError.message);
      }
      
      if (!data?.success) {
        throw new Error(data?.error || 'Erro ao scrape perfil');
      }
      
      onLoadVideos(data.data.videos, cleanUsername);
    } catch (err: any) {
      console.error('Scrape error:', err);
      setError(err.message || 'Erro ao fazer scrape do perfil');
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Scraper (Firecrawl)
        </CardTitle>
        <CardDescription>
          Use o Firecrawl para extrair dados do TikTok profissionalmente
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showApiInput || !apiKey ? (
          <div className="space-y-4">
            <Alert>
              <Key className="h-4 w-4" />
              <AlertTitle>API Key necessária</AlertTitle>
              <AlertDescription>
                Você precisa de uma API key do Firecrawl para usar este modo.
                <a 
                  href="https://www.firecrawl.dev/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline ml-1"
                >
                  Obter API key →
                </a>
              </AlertDescription>
            </Alert>
            
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Cole sua API key do Firecrawl..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button onClick={() => saveApiKey(apiKey)} disabled={!apiKey.trim()}>
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Alert className="border-green-500/20 bg-green-500/5">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-600">API Key configurada</AlertTitle>
              <AlertDescription className="text-muted-foreground flex items-center justify-between">
                <span>Pronto para fazer scrape de perfis do TikTok</span>
                <Button variant="ghost" size="sm" onClick={() => setShowApiInput(true)}>
                  Alterar
                </Button>
              </AlertDescription>
            </Alert>
            
            <div className="flex gap-2">
              <Input
                placeholder="@usuario ou URL do perfil..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
              />
              <Button onClick={handleScrape} disabled={isLoading || !username.trim()}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span className="ml-2">Scrape</span>
              </Button>
            </div>
          </>
        )}
        
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        <p className="text-xs text-muted-foreground">
          💡 O Firecrawl é um serviço pago de scraping. Consulte os preços em firecrawl.dev
        </p>
      </CardContent>
    </Card>
  );
}
