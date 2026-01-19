import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2, User, X, RefreshCw } from 'lucide-react';

interface ProfileInputProps {
  platform: 'tiktok' | 'instagram';
  onLoadVideos: (username: string, limit: number) => Promise<void>;
  isLoading: boolean;
  loadedUsername?: string;
  onClear?: () => void;
}

const LIMIT_OPTIONS = [
  { value: '20', label: '20 vídeos' },
  { value: '50', label: '50 vídeos' },
  { value: '100', label: '100 vídeos' },
  { value: '200', label: '200 vídeos' },
  { value: '500', label: '500 vídeos' },
];

export function ProfileInput({ 
  platform, 
  onLoadVideos, 
  isLoading, 
  loadedUsername,
  onClear 
}: ProfileInputProps) {
  const [username, setUsername] = useState('');
  const [limit, setLimit] = useState('50');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      await onLoadVideos(username.trim(), parseInt(limit));
    }
  };

  const handleRefresh = async () => {
    if (loadedUsername) {
      await onLoadVideos(loadedUsername, parseInt(limit));
    }
  };

  const handleClear = () => {
    setUsername('');
    onClear?.();
  };

  const placeholder = platform === 'tiktok' 
    ? '@usuario ou https://tiktok.com/@usuario'
    : '@usuario ou https://instagram.com/usuario';

  const platformColor = platform === 'instagram' 
    ? 'from-pink-500 to-purple-600' 
    : 'from-black to-gray-800';

  return (
    <Card className="overflow-hidden">
      <div className={`h-1 bg-gradient-to-r ${platformColor}`} />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Carregar Perfil
          {loadedUsername && (
            <span className="text-sm font-normal text-muted-foreground">
              — @{loadedUsername}
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Digite o @ ou URL do perfil público para carregar os vídeos
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <Input 
              placeholder={placeholder}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
            />
          </div>
          
          <Select value={limit} onValueChange={setLimit} disabled={isLoading}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Limite" />
            </SelectTrigger>
            <SelectContent>
              {LIMIT_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            <Button type="submit" disabled={isLoading || !username.trim()}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Carregar
            </Button>
            
            {loadedUsername && (
              <>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="icon"
                  onClick={handleRefresh}
                  disabled={isLoading}
                  title="Recarregar"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="icon"
                  onClick={handleClear}
                  disabled={isLoading}
                  title="Limpar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
