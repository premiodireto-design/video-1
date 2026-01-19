import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LogIn, LogOut, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface AuthSectionProps {
  platform: 'tiktok' | 'instagram';
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  isLoading: boolean;
}

export function AuthSection({ 
  platform, 
  isConnected, 
  onConnect, 
  onDisconnect, 
  isLoading 
}: AuthSectionProps) {
  const platformConfig = {
    tiktok: {
      title: 'Conectar TikTok',
      description: 'Faça login com sua conta TikTok para acessar seus vídeos',
      connectText: 'Conectar com TikTok',
      connectedText: 'Conta TikTok conectada',
      warning: 'A API oficial do TikTok requer aprovação prévia do app. Se a conexão não funcionar, use o "Modo Upload" para carregar seus vídeos exportados.',
    },
    instagram: {
      title: 'Conectar Instagram',
      description: 'Faça login com sua conta Instagram Business/Creator via Facebook',
      connectText: 'Conectar com Instagram',
      connectedText: 'Conta Instagram conectada',
      warning: 'Requer conta Business ou Creator vinculada a uma página do Facebook. Use o "Modo Upload" se não tiver esse tipo de conta.',
    },
  };

  const config = platformConfig[platform];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isConnected ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : (
            <LogIn className="h-5 w-5" />
          )}
          {config.title}
        </CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isConnected && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{config.warning}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3">
          {isConnected ? (
            <>
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                {config.connectedText}
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onDisconnect}
                disabled={isLoading}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Desconectar
              </Button>
            </>
          ) : (
            <Button onClick={onConnect} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4 mr-2" />
              )}
              {config.connectText}
            </Button>
          )}
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Passos para conectar:</strong></p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Clique em "Conectar"</li>
            <li>Faça login na sua conta {platform === 'tiktok' ? 'TikTok' : 'Facebook/Instagram'}</li>
            <li>Permita o acesso aos dados solicitados</li>
            <li>Aguarde o redirecionamento de volta</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
