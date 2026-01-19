import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Key, CheckCircle, AlertCircle, Eye, EyeOff, Info, ExternalLink } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface CookieInputProps {
  platform: 'instagram' | 'tiktok';
  onCookieChange?: (hasCookie: boolean) => void;
}

const STORAGE_KEY_IG = 'analyser_ig_cookie';
const STORAGE_KEY_TT = 'analyser_tt_cookie';

export function getCookie(platform: 'instagram' | 'tiktok'): string {
  const key = platform === 'instagram' ? STORAGE_KEY_IG : STORAGE_KEY_TT;
  return localStorage.getItem(key) || '';
}

export function CookieInput({ platform, onCookieChange }: CookieInputProps) {
  const storageKey = platform === 'instagram' ? STORAGE_KEY_IG : STORAGE_KEY_TT;
  
  const [cookie, setCookie] = useState('');
  const [savedCookie, setSavedCookie] = useState('');
  const [showCookie, setShowCookie] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  
  useEffect(() => {
    const stored = localStorage.getItem(storageKey) || '';
    setSavedCookie(stored);
    setCookie(stored);
    onCookieChange?.(!!stored);
  }, [storageKey, onCookieChange]);
  
  const handleSave = () => {
    if (cookie.trim()) {
      localStorage.setItem(storageKey, cookie.trim());
      setSavedCookie(cookie.trim());
      onCookieChange?.(true);
    }
  };
  
  const handleClear = () => {
    localStorage.removeItem(storageKey);
    setCookie('');
    setSavedCookie('');
    onCookieChange?.(false);
  };
  
  const platformName = platform === 'instagram' ? 'Instagram' : 'TikTok';
  const platformColor = platform === 'instagram' 
    ? 'from-pink-500 to-purple-600' 
    : 'from-black to-gray-800';
  
  const hasSavedCookie = !!savedCookie;
  
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 bg-gradient-to-r ${platformColor}`} />
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Autenticação {platformName}
          {hasSavedCookie && (
            <CheckCircle className="h-4 w-4 text-green-500" />
          )}
        </CardTitle>
        <CardDescription>
          Cole seu cookie do {platformName} para acessar os vídeos do perfil
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasSavedCookie ? (
          <Alert className="border-primary/20 bg-primary/5">
            <CheckCircle className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">Cookie configurado</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Você está autenticado. Os dados do {platformName} serão carregados normalmente.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-destructive/20 bg-destructive/5">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <AlertTitle className="text-destructive">Cookie necessário</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Para carregar todos os vídeos de um perfil, você precisa configurar seu cookie do {platformName}.
            </AlertDescription>
          </Alert>
        )}
        
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              {hasSavedCookie ? 'Alterar cookie' : 'Configurar cookie'}
              <Info className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="text-sm text-muted-foreground space-y-2 p-4 bg-muted/50 rounded-lg">
              <p className="font-medium">Como obter o cookie:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Acesse <a href={`https://www.${platform}.com`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                  {platformName} <ExternalLink className="h-3 w-3" />
                </a> e faça login na sua conta</li>
                <li>Abra as ferramentas de desenvolvedor (F12)</li>
                <li>Vá em <code className="bg-muted px-1 rounded">Rede</code> (Network)</li>
                <li>Atualize a página e clique em qualquer requisição</li>
                <li>Copie o valor do cabeçalho <code className="bg-muted px-1 rounded">Cookie</code></li>
              </ol>
            </div>
            
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input 
                  type={showCookie ? 'text' : 'password'}
                  placeholder="Cole seu cookie aqui..."
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowCookie(!showCookie)}
                >
                  {showCookie ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <Button onClick={handleSave} disabled={!cookie.trim()}>
                Salvar
              </Button>
              {hasSavedCookie && (
                <Button variant="destructive" onClick={handleClear}>
                  Limpar
                </Button>
              )}
            </div>
            
            <p className="text-xs text-muted-foreground">
              ⚠️ O cookie fica salvo apenas no seu navegador e não é enviado para nossos servidores permanentemente.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
