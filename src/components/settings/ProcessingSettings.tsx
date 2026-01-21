import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Settings, Crop, Square, Volume2, Sparkles, Scissors, AtSign, Brain, Gauge, Play, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import type { ProcessingSettings as ProcessingSettingsType } from '@/lib/videoProcessor';
import { runFluidityTest, type FluidityTestResult, type FluidityTestProgress } from '@/lib/fluidityTest';

interface ProcessingSettingsProps {
  settings: ProcessingSettingsType;
  onSettingsChange: (settings: ProcessingSettingsType) => void;
  disabled?: boolean;
  testVideoFile?: File | null;
}

export function ProcessingSettings({ settings, onSettingsChange, disabled, testVideoFile }: ProcessingSettingsProps) {
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testProgress, setTestProgress] = useState<FluidityTestProgress | null>(null);
  const [testResult, setTestResult] = useState<FluidityTestResult | null>(null);

  const handleRunFluidityTest = async () => {
    if (!testVideoFile || isTestRunning) return;

    setIsTestRunning(true);
    setTestResult(null);
    setTestProgress({ stage: 'preparing', progress: 0, message: 'Iniciando teste...' });

    try {
      const result = await runFluidityTest(testVideoFile, (progress) => {
        setTestProgress(progress);
      });
      setTestResult(result);

      // Auto-apply recommended settings
      onSettingsChange({
        ...settings,
        useOriginalFps: true,
        maxQuality: result.quality === 'excellent',
      });
    } catch (error) {
      console.error('Fluidity test failed:', error);
      setTestProgress({ stage: 'done', progress: 100, message: 'Erro no teste' });
    } finally {
      setIsTestRunning(false);
    }
  };

  const getQualityIcon = (quality: string) => {
    switch (quality) {
      case 'excellent':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'good':
        return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
      case 'fair':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'poor':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return null;
    }
  };

  const getQualityLabel = (quality: string) => {
    switch (quality) {
      case 'excellent':
        return 'Excelente';
      case 'good':
        return 'Bom';
      case 'fair':
        return 'Regular';
      case 'poor':
        return 'Fraco';
      default:
        return quality;
    }
  };

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
        {/* Fluidity Test Section */}
        <div className="p-4 rounded-lg border bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
          <div className="flex items-center gap-3 mb-3">
            <Gauge className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <h4 className="font-medium">Teste de Fluidez</h4>
              <p className="text-xs text-muted-foreground">
                Analisa seu PC e recomenda as melhores configurações
              </p>
            </div>
          </div>

          {!testVideoFile ? (
            <p className="text-xs text-muted-foreground italic">
              Adicione um vídeo para habilitar o teste
            </p>
          ) : isTestRunning ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm">{testProgress?.message}</span>
              </div>
              <Progress value={testProgress?.progress ?? 0} className="h-2" />
            </div>
          ) : testResult ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {getQualityIcon(testResult.quality)}
                <span className="font-medium">Desempenho: {getQualityLabel(testResult.quality)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 bg-background/50 rounded">
                  <span className="text-muted-foreground">FPS Original:</span>
                  <span className="ml-1 font-medium">{testResult.originalFps}</span>
                </div>
                <div className="p-2 bg-background/50 rounded">
                  <span className="text-muted-foreground">FPS Recomendado:</span>
                  <span className="ml-1 font-medium">{testResult.recommendedFps}</span>
                </div>
                <div className="p-2 bg-background/50 rounded">
                  <span className="text-muted-foreground">Frames Perdidos:</span>
                  <span className="ml-1 font-medium">{testResult.droppedFrames}</span>
                </div>
                <div className="p-2 bg-background/50 rounded">
                  <span className="text-muted-foreground">Taxa de Perda:</span>
                  <span className="ml-1 font-medium">{testResult.dropRate}%</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRunFluidityTest}
                disabled={disabled}
                className="w-full"
              >
                <Play className="h-4 w-4 mr-2" />
                Testar Novamente
              </Button>
            </div>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={handleRunFluidityTest}
              disabled={disabled}
              className="w-full"
            >
              <Play className="h-4 w-4 mr-2" />
              Iniciar Teste (3s)
            </Button>
          )}
        </div>

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
          {/* Original FPS toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border-emerald-500/30">
            <div className="flex items-center gap-3">
              <Gauge className="h-4 w-4 text-emerald-500" />
              <div>
                <Label htmlFor="original-fps" className="font-medium cursor-pointer">
                  Manter FPS do Original
                </Label>
                <p className="text-xs text-muted-foreground">
                  Exporta no mesmo FPS do vídeo fonte (24/30/60)
                </p>
              </div>
            </div>
            <Switch
              id="original-fps"
              checked={settings.useOriginalFps ?? false}
              onCheckedChange={(checked) => 
                onSettingsChange({ ...settings, useOriginalFps: checked })
              }
              disabled={disabled}
            />
          </div>

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

          <div className="flex items-center justify-between p-3 rounded-lg border bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-purple-500/30">
            <div className="flex items-center gap-3">
              <Brain className="h-4 w-4 text-purple-500" />
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
            <div>• FPS: {settings.useOriginalFps ? 'Original' : (settings.maxQuality ? '60' : '30')}</div>
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
