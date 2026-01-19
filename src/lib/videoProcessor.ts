import type { GreenArea } from './greenDetection';

export interface ProcessingSettings {
  fitMode: 'cover' | 'contain';
  normalizeAudio: boolean;
  maxQuality: boolean;
  removeBlackBars: boolean;
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
  
  // Load and prepare video
  const video = document.createElement('video');
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.playbackRate = 1;
  
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
  
  if (settings.fitMode === 'cover') {
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

  // Set up MediaRecorder with audio
  const canvasStream = canvas.captureStream(30);
  
  // Try to get audio from the video
  let combinedStream: MediaStream;
  try {
    // Create audio context to capture audio from video
    const audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(video);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    source.connect(audioContext.destination); // Also output to speakers (muted by video element)
    
    // Combine video and audio streams
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (audioTrack) {
      combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        audioTrack
      ]);
    } else {
      combinedStream = canvasStream;
    }
  } catch (e) {
    console.warn('Could not capture audio:', e);
    combinedStream = canvasStream;
  }
  
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

  let mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
  
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

  recorder.start(100);

  let animationId: number;
  let isRecording = true;
  const endTime = duration - trimEnd;

  // Draw function
  const drawFrame = () => {
    // Check if we've reached the end (minus trim)
    if (video.currentTime >= endTime || video.ended || video.paused) {
      if (isRecording) {
        isRecording = false;
        // Draw final frame
        renderFrame();
        setTimeout(() => {
          if (recorder.state === 'recording') {
            recorder.stop();
          }
        }, 300);
      }
      return;
    }

    renderFrame();
    animationId = requestAnimationFrame(drawFrame);
  };

  const renderFrame = () => {
    // Render in 1080x1920 "virtual" coords, scaled to the actual canvas size
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

    // Clear with black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 1080, 1920);

    // Draw video in the green area position with clipping
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, ww, wh);
    ctx.clip();
    ctx.drawImage(video, x + offsetX, y + offsetY, scaledW, scaledH);
    ctx.restore();

    // Draw template mask on top
    ctx.drawImage(maskCanvas, 0, 0);

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

  return new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      URL.revokeObjectURL(videoUrl);
      cancelAnimationFrame(animationId);
      
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
      reject(new Error('Erro na gravação do vídeo'));
    };

    video.onerror = () => {
      isRecording = false;
      cancelAnimationFrame(animationId);
      if (recorder.state === 'recording') {
        recorder.stop();
      }
      reject(new Error('Erro durante reprodução do vídeo'));
    };

    // Unmute video to capture audio
    video.muted = false;
    video.volume = 1;
    
    // Start playback from trim point
    video.play().then(() => {
      drawFrame();
    }).catch((err) => {
      // If autoplay is blocked, try muted
      video.muted = true;
      video.play().then(() => {
        drawFrame();
      }).catch((err2) => {
        reject(new Error('Não foi possível reproduzir o vídeo: ' + err2.message));
      });
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
