import type { GreenArea } from './greenDetection';
import { captureVideoFrame, analyzeVideoFrame, calculateSmartPosition, type FrameAnalysis } from './frameAnalyzer';
import { clampFps, estimateVideoFps } from './videoFps';

export interface ProcessingSettings {
  fitMode: 'cover' | 'contain';
  normalizeAudio: boolean;
  maxQuality: boolean;
  removeBlackBars: boolean;
  watermark?: string; // Optional @ handle for watermark
  useAiFraming?: boolean; // Use AI to detect faces and position video
  useOriginalFps?: boolean; // Match export FPS to original video FPS
}

export interface ProcessingProgress {
  videoId: string;
  progress: number;
  stage: 'loading' | 'processing' | 'encoding' | 'done' | 'error';
  message: string;
}

export type ProgressCallback = (progress: ProcessingProgress) => void;

export async function getVideoInfo(videoFile: File): Promise<{
  duration: number;
  width: number;
  height: number;
}> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Não foi possível carregar o vídeo'));
    };
    
    video.src = URL.createObjectURL(videoFile);
  });
}

/**
 * Process video using Canvas API with audio support
 * Outputs WebM with audio, then we'll handle conversion
 */
export async function processVideo(
  videoFile: File,
  templateFile: File | Blob,
  greenArea: GreenArea,
  settings: ProcessingSettings,
  videoId: string,
  onProgress: ProgressCallback
): Promise<Blob> {
  onProgress({
    videoId,
    progress: 5,
    stage: 'loading',
    message: 'Carregando arquivos...',
  });

  // Load template image
  const templateImg = await loadImage(templateFile);
  
  // Load and prepare video - CRITICAL: must NOT be muted initially for audio capture
  const video = document.createElement('video');
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.playbackRate = 1;
  video.muted = false; // Must be false for AudioContext capture to work
  video.volume = 0.001; // Near-silent but not muted (allows audio capture)
  
  const videoUrl = URL.createObjectURL(videoFile);
  
  await new Promise<void>((res, rej) => {
    video.oncanplaythrough = () => res();
    video.onerror = () => rej(new Error('Erro ao carregar vídeo'));
    video.src = videoUrl;
    video.load();
  });

  const duration = video.duration;
  // Trimming strategy:
  // - Do NOT cut the start (avoids an initial seek which can cause decoder hiccups / uneven cadence)
  // - Cut only 1s from the end
  const trimStart = 0; // do not cut start
  const trimEnd = 1.0; // cut 1s from the end
  const effectiveDuration = Math.max(0.5, duration - trimStart - trimEnd);
  
  // Start from the beginning
  video.currentTime = 0;
  
  await new Promise<void>((res) => {
    video.onseeked = () => res();
  });

  onProgress({
    videoId,
    progress: 15,
    stage: 'processing',
    message: 'Preparando canvas...',
  });

  // Create canvas for composition
  // Performance: when maxQuality=false, render at 720x1280 (faster) and upscale later during MP4 conversion.
  // This significantly reduces stutter and keeps A/V sync more stable on mid/low-end machines.
  const renderScale = settings.maxQuality ? 1 : (2 / 3); // 1080->720

  const makeEven = (n: number) => (n % 2 === 0 ? n : n - 1);

  const canvas = document.createElement('canvas');
  canvas.width = makeEven(Math.round(1080 * renderScale));
  canvas.height = makeEven(Math.round(1920 * renderScale));

  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Calculate video scaling
  const { x, y, width: ww, height: wh } = greenArea;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  
  let scale: number;
  let offsetX: number;
  let offsetY: number;
  let frameAnalysis: FrameAnalysis | null = null;
  
  // Use AI framing if enabled
  if (settings.useAiFraming && settings.fitMode === 'cover') {
    onProgress({
      videoId,
      progress: 12,
      stage: 'processing',
      message: 'Analisando vídeo com IA...',
    });
    
    try {
      // Capture first frame for analysis
      const frameBase64 = await captureVideoFrame(video);
      frameAnalysis = await analyzeVideoFrame(frameBase64);
      console.log('[VideoProcessor] AI frame analysis:', frameAnalysis);
      
      // Calculate smart positioning based on AI analysis
      const smartPos = calculateSmartPosition(vw, vh, ww, wh, frameAnalysis);
      scale = smartPos.scale;
      offsetX = smartPos.offsetX;
      offsetY = smartPos.offsetY;
      
      onProgress({
        videoId,
        progress: 15,
        stage: 'processing',
        message: frameAnalysis.hasFace ? 'Rosto detectado! Posicionando...' : 'Conteúdo analisado! Posicionando...',
      });
    } catch (aiError) {
      console.warn('[VideoProcessor] AI analysis failed, using default:', aiError);
      // Fallback to default cover mode
      scale = Math.max(ww / vw, wh / vh);
      const scaledW = vw * scale;
      offsetX = (ww - scaledW) / 2;
      offsetY = 0; // Top-aligned
    }
  } else if (settings.fitMode === 'cover') {
    scale = Math.max(ww / vw, wh / vh);
    const scaledW = vw * scale;
    offsetX = (ww - scaledW) / 2;
    offsetY = 0; // Top-aligned
  } else {
    scale = Math.min(ww / vw, wh / vh);
    const scaledW = vw * scale;
    const scaledH = vh * scale;
    offsetX = (ww - scaledW) / 2;
    offsetY = (wh - scaledH) / 2;
  }

  const scaledW = vw * scale;
  const scaledH = vh * scale;


  // Create template mask (green area transparent)
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = 1080;
  maskCanvas.height = 1920;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.drawImage(templateImg, 0, 0, 1080, 1920);
  
  // Make green pixels transparent
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

  // Pre-scale mask to the actual output canvas size once (avoids per-frame scaling work)
  const maskCanvasScaled = document.createElement('canvas');
  maskCanvasScaled.width = canvas.width;
  maskCanvasScaled.height = canvas.height;
  const maskScaledCtx = maskCanvasScaled.getContext('2d', { alpha: true })!;
  maskScaledCtx.imageSmoothingEnabled = true;
  maskScaledCtx.imageSmoothingQuality = 'high';
  maskScaledCtx.drawImage(maskCanvas, 0, 0, maskCanvasScaled.width, maskCanvasScaled.height);

  onProgress({
    videoId,
    progress: 20,
    stage: 'encoding',
    message: 'Iniciando gravação...',
  });

  // Set up MediaRecorder (video from canvas + audio from the source video)
  // IMPORTANT: keep capture FPS aligned with our render cadence.
  // When useOriginalFps is ON, we'll detect and match the source FPS.
  // When maxQuality is ON, default to 60fps; otherwise 30fps (will be overridden if useOriginalFps).
  let targetFps = settings.maxQuality ? 60 : 30;

  // Recording strategy (Chrome): WebM is more stable for long canvas recordings.
  // We'll record WebM (VP9/VP8) and convert to MP4 at download time when needed.
  const preferredTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';

  // Audio capture helpers
  let audioContext: AudioContext | null = null;
  const attachAudioTrack = async (combinedStream: MediaStream): Promise<boolean> => {
    // 1) Best option: captureStream() from the video element (usually most reliable)
    const anyVideo = video as any;
    const captureFn = (anyVideo.captureStream || anyVideo.mozCaptureStream)?.bind(video);
    if (typeof captureFn === 'function') {
      try {
        const videoStream: MediaStream = captureFn();
        const audioTrack = videoStream.getAudioTracks()[0];
        if (audioTrack) {
          combinedStream.addTrack(audioTrack);
          console.log('[VideoProcessor] Audio via video.captureStream():', audioTrack.label);
          return true;
        }
      } catch (e) {
        console.warn('[VideoProcessor] video.captureStream() failed:', e);
      }
    }

    // 2) Fallback: AudioContext -> MediaStreamDestination
    try {
      audioContext = new AudioContext({ latencyHint: 'playback' });
      const source = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      
      // IMPORTANT: Connect source DIRECTLY to destination for audio capture
      // Also connect to a silent gain for the speakers
      source.connect(destination);
      
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      source.connect(silentGain);
      silentGain.connect(audioContext.destination);

      const audioTrack = destination.stream.getAudioTracks()[0];
      if (audioTrack) {
        combinedStream.addTrack(audioTrack);
        console.log('[VideoProcessor] Audio via AudioContext fallback:', audioTrack.label);
        return true;
      }
    } catch (e) {
      console.warn('[VideoProcessor] AudioContext fallback failed:', e);
    }

    console.warn('[VideoProcessor] No audio track available');
    return false;
  };

  // NOTE: We'll create the MediaRecorder only AFTER we successfully attached an audio track.
  // Some browsers get unstable (frozen video w/ audio) when tracks are added after recording starts.
  let recorder: MediaRecorder | null = null;
  let flushTimer: number | null = null;

  const chunks: Blob[] = [];

  const bindRecorderHandlers = (r: MediaRecorder) => {
    r.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };
  };

  let animationId: number = 0;
  let isRecording = true;
  const endTime = Math.max(0, duration - trimEnd);

  // Progress throttling is CRITICAL for smooth output.
  // React state updates during recording can block the main thread and cause frame freezes.
  let lastProgressBucket = -1;

  // Precompute scaled geometry to avoid transforms every frame
  const sx = x * renderScale;
  const sy = y * renderScale;
  const sww = ww * renderScale;
  const swh = wh * renderScale;
  const sOffsetX = offsetX * renderScale;
  const sOffsetY = offsetY * renderScale;
  const sScaledW = scaledW * renderScale;
  const sScaledH = scaledH * renderScale;

  const renderFrame = () => {
    // Clear entire canvas with white background first
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw video (clipped to the green area)
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - 2, sy - 2, sww + 4, swh + 4);
    ctx.clip();

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(sx - 2, sy - 2, sww + 4, swh + 4);

    ctx.drawImage(video, sx + sOffsetX, sy + sOffsetY, sScaledW, sScaledH);
    ctx.restore();

    // Draw template mask on top (already scaled)
    ctx.drawImage(maskCanvasScaled, 0, 0);

    // Draw watermark if provided
    if (settings.watermark && settings.watermark.trim()) {
      const watermarkText = settings.watermark.trim();
      const templateEndY = y + wh;
      const watermarkY = templateEndY - (wh * 0.15);
      
      ctx.save();
      ctx.font = '28px Arial';
      ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(watermarkText, 1080 / 2, watermarkY);
      ctx.restore();
    }

    // Update progress (less frequently to reduce overhead)
    const currentProgress = video.currentTime - trimStart;
    const progressPercent = Math.round((currentProgress / effectiveDuration) * 100);
    const bucket = Math.floor(progressPercent / 5) * 5;
    if (bucket !== lastProgressBucket) {
      lastProgressBucket = bucket;
      const progress = 20 + (currentProgress / effectiveDuration) * 75;
      onProgress({
        videoId,
        progress: Math.min(95, Math.round(progress)),
        stage: 'encoding',
        message: `Processando: ${bucket}%`,
      });
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    isRecording = false;
    try {
      renderFrame();
    } catch {}
    setTimeout(() => {
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
      }
    }, 300);
  };

  // Frame scheduling: Use a precise AudioContext-based timer for consistent frame cadence.
  // This is more reliable than requestAnimationFrame for MediaRecorder, as it won't be
  // throttled when the tab is in the background or during heavy rendering.
  let frameTimerId: number | null = null;
  let stopped = false;

  const scheduleFrames = () => {
    const frameInterval = 1000 / targetFps;
    let lastDrawAt = 0;

    const stopTimer = () => {
      stopped = true;
      if (frameTimerId) {
        window.clearInterval(frameTimerId);
        frameTimerId = null;
      }
    };

    // Store for cleanup
    (window as any).__videoProcessorStopTimer = stopTimer;

    const tick = (now: number) => {
      if (stopped || !isRecording) return;

      if (video.currentTime >= endTime || video.ended || video.paused) {
        stopTimer();
        stopRecording();
        return;
      }

      // Throttle to targetFps even if the callback rate is higher.
      if (now - lastDrawAt >= frameInterval - 0.5) {
        lastDrawAt = now;
        renderFrame();
      }

      const rVFCMethod = (video as any).requestVideoFrameCallback;

      if (typeof rVFCMethod === 'function') {
        // Use correct 'this' context to avoid "Illegal invocation"
        rVFCMethod.call(video, (n: number) => tick(n));
      }
    };

    const rVFCMethod = (video as any).requestVideoFrameCallback;

    if (typeof rVFCMethod === 'function') {
      // Use correct 'this' context to avoid "Illegal invocation"
      rVFCMethod.call(video, (n: number) => tick(n));
      return;
    }

    // Fallback: setInterval (less ideal, but avoids per-frame AudioContext allocations).
    frameTimerId = window.setInterval(() => {
      if (stopped || !isRecording) {
        stopTimer();
        return;
      }
      tick(performance.now());
    }, frameInterval);
  };

  return new Promise<Blob>((resolve, reject) => {
    const handleStop = () => {
      URL.revokeObjectURL(videoUrl);
      cancelAnimationFrame(animationId);

      // Stop AudioContext timer if running
      try {
        (window as any).__videoProcessorStopTimer?.();
      } catch {}

      if (flushTimer) {
        window.clearInterval(flushTimer);
        flushTimer = null;
      }

      try {
        audioContext?.close();
      } catch {}

      setTimeout(() => {
        if (chunks.length === 0) {
          reject(new Error('Nenhum dado de vídeo foi capturado'));
          return;
        }

        const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType });
        // Attach capture FPS so conversion can keep the cadence.
        (blob as any).__targetFps = targetFps;

        if (blob.size < 1000) {
          reject(new Error('Vídeo gerado está vazio ou corrompido'));
          return;
        }

        onProgress({
          videoId,
          progress: 100,
          stage: 'done',
          message: 'Concluído!',
        });

        resolve(blob);
      }, 200);
    };

    const handleError = () => {
      URL.revokeObjectURL(videoUrl);
      cancelAnimationFrame(animationId);

      if (flushTimer) {
        window.clearInterval(flushTimer);
        flushTimer = null;
      }
      try {
        audioContext?.close();
      } catch {}
      reject(new Error('Erro na gravação do vídeo'));
    };

    video.onerror = () => {
      stopRecording();
      cancelAnimationFrame(animationId);
      try {
        audioContext?.close();
      } catch {}
      reject(new Error('Erro durante reprodução do vídeo'));
    };

    // Video must NOT be muted for audio capture to work properly
    // We set volume very low instead to avoid audible playback
    video.muted = false;
    video.volume = 0.001;

    // Start playback from trim point
    video.play().then(async () => {
      try {
        await audioContext?.resume();
      } catch {}

      // Estimate source FPS while playing to avoid output stutter (30fps export from 60fps sources looks like "travando").
      // Always detect when useOriginalFps is ON, or when maxQuality is OFF.
      if (settings.useOriginalFps || !settings.maxQuality) {
        const estimated = await estimateVideoFps(video);
        if (estimated) {
          targetFps = clampFps(Math.round(estimated));
          console.log(`[VideoProcessor] Using detected FPS: ${targetFps}`);
        }
      }

      const canvasStream = canvas.captureStream(targetFps);
      // We start with the canvas video track, then (after playback starts) we attach an audio track.
      const combinedStream = new MediaStream(canvasStream.getVideoTracks());

      // Attach audio track AFTER playback starts (more reliable across browsers)
      try {
        const ok = await attachAudioTrack(combinedStream);
        if (!ok) {
          reject(new Error('Não foi possível capturar o áudio do vídeo'));
          return;
        }
      } catch {}

      if (!mimeType) {
        reject(new Error('Seu navegador não suporta gravação em WebM.'));
        return;
      }

      // Conservative bitrates reduce encode stalls (which cause stutter) and help A/V sync.
      recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: settings.maxQuality ? 12000000 : 6000000,
        audioBitsPerSecond: 160000,
      });

      bindRecorderHandlers(recorder);
      recorder.onstop = handleStop;
      recorder.onerror = handleError;

      // For WebM, using a 1s timeslice reduces memory spikes and helps prevent long stalls.
      recorder.start(1000);

      // Some browsers will stall MP4 unless data is periodically flushed.
      // requestData() forces the encoder to emit buffered data and reduces long "freeze" spans.
      flushTimer = window.setInterval(() => {
        try {
          if (recorder && recorder.state === 'recording' && typeof recorder.requestData === 'function') {
            recorder.requestData();
          }
        } catch {
          // ignore
        }
      }, 1000);

      scheduleFrames();
    }).catch((err2) => {
      reject(new Error('Não foi possível reproduzir o vídeo: ' + err2.message));
    });
  });
}

async function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Erro ao carregar imagem'));
    };
    
    img.src = url;
  });
}
