import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Cookie, FileJson, Globe, CheckCircle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TikTokMode = 'cookie' | 'json' | 'scraper';

interface TikTokModeSelectorProps {
  selectedMode: TikTokMode;
  onModeChange: (mode: TikTokMode) => void;
}

const MODES = [
  {
    id: 'cookie' as TikTokMode,
    name: 'Cookie',
    description: 'Use seu cookie do TikTok para autenticar (pode ser bloqueado pelo servidor)',
    icon: Cookie,
    status: 'Pode falhar',
    statusColor: 'bg-yellow-500/10 text-yellow-600',
  },
  {
    id: 'json' as TikTokMode,
    name: 'Importar JSON',
    description: 'Cole os dados exportados de uma extensão como "Sort for TikTok"',
    icon: FileJson,
    status: 'Recomendado',
    statusColor: 'bg-green-500/10 text-green-600',
  },
  {
    id: 'scraper' as TikTokMode,
    name: 'Scraper (Firecrawl)',
    description: 'Use um serviço de scraping profissional para extrair os dados',
    icon: Globe,
    status: 'Requer API',
    statusColor: 'bg-blue-500/10 text-blue-600',
  },
];

export function TikTokModeSelector({ selectedMode, onModeChange }: TikTokModeSelectorProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Escolha o Modo de Captura</CardTitle>
        <CardDescription>
          Selecione como você quer obter os vídeos do TikTok
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const isSelected = selectedMode === mode.id;
            
            return (
              <button
                key={mode.id}
                onClick={() => onModeChange(mode.id)}
                className={cn(
                  'relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all hover:bg-accent',
                  isSelected && 'border-primary bg-primary/5 ring-1 ring-primary'
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <div className={cn(
                    'rounded-md p-2',
                    isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {isSelected && (
                    <CheckCircle className="h-5 w-5 text-primary" />
                  )}
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{mode.name}</span>
                    <Badge variant="secondary" className={cn('text-xs', mode.statusColor)}>
                      {mode.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {mode.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
