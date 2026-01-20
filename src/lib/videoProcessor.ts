import type { GreenArea } from './greenDetection';
import { captureVideoFrame, analyzeVideoFrame, calculateSmartPosition, getDefaultAnalysis, type FrameAnalysis } from './frameAnalyzer';

export interface ProcessingSettings {
  fitMode: 'cover' | 'contain';
  normalizeAudio: boolean;
  maxQuality: boolean;
  removeBlackBars: boolean;
  watermark?: string; // Optional @ handle for watermark
  useAiFraming?: boolean; // Use AI to detect faces and position video
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
  const trimStart = 0.5; // Cortar 0.5s do início
  const trimEnd = 0.5; // Cortar 0.5s do final
  const effectiveDuration = Math.max(0.5, duration - trimStart - trimEnd);
  
  // Set video to start after trim
  video.currentTime = trimStart;
  
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
  const renderScale = settings.maxQuality ? 1 : (2 / 3); // 1080->720

  const makeEven = (n: number) => n % 2 === 0 ? n : n - 1;

  const canvas = document.createElement('canvas');
  canvas.width = makeEven(Math.round(1080 * renderScale));
  canvas.height = makeEven(Math.round(1920 * renderScale));

  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.imageSmoothingEnabled = true;

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
      const scaledH = vh * scale;
      offsetX = (ww - scaledW) / 2;
      offsetY = 0; // Top-aligned
    }
  } else if (settings.fitMode === 'cover') {
    scale = Math.max(ww / vw, wh / vh);
    const scaledW = vw * scale;
    const scaledH = vh * scale;
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

  onProgress({
    videoId,
    progress: 20,
    stage: 'encoding',
    message: 'Iniciando gravação...',
  });

  // Set up MediaRecorder (video from canvas + audio from the source video)
  // Use variable frame-rate capture when possible to reduce A/V drift under load.
  const canvasStream = canvas.captureStream();

  // We start with the canvas video track, then (after playback starts) we attach an audio track.
  const combinedStream = new MediaStream(canvasStream.getVideoTracks());

  // Prefer MP4 when supported (fast downloads, no FFmpeg step). Fallback to WebM.
  // Note: MP4 recording support varies by browser.
  const preferredTypes = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ];

  const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';

  // Audio capture helpers
  let audioContext: AudioContext | null = null;
  const attachAudioTrack = async (): Promise<boolean> => {
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
      const gain = audioContext.createGain();
      gain.gain.value = 0; // silent output
      source.connect(gain);
      gain.connect(destination);

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

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: settings.maxQuality ? 12000000 : 8000000,
    audioBitsPerSecond: 192000,
  });

  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  let animationId: number = 0;
  let isRecording = true;
  const endTime = duration - trimEnd;

  const renderFrame = () => {
    // Render in 1080x1920 "virtual" coords, scaled to the actual canvas size
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

    // Clear with black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 1080, 1920);

    // Fill the green area with white FIRST to eliminate any green remnants
    // This ensures no green or black borders show through at the edges
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, ww, wh);

    // Draw video in the green area position with clipping
    // Expand the clip area slightly (4px outward) to ensure full coverage
    // and prevent any edge artifacts from showing
    const expandMargin = 4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - expandMargin, y - expandMargin, ww + expandMargin * 2, wh + expandMargin * 2);
    ctx.clip();
    
    // Draw video slightly larger to cover any potential edge gaps
    const videoExpand = 2;
    ctx.drawImage(
      video, 
      x + offsetX - videoExpand, 
      y + offsetY - videoExpand, 
      scaledW + videoExpand * 2, 
      scaledH + videoExpand * 2
    );
    ctx.restore();

    // Draw template mask on top (covers everything outside the green area)
    ctx.drawImage(maskCanvas, 0, 0);

    // Draw watermark if provided
    if (settings.watermark && settings.watermark.trim()) {
      const watermarkText = settings.watermark.trim();
      // Position: 30% up from the bottom of the green area (where template ends)
      const templateEndY = y + wh; // Bottom of green area
      const watermarkY = templateEndY - (wh * 0.15); // 15% up from bottom
      
      ctx.save();
      ctx.font = '28px Arial';
      ctx.fillStyle = 'rgba(128, 128, 128, 0.5)'; // Medium gray, 50% opacity
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(watermarkText, 1080 / 2, watermarkY);
      ctx.restore();
    }

    // Update progress
    const currentProgress = video.currentTime - trimStart;
    const progress = 20 + (currentProgress / effectiveDuration) * 75;
    onProgress({
      videoId,
      progress: Math.min(95, Math.round(progress)),
      stage: 'encoding',
      message: `Processando: ${Math.round((currentProgress / effectiveDuration) * 100)}%`,
    });
  };

  const stopRecording = () => {
    if (!isRecording) return;
    isRecording = false;
    try {
      renderFrame();
    } catch {}
    setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, 300);
  };

  // Use requestVideoFrameCallback for precise frame sync when available
  // Falls back to requestAnimationFrame for older browsers
  const scheduleFrames = () => {
    const anyVideo = video as any;
    
    const onFrame = () => {
      if (!isRecording) return;
      
      if (video.currentTime >= endTime || video.ended || video.paused) {
        stopRecording();
        return;
      }
      
      renderFrame();
      
      // Schedule next frame using the best available method
      if (typeof anyVideo.requestVideoFrameCallback === 'function') {
        anyVideo.requestVideoFrameCallback(onFrame);
      } else {
        animationId = requestAnimationFrame(onFrame);
      }
    };
    
    // Start the frame loop
    if (typeof anyVideo.requestVideoFrameCallback === 'function') {
      anyVideo.requestVideoFrameCallback(onFrame);
    } else {
      animationId = requestAnimationFrame(onFrame);
    }
  };

  return new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      URL.revokeObjectURL(videoUrl);
      cancelAnimationFrame(animationId);

      try {
        audioContext?.close();
      } catch {}

      setTimeout(() => {
        if (chunks.length === 0) {
          reject(new Error('Nenhum dado de vídeo foi capturado'));
          return;
        }

        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });

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

    recorder.onerror = () => {
      URL.revokeObjectURL(videoUrl);
      cancelAnimationFrame(animationId);
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

      // Attach audio track AFTER playback starts (more reliable across browsers)
      try {
        await attachAudioTrack();
      } catch {}

      // Start recording only after we tried attaching audio
      recorder.start(100);
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
