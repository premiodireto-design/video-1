import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, Loader2, User } from 'lucide-react';

interface ProfileInputProps {
  platform: 'tiktok' | 'instagram';
  onLoadVideos: (username: string) => Promise<void>;
  isLoading: boolean;
}

export function ProfileInput({ platform, onLoadVideos, isLoading }: ProfileInputProps) {
  const [username, setUsername] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      await onLoadVideos(username.trim());
    }
  };

  const placeholder = platform === 'tiktok' 
    ? '@usuario ou https://tiktok.com/@usuario'
    : '@usuario ou https://instagram.com/usuario';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Carregar Vídeos
        </CardTitle>
        <CardDescription>
          Digite o nome de usuário ou URL do perfil para carregar os vídeos
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex gap-3">
          <Input 
            placeholder={placeholder}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="flex-1"
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading || !username.trim()}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Carregar Vídeos
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
