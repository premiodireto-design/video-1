import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Eye, RefreshCw, Move, Maximize2, Brain, Loader2 } from 'lucide-react';
import { captureVideoFrame, analyzeVideoFrame, getDefaultAnalysis, type FrameAnalysis } from '@/lib/frameAnalyzer';
import type { GreenArea } from '@/lib/greenDetection';
import type { VideoFile } from '@/components/video/VideoUpload';

/**
 * Returns status message based on analysis results
 * Priority: Bordas (borders) first, then Rosto (face)
 */
function getAnalysisStatus(analysis: FrameAnalysis): string {
  const hasBorders = analysis.contentBounds && 
    (analysis.contentBounds.width < 0.99 || 
     analysis.contentBounds.height < 0.99 || 
     analysis.contentBounds.x > 0.01 || 
     analysis.contentBounds.y > 0.01);

  // Show borders detection first (priority)
  if (hasBorders) {
    if (analysis.hasFace) {
      return 'Bordas e rosto detectados!';
    }
    return 'Bordas detectadas!';
  }

  // Then show face detection
  if (analysis.hasFace) {
    return 'Rosto detectado!';
  }

  return 'Análise concluída';
}

interface FramingPreviewProps {
  video: VideoFile | null;
  greenArea: GreenArea | null;
  templateFile: File | null;
  useAiFraming: boolean;
  onContentBoundsChange?: (bounds: { x: number; y: number; width: number; height: number } | null) => void;
}

export function FramingPreview({ 
  video, 
  greenArea, 
  templateFile,
  useAiFraming,
  onContentBoundsChange 
}: FramingPreviewProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualBounds, setManualBounds] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [templateImage, setTemplateImage] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load template image
  useEffect(() => {
    if (!templateFile) {
      setTemplateImage(null);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(templateFile);
    img.onload = () => {
      setTemplateImage(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;

    return () => URL.revokeObjectURL(url);
  }, [templateFile]);

  // Load video
  useEffect(() => {
    if (!video?.file) {
      setVideoElement(null);
      setAnalysis(null);
      return;
    }

    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    const url = URL.createObjectURL(video.file);
    
    vid.onloadeddata = () => {
      vid.currentTime = 0.5; // Skip first 0.5s
    };
    
    vid.onseeked = () => {
      setVideoElement(vid);
    };
    
    vid.src = url;
    vid.load();

    return () => {
      URL.revokeObjectURL(url);
      vid.pause();
      vid.src = '';
    };
  }, [video?.file]);

  // Analyze video with AI
  const analyzeWithAI = useCallback(async () => {
    if (!videoElement) return;

    setIsAnalyzing(true);
    try {
      const frameBase64 = await captureVideoFrame(videoElement);
      const result = await analyzeVideoFrame(frameBase64);
      setAnalysis(result);

      // Update manual bounds from AI detection
      if (result.contentBounds) {
        setManualBounds({
          x: Math.round(result.contentBounds.x * 100),
          y: Math.round(result.contentBounds.y * 100),
          width: Math.round(result.contentBounds.width * 100),
          height: Math.round(result.contentBounds.height * 100),
        });
      }
    } catch (e) {
      console.error('AI analysis failed:', e);
      setAnalysis(getDefaultAnalysis());
    } finally {
      setIsAnalyzing(false);
    }
  }, [videoElement]);

  // Auto-analyze when video loads and AI framing is enabled
  useEffect(() => {
    if (videoElement && useAiFraming && !analysis) {
      analyzeWithAI();
    }
  }, [videoElement, useAiFraming, analysis, analyzeWithAI]);

  // Notify parent of bounds changes
  useEffect(() => {
    if (!onContentBoundsChange) return;

    if (manualMode) {
      onContentBoundsChange({
        x: manualBounds.x / 100,
        y: manualBounds.y / 100,
        width: manualBounds.width / 100,
        height: manualBounds.height / 100,
      });
    } else if (analysis?.contentBounds) {
      onContentBoundsChange(analysis.contentBounds);
    } else {
      onContentBoundsChange(null);
    }
  }, [manualMode, manualBounds, analysis, onContentBoundsChange]);

  // Draw preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoElement || !greenArea) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Preview canvas size (scaled down for display)
    const previewScale = 0.25;
    canvas.width = 1080 * previewScale;
    canvas.height = 1920 * previewScale;

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    const { x, y, width: ww, height: wh } = greenArea;

    // Get content bounds
    let bounds = { x: 0, y: 0, width: 1, height: 1 };
    if (manualMode) {
      bounds = {
        x: manualBounds.x / 100,
        y: manualBounds.y / 100,
        width: manualBounds.width / 100,
        height: manualBounds.height / 100,
      };
    } else if (analysis?.contentBounds) {
      bounds = analysis.contentBounds;
    }

    // Calculate source and destination
    const sourceX = bounds.x * vw;
    const sourceY = bounds.y * vh;
    const sourceWidth = bounds.width * vw;
    const sourceHeight = bounds.height * vh;

    const contentAspect = sourceWidth / sourceHeight;
    const frameAspect = ww / wh;

    let scale: number;
    if (contentAspect > frameAspect) {
      scale = wh / sourceHeight;
    } else {
      scale = ww / sourceWidth;
    }

    const scaledW = sourceWidth * scale;
    const scaledH = sourceHeight * scale;

    // Get anchor from analysis or default
    const anchorX = analysis?.suggestedCrop?.anchorX ?? 0.5;
    const anchorY = analysis?.suggestedCrop?.anchorY ?? 0.15;

    const overflowX = scaledW - ww;
    const overflowY = scaledH - wh;
    const offsetX = -overflowX * anchorX;
    const offsetY = -overflowY * anchorY;

    // Scale everything for preview
    ctx.setTransform(previewScale, 0, 0, previewScale, 0, 0);

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1080, 1920);

    // Draw template if available
    if (templateImage) {
      ctx.drawImage(templateImage, 0, 0, 1080, 1920);
    }

    // Fill green area
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, ww, wh);

    // Clip to green area
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, ww, wh);
    ctx.clip();

    // Draw video (source crop)
    ctx.drawImage(
      videoElement,
      sourceX, sourceY, sourceWidth, sourceHeight,
      x + offsetX, y + offsetY, scaledW, scaledH
    );

    ctx.restore();

    // Draw template on top (for masked effect)
    if (templateImage) {
      // Create mask by redrawing template with green as transparent
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = 1080;
      maskCanvas.height = 1920;
      const maskCtx = maskCanvas.getContext('2d')!;
      maskCtx.drawImage(templateImage, 0, 0, 1080, 1920);
      
      const maskData = maskCtx.getImageData(0, 0, 1080, 1920);
      const pixels = maskData.data;
      const tolerance = 60;
      
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        if (r < tolerance && g > 200 && b < tolerance) {
          pixels[i + 3] = 0;
        }
      }
      maskCtx.putImageData(maskData, 0, 0);
      ctx.drawImage(maskCanvas, 0, 0);
    }

    // Draw content bounds indicator (dotted rectangle on source video area)
    if (bounds.width < 1 || bounds.height < 1 || bounds.x > 0 || bounds.y > 0) {
      // Show indicator in corner
      const indicatorSize = 120;
      const indicatorX = 1080 - indicatorSize - 20;
      const indicatorY = 20;

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(indicatorX, indicatorY, indicatorSize, indicatorSize);

      // Draw video thumbnail
      ctx.drawImage(videoElement, indicatorX + 5, indicatorY + 5, indicatorSize - 10, indicatorSize - 10);

      // Draw detected bounds
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        indicatorX + 5 + bounds.x * (indicatorSize - 10),
        indicatorY + 5 + bounds.y * (indicatorSize - 10),
        bounds.width * (indicatorSize - 10),
        bounds.height * (indicatorSize - 10)
      );
      ctx.setLineDash([]);
    }

  }, [videoElement, greenArea, templateImage, analysis, manualMode, manualBounds]);

  if (!video || !greenArea) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Prévia do Enquadramento
          </CardTitle>
          <CardDescription>
            Faça upload de um template e vídeo para ver a prévia
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Prévia do Enquadramento
        </CardTitle>
        <CardDescription>
          Visualize como o vídeo será enquadrado
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preview Canvas */}
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            className="rounded-lg border shadow-lg max-h-[400px] w-auto"
            style={{ aspectRatio: '9/16' }}
          />
        </div>

        {/* AI Analysis Status */}
        {useAiFraming && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-medium">
                {isAnalyzing ? 'Analisando com IA...' : 
                 !analysis ? 'Aguardando análise...' :
                 getAnalysisStatus(analysis)}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={analyzeWithAI}
              disabled={isAnalyzing || !videoElement}
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}

        {/* Manual Adjustment Toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
          <div className="flex items-center gap-3">
            <Move className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label htmlFor="manual-mode" className="font-medium cursor-pointer">
                Ajuste manual
              </Label>
              <p className="text-xs text-muted-foreground">
                Defina manualmente a área do vídeo
              </p>
            </div>
          </div>
          <Switch
            id="manual-mode"
            checked={manualMode}
            onCheckedChange={setManualMode}
          />
        </div>

        {/* Manual Bounds Sliders */}
        {manualMode && (
          <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
            <div className="space-y-2">
              <Label className="text-xs flex items-center justify-between">
                <span>Posição X (esquerda)</span>
                <span className="text-muted-foreground">{manualBounds.x}%</span>
              </Label>
              <Slider
                value={[manualBounds.x]}
                onValueChange={([v]) => setManualBounds(b => ({ ...b, x: v }))}
                min={0}
                max={50}
                step={1}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs flex items-center justify-between">
                <span>Posição Y (topo)</span>
                <span className="text-muted-foreground">{manualBounds.y}%</span>
              </Label>
              <Slider
                value={[manualBounds.y]}
                onValueChange={([v]) => setManualBounds(b => ({ ...b, y: v }))}
                min={0}
                max={50}
                step={1}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs flex items-center justify-between">
                <span>Largura</span>
                <span className="text-muted-foreground">{manualBounds.width}%</span>
              </Label>
              <Slider
                value={[manualBounds.width]}
                onValueChange={([v]) => setManualBounds(b => ({ ...b, width: v }))}
                min={50}
                max={100}
                step={1}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs flex items-center justify-between">
                <span>Altura</span>
                <span className="text-muted-foreground">{manualBounds.height}%</span>
              </Label>
              <Slider
                value={[manualBounds.height]}
                onValueChange={([v]) => setManualBounds(b => ({ ...b, height: v }))}
                min={50}
                max={100}
                step={1}
              />
            </div>

            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setManualBounds({ x: 0, y: 0, width: 100, height: 100 })}
            >
              <Maximize2 className="h-4 w-4 mr-2" />
              Resetar para vídeo inteiro
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}