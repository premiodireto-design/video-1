import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
// NOTE: Cloud processing is currently disabled because FFmpeg.wasm does not work in Edge Functions (requires Web Workers).
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Settings, Crop, Square, Volume2, Sparkles, Scissors, AtSign, Brain, Cloud } from 'lucide-react';
import type { ProcessingSettings as ProcessingSettingsType } from '@/lib/videoProcessor';

interface ProcessingSettingsProps {
  settings: ProcessingSettingsType;
  onSettingsChange: (settings: ProcessingSettingsType) => void;
  disabled?: boolean;
}

export function ProcessingSettings({ settings, onSettingsChange, disabled }: ProcessingSettingsProps) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Configurações
        </CardTitle>
        <CardDescription>
          Ajuste como os vídeos serão processados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Fit mode */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Modo de enquadramento</Label>
          <RadioGroup
            value={settings.fitMode}
            onValueChange={(value: 'cover' | 'contain') => 
              onSettingsChange({ ...settings, fitMode: value })
            }
            disabled={disabled}
            className="space-y-2"
          >
            <div className="flex items-start space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="cover" id="cover" className="mt-0.5" />
              <div className="flex-1">
                <Label htmlFor="cover" className="flex items-center gap-2 cursor-pointer font-medium">
                  <Crop className="h-4 w-4 text-primary" />
                  Sem bordas (recomendado)
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  O vídeo preenche toda a janela. Pode cortar os lados, mas nunca o topo (preserva cabeças).
                </p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="contain" id="contain" className="mt-0.5" />
              <div className="flex-1">
                <Label htmlFor="contain" className="flex items-center gap-2 cursor-pointer font-medium">
                  <Square className="h-4 w-4 text-primary" />
                  Sem cortes (pode ter bordas)
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  O vídeo inteiro é mostrado. Pode ter bordas pretas se a proporção for diferente.
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>

        {/* Toggle options */}
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-3">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label htmlFor="normalize-audio" className="font-medium cursor-pointer">
                  Normalizar áudio
                </Label>
                <p className="text-xs text-muted-foreground">
                  Iguala o volume entre vídeos diferentes
                </p>
              </div>
            </div>
            <Switch
              id="normalize-audio"
              checked={settings.normalizeAudio}
              onCheckedChange={(checked) => 
                onSettingsChange({ ...settings, normalizeAudio: checked })
              }
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label htmlFor="max-quality" className="font-medium cursor-pointer">
                  Qualidade máxima
                </Label>
                <p className="text-xs text-muted-foreground">
                  Processamento mais lento, melhor qualidade final
                </p>
              </div>
            </div>
            <Switch
              id="max-quality"
              checked={settings.maxQuality}
              onCheckedChange={(checked) => 
                onSettingsChange({ ...settings, maxQuality: checked })
              }
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-3">
              <Scissors className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label htmlFor="remove-bars" className="font-medium cursor-pointer">
                  Remover barras pretas
                </Label>
                <p className="text-xs text-muted-foreground">
                  Remove barras pretas existentes no vídeo (experimental)
                </p>
              </div>
            </div>
            <Switch
              id="remove-bars"
              checked={settings.removeBlackBars}
              onCheckedChange={(checked) => 
                onSettingsChange({ ...settings, removeBlackBars: checked })
              }
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 border-border opacity-60">
            <div className="flex items-center gap-3">
              <Cloud className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label htmlFor="cloud-processing" className="font-medium cursor-not-allowed flex items-center gap-2">
                  Processar na nuvem
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">Em breve</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Indisponível: FFmpeg não funciona em Edge Functions
                </p>
              </div>
            </div>
            <Switch
              id="cloud-processing"
              checked={false}
              disabled={true}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border bg-accent/30 border-primary/30">
            <div className="flex items-center gap-3">
              <Brain className="h-4 w-4 text-primary" />
              <div>
                <Label htmlFor="ai-framing" className="font-medium cursor-pointer">
                  Enquadramento com IA ✨
                </Label>
                <p className="text-xs text-muted-foreground">
                  Detecta rostos e posiciona o vídeo automaticamente
                </p>
              </div>
            </div>
            <Switch
              id="ai-framing"
              checked={settings.useAiFraming ?? false}
              onCheckedChange={(checked) => 
                onSettingsChange({ ...settings, useAiFraming: checked })
              }
              disabled={disabled}
            />
          </div>
        </div>

        {/* Watermark input */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <AtSign className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <Label htmlFor="watermark" className="font-medium">
                Marca d'água (opcional)
              </Label>
              <p className="text-xs text-muted-foreground">
                Digite seu @ para aparecer no vídeo
              </p>
            </div>
          </div>
          <Input
            id="watermark"
            placeholder="@seuarroba"
            value={settings.watermark || ''}
            onChange={(e) => onSettingsChange({ ...settings, watermark: e.target.value })}
            disabled={disabled}
            className="bg-card"
            maxLength={50}
          />
        </div>
        {/* Output specs */}
        <div className="p-3 bg-muted/50 rounded-lg">
          <h4 className="text-sm font-medium mb-2">Especificações de saída</h4>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>• Resolução: 1080x1920</div>
            <div>• FPS: 30</div>
            <div>• Codec: H.264 (libx264)</div>
            <div>• Qualidade: CRF 18</div>
            <div>• Áudio: AAC 192kbps</div>
            <div>• Formato: MP4</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
