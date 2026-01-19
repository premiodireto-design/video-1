import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { GreenArea } from './greenDetection';

let ffmpeg: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

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

export async function loadFFmpeg(onProgress?: (loaded: number, total: number) => void): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) {
    return ffmpeg;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    const ff = new FFmpeg();
    
    ff.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    
    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpeg = ff;
    return ff;
  })();

  return loadingPromise;
}

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

export async function processVideo(
  ff: FFmpeg,
  videoFile: File,
  templateFile: Blob,
  templateMask: Blob,
  greenArea: GreenArea,
  settings: ProcessingSettings,
  videoId: string,
  onProgress: ProgressCallback
): Promise<Blob> {
  const inputName = 'input.mp4';
  const templateName = 'template.png';
  const maskName = 'mask.png';
  const outputName = 'output.mp4';

  onProgress({
    videoId,
    progress: 5,
    stage: 'loading',
    message: 'Carregando arquivos...',
  });

  // Write files to FFmpeg virtual filesystem
  await ff.writeFile(inputName, await fetchFile(videoFile));
  await ff.writeFile(templateName, await fetchFile(templateFile));
  await ff.writeFile(maskName, await fetchFile(templateMask));

  onProgress({
    videoId,
    progress: 15,
    stage: 'processing',
    message: 'Analisando vídeo...',
  });

  // Get video dimensions
  const videoInfo = await getVideoInfo(videoFile);
  const { width: vw, height: vh } = videoInfo;
  const { x, y, width: ww, height: wh } = greenArea;

  // Calculate scaling
  const videoAspect = vw / vh;
  const windowAspect = ww / wh;

  let scaleFilter: string;
  let cropOrPadFilter: string;

  if (settings.fitMode === 'cover') {
    // Cover mode: scale to cover, then crop (top-anchored)
    if (videoAspect > windowAspect) {
      // Video is wider - scale by height, crop width
      scaleFilter = `scale=-2:${wh}`;
    } else {
      // Video is taller - scale by width, crop height from bottom
      scaleFilter = `scale=${ww}:-2`;
    }
    // Crop centered horizontally, anchored to top vertically
    cropOrPadFilter = `crop=${ww}:${wh}:(in_w-${ww})/2:0`;
  } else {
    // Contain mode: scale to fit, pad with black
    if (videoAspect > windowAspect) {
      // Video is wider - scale by width, pad height
      scaleFilter = `scale=${ww}:-2`;
    } else {
      // Video is taller - scale by height, pad width
      scaleFilter = `scale=-2:${wh}`;
    }
    // Pad to exact window size, centered
    cropOrPadFilter = `pad=${ww}:${wh}:(${ww}-iw)/2:(${wh}-ih)/2:black`;
  }

  onProgress({
    videoId,
    progress: 25,
    stage: 'encoding',
    message: 'Processando vídeo...',
  });

  // Build the filter complex
  // 1. Scale and crop/pad the video to fit the window
  // 2. Create a base canvas (1080x1920)
  // 3. Overlay the fitted video at the green area position
  // 4. Overlay the template mask on top (green area is transparent)
  const filterComplex = [
    // Process input video
    `[0:v]${scaleFilter},setsar=1,${cropOrPadFilter}[vfit]`,
    // Create base canvas from template
    `color=c=black:s=1080x1920:d=1[base]`,
    // Get template dimensions
    `[1:v]scale=1080:1920[tmpl]`,
    // Get mask
    `[2:v]scale=1080:1920,format=rgba[msk]`,
    // Overlay video on base at green area position
    `[base][vfit]overlay=${x}:${y}:shortest=1[withvid]`,
    // Overlay mask on top
    `[withvid][msk]overlay=0:0[outv]`,
  ].join(';');

  // FFmpeg progress tracking
  let lastProgress = 25;
  ff.on('progress', ({ progress }) => {
    const currentProgress = Math.min(25 + progress * 70, 95);
    if (currentProgress > lastProgress) {
      lastProgress = currentProgress;
      onProgress({
        videoId,
        progress: currentProgress,
        stage: 'encoding',
        message: `Codificando: ${Math.round(progress * 100)}%`,
      });
    }
  });

  // Build FFmpeg command
  const ffmpegArgs = [
    '-i', inputName,
    '-i', templateName,
    '-i', maskName,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '0:a?', // Include audio if present
    '-c:v', 'libx264',
    '-preset', settings.maxQuality ? 'medium' : 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y',
    outputName,
  ];

  // Add audio normalization if enabled
  if (settings.normalizeAudio) {
    ffmpegArgs.splice(ffmpegArgs.indexOf('-map'), 0, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
  }

  try {
    await ff.exec(ffmpegArgs);
  } catch (error) {
    console.error('FFmpeg error:', error);
    onProgress({
      videoId,
      progress: 0,
      stage: 'error',
      message: 'Erro ao processar vídeo',
    });
    throw new Error('Erro ao processar o vídeo. Verifique se o formato é suportado.');
  }

  onProgress({
    videoId,
    progress: 98,
    stage: 'encoding',
    message: 'Finalizando...',
  });

  // Read output file
  const data = await ff.readFile(outputName);
  const uint8Array = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
  
  // Cleanup
  await ff.deleteFile(inputName);
  await ff.deleteFile(templateName);
  await ff.deleteFile(maskName);
  await ff.deleteFile(outputName);

  onProgress({
    videoId,
    progress: 100,
    stage: 'done',
    message: 'Concluído!',
  });

  return new Blob([uint8Array], { type: 'video/mp4' });
}
