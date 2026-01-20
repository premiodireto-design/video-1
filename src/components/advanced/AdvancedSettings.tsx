import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Sparkles, MessageSquare, Volume2, Settings } from 'lucide-react';

export interface AdvancedSettingsType {
  fitMode: 'cover' | 'contain' | 'fill';
  normalizeAudio: boolean;
  maxQuality: boolean;
  removeBlackBars: boolean;
  watermark: string;
  useAiFraming: boolean;
  enableCaptions: boolean;
  captionStyle: 'bottom' | 'center' | 'top';
  enableDubbing: boolean;
  dubbingLanguage: string;
}

interface AdvancedSettingsProps {
  settings: AdvancedSettingsType;
  onSettingsChange: (settings: AdvancedSettingsType) => void;
  disabled?: boolean;
}

export function AdvancedSettings({ settings, onSettingsChange, disabled }: AdvancedSettingsProps) {
  const update = (key: keyof AdvancedSettingsType, value: AdvancedSettingsType[typeof key]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div className="space-y-4">
      {/* AI Features Card */}
      <Card className="border-primary/50 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            Recursos de IA
          </CardTitle>
          <CardDescription>
            Legendas automáticas e dublagem com inteligência artificial
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Captions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="captions" className="cursor-pointer">
                Legendas Automáticas
              </Label>
            </div>
            <Switch
              id="captions"
              checked={settings.enableCaptions}
              onCheckedChange={(checked) => update('enableCaptions', checked)}
              disabled={disabled}
            />
          </div>

          {settings.enableCaptions && (
            <div className="ml-6 space-y-2">
              <Label className="text-sm text-muted-foreground">Posição das legendas</Label>
              <Select
                value={settings.captionStyle}
                onValueChange={(value: 'bottom' | 'center' | 'top') => update('captionStyle', value)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bottom">Inferior</SelectItem>
                  <SelectItem value="center">Centro</SelectItem>
                  <SelectItem value="top">Superior</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Dubbing */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="dubbing" className="cursor-pointer">
                Dublagem em Português
              </Label>
            </div>
            <Switch
              id="dubbing"
              checked={settings.enableDubbing}
              onCheckedChange={(checked) => update('enableDubbing', checked)}
              disabled={disabled}
            />
          </div>

          {settings.enableDubbing && (
            <div className="ml-6 space-y-2">
              <Label className="text-sm text-muted-foreground">Idioma da dublagem</Label>
              <Select
                value={settings.dubbingLanguage}
                onValueChange={(value) => update('dubbingLanguage', value)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                  <SelectItem value="pt-PT">Português (Portugal)</SelectItem>
                  <SelectItem value="es-ES">Espanhol</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Video Settings Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Settings className="h-5 w-5" />
            Configurações de Vídeo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Modo de ajuste</Label>
            <Select
              value={settings.fitMode}
              onValueChange={(value: 'cover' | 'contain' | 'fill') => update('fitMode', value)}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">Cobrir (recomendado)</SelectItem>
                <SelectItem value="contain">Conter</SelectItem>
                <SelectItem value="fill">Esticar</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="aiFraming" className="cursor-pointer">
              AI Framing (enquadramento inteligente)
            </Label>
            <Switch
              id="aiFraming"
              checked={settings.useAiFraming}
              onCheckedChange={(checked) => update('useAiFraming', checked)}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="maxQuality" className="cursor-pointer">
              Qualidade máxima
            </Label>
            <Switch
              id="maxQuality"
              checked={settings.maxQuality}
              onCheckedChange={(checked) => update('maxQuality', checked)}
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="watermark">Marca d'água (opcional)</Label>
            <Input
              id="watermark"
              placeholder="@seuusuario"
              value={settings.watermark}
              onChange={(e) => update('watermark', e.target.value)}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
