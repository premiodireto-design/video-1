import React, { useEffect, useState } from 'react';
import { Tutorial } from './components/Tutorial';

interface GPUInfo {
  hasNvidia: boolean;
  hasIntelQSV: boolean;
  hasAMD: boolean;
  recommendedEncoder: string;
  availableEncoders: string[];
}

interface GreenArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VideoItem {
  path: string;
  name: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress: number;
  speed?: string;
  fps?: number;
  error?: string;
}

export default function App() {
  const [gpuInfo, setGpuInfo] = useState<GPUInfo | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [greenArea, setGreenArea] = useState<GreenArea | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [outputFolder, setOutputFolder] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [useGPU, setUseGPU] = useState(true);
  const [useAiFraming, setUseAiFraming] = useState(true);
  const [quality, setQuality] = useState<'fast' | 'balanced' | 'quality'>('balanced');
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    // Detect GPU on mount
    window.electronAPI.detectGPU().then(setGpuInfo);

    // Listen for progress updates
    const unsubscribe = window.electronAPI.onVideoProgress((progress) => {
      setVideos((prev) =>
        prev.map((v) =>
          v.path === progress.videoPath
            ? {
                ...v,
                status: progress.stage === 'done' ? 'done' : progress.stage === 'error' ? 'error' : 'processing',
                progress: progress.progress,
                speed: progress.speed,
                fps: progress.fps,
                error: progress.stage === 'error' ? progress.message : undefined,
              }
            : v
        )
      );
    });

    return unsubscribe;
  }, []);

  const handleSelectVideos = async () => {
    const paths = await window.electronAPI.selectVideos();
    const newVideos = paths.map((path) => ({
      path,
      name: path.split(/[/\\]/).pop() || path,
      status: 'queued' as const,
      progress: 0,
    }));
    setVideos((prev) => [...prev, ...newVideos]);
  };

  const handleSelectTemplate = async () => {
    const result = await window.electronAPI.selectTemplate();
    if (result) {
      setTemplate(result.path);
      
      if (result.detection.success && result.detection.area) {
        setGreenArea(result.detection.area);
        setDetectionError(null);
        console.log('[App] ✓ Green area detected:', result.detection.area);
      } else {
        setGreenArea(null);
        setDetectionError(result.detection.error || 'Falha ao detectar área verde');
        console.warn('[App] ✗ Green area detection failed:', result.detection.error);
      }
    }
  };

  const handleSelectOutput = async () => {
    const path = await window.electronAPI.selectOutputFolder();
    if (path) setOutputFolder(path);
  };

  const handleProcess = async () => {
    if (!template || !outputFolder || videos.length === 0 || !greenArea) return;

    setIsProcessing(true);

    for (const video of videos) {
      if (video.status !== 'queued') continue;

      const outputPath = `${outputFolder}/${video.name.replace(/\.[^/.]+$/, '')}_processed.mp4`;

      setVideos((prev) =>
        prev.map((v) =>
          v.path === video.path ? { ...v, status: 'processing', progress: 0 } : v
        )
      );

      try {
        await window.electronAPI.processVideo({
          videoPath: video.path,
          templatePath: template,
          outputPath,
          greenArea,
          settings: {
            useGPU,
            encoder: gpuInfo?.recommendedEncoder || 'libx264',
            quality,
            trimStart: 0.5,
            trimEnd: 0.5,
            useAiFraming, // Pass AI framing setting
          },
        });
      } catch (error) {
        console.error('Processing error:', error);
      }
    }

    setIsProcessing(false);
  };

  const getGPULabel = () => {
    if (!gpuInfo) return '🔄 Detectando...';
    
    // Show all available encoders
    const available: string[] = [];
    if (gpuInfo.hasNvidia) available.push('NVIDIA');
    if (gpuInfo.hasIntelQSV) available.push('Intel');
    if (gpuInfo.hasAMD) available.push('AMD');
    
    if (available.length === 0) {
      return '⚪ CPU (sem GPU compatível)';
    }
    
    // Show primary (will be used) and any alternatives
    const primary = available[0];
    const icon = primary === 'NVIDIA' ? '🟢' : primary === 'Intel' ? '🔵' : '🔴';
    
    if (available.length === 1) {
      return `${icon} ${primary}`;
    }
    
    return `${icon} ${primary} (+${available.slice(1).join(', ')})`;
  };

  const hasAnyGPU = gpuInfo && (gpuInfo.hasNvidia || gpuInfo.hasIntelQSV || gpuInfo.hasAMD);

  const completedCount = videos.filter((v) => v.status === 'done').length;
  const queuedCount = videos.filter((v) => v.status === 'queued').length;

  return (
    <div className="min-h-screen p-6">
      {/* Tutorial Modal */}
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}

      {/* Header */}
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-primary">VideoTemplate Pro</h1>
          <p className="text-muted-foreground">Processamento ultra-rápido com GPU</p>
        </div>
        <button
          onClick={() => setShowTutorial(true)}
          className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          📚 Tutorial
        </button>
      </header>

      {/* GPU Info */}
      <div className="mb-6 p-4 bg-muted rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-muted-foreground">Encoder: </span>
            <span className="font-medium">{getGPULabel()}</span>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useGPU}
              onChange={(e) => setUseGPU(e.target.checked)}
              className="w-4 h-4"
              disabled={!hasAnyGPU}
            />
            <span className="text-sm">
              {hasAnyGPU ? 'Usar GPU' : 'GPU não detectada'}
            </span>
          </label>
          <label className="flex items-center gap-2 ml-4">
            <input
              type="checkbox"
              checked={useAiFraming}
              onChange={(e) => setUseAiFraming(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm">🧠 IA Framing</span>
          </label>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Template */}
        <div
          className={`drop-zone cursor-pointer ${detectionError ? 'border-destructive' : ''}`}
          onClick={handleSelectTemplate}
        >
          {template ? (
            <div>
              {greenArea ? (
                <>
                  <p className="text-primary font-medium">✓ Template detectado</p>
                  <p className="text-sm text-muted-foreground truncate">{template.split(/[/\\]/).pop()}</p>
                  <p className="text-xs text-primary/80 mt-1">
                    Área verde: {greenArea.width}x{greenArea.height} em ({greenArea.x}, {greenArea.y})
                  </p>
                </>
              ) : (
                <>
                  <p className="text-destructive font-medium">⚠️ Área verde não detectada</p>
                  <p className="text-sm text-muted-foreground truncate">{template.split(/[/\\]/).pop()}</p>
                  <p className="text-xs text-destructive/80 mt-1">{detectionError}</p>
                </>
              )}
            </div>
          ) : (
            <div>
              <p className="text-lg mb-2">📁 Selecionar Template</p>
              <p className="text-sm text-muted-foreground">PNG ou JPG com área verde #00FF00</p>
            </div>
          )}
        </div>

        {/* Output folder */}
        <div
          className="drop-zone cursor-pointer"
          onClick={handleSelectOutput}
        >
          {outputFolder ? (
            <div>
              <p className="text-primary font-medium">✓ Pasta selecionada</p>
              <p className="text-sm text-muted-foreground truncate">{outputFolder}</p>
            </div>
          ) : (
            <div>
              <p className="text-lg mb-2">📂 Pasta de Saída</p>
              <p className="text-sm text-muted-foreground">Onde salvar os vídeos</p>
            </div>
          )}
        </div>
      </div>

      {/* Quality selector */}
      <div className="mb-6">
        <label className="text-sm text-muted-foreground mb-2 block">Qualidade/Velocidade</label>
        <div className="flex gap-2">
          {(['fast', 'balanced', 'quality'] as const).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                quality === q
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              {q === 'fast' ? '⚡ Rápido' : q === 'balanced' ? '⚖️ Balanceado' : '✨ Qualidade'}
            </button>
          ))}
        </div>
      </div>

      {/* Videos */}
      <div
        className="drop-zone mb-6 cursor-pointer"
        onClick={handleSelectVideos}
      >
        <p className="text-lg mb-2">🎬 Adicionar Vídeos</p>
        <p className="text-sm text-muted-foreground">Clique para selecionar múltiplos arquivos</p>
      </div>

      {/* Video list */}
      {videos.length > 0 && (
        <div className="mb-6 space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>{videos.length} vídeo(s)</span>
            <span>{completedCount} concluído(s)</span>
          </div>
          
          <div className="max-h-64 overflow-y-auto space-y-2">
            {videos.map((video, i) => (
              <div
                key={i}
                className="p-3 bg-muted rounded-lg flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{video.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {video.status === 'done' && '✅ Concluído'}
                    {video.status === 'error' && `❌ ${video.error}`}
                    {video.status === 'processing' && (
                      <>
                        Processando... {video.progress}%
                        {video.speed && ` | ${video.speed}`}
                        {video.fps && ` | ${video.fps} fps`}
                      </>
                    )}
                    {video.status === 'queued' && '⏳ Na fila'}
                  </p>
                </div>
                
                {video.status === 'processing' && (
                  <div className="w-24 h-2 bg-background rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all relative progress-bar"
                      style={{ width: `${video.progress}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Process button */}
      <button
        onClick={handleProcess}
        disabled={!template || !greenArea || !outputFolder || queuedCount === 0 || isProcessing}
        className="w-full py-4 bg-primary text-primary-foreground font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors text-lg"
      >
        {isProcessing
          ? 'Processando...'
          : !greenArea && template
          ? '⚠️ Template sem área verde detectada'
          : queuedCount > 0
          ? `🚀 Processar ${queuedCount} vídeo(s)`
          : 'Adicione vídeos para processar'}
      </button>
    </div>
  );
}
