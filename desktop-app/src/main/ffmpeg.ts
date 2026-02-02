import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';

export interface GPUInfo {
  hasNvidia: boolean;
  hasIntelQSV: boolean;
  hasAMD: boolean;
  recommendedEncoder: string;
  availableEncoders: string[];
}

export interface ProcessingProgress {
  videoPath: string;
  progress: number;
  stage: 'analyzing' | 'processing' | 'done' | 'error';
  message: string;
  fps?: number;
  speed?: string;
}

/**
 * Get FFmpeg binary path
 * Tries bundled version first, then system FFmpeg, then common install locations
 */
function getFFmpegPath(): string {
  const platform = process.platform;
  const ext = platform === 'win32' ? '.exe' : '';
  
  console.log('[FFmpeg] Detecting FFmpeg path...');
  console.log('[FFmpeg] Platform:', platform);
  console.log('[FFmpeg] Is packaged:', app.isPackaged);
  
  // 1. Try bundled FFmpeg (if app is packaged and ffmpeg-bin exists)
  if (app.isPackaged) {
    const bundledPath = join(process.resourcesPath, 'ffmpeg-bin', `ffmpeg${ext}`);
    console.log('[FFmpeg] Checking bundled path:', bundledPath);
    if (existsSync(bundledPath)) {
      console.log('[FFmpeg] ✓ Using bundled:', bundledPath);
      return bundledPath;
    }
    console.log('[FFmpeg] ✗ Bundled not found');
  }
  
  // 2. Try common Windows installation paths
  if (platform === 'win32') {
    const commonPaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      join(process.env.USERPROFILE || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    ];
    
    console.log('[FFmpeg] Checking common Windows paths...');
    for (const p of commonPaths) {
      console.log('[FFmpeg] Checking:', p);
      const exists = existsSync(p);
      console.log('[FFmpeg] Exists:', exists);
      if (exists) {
        console.log('[FFmpeg] ✓ Found at:', p);
        return p;
      }
    }
  }
  
  // 3. Fallback to system PATH
  console.log('[FFmpeg] ✗ No local path found, using system PATH');
  return 'ffmpeg';
}

/**
 * Detect available GPU encoders
 */
export function detectGPU(): GPUInfo {
  const ffmpegPath = getFFmpegPath();
  const encoders: string[] = [];
  
  let hasNvidia = false;
  let hasIntelQSV = false;
  let hasAMD = false;

  try {
    // Check available encoders
    const output = execSync(`${ffmpegPath} -hide_banner -encoders`, { encoding: 'utf8' });
    
    if (output.includes('h264_nvenc')) {
      hasNvidia = true;
      encoders.push('h264_nvenc');
    }
    
    if (output.includes('h264_qsv')) {
      hasIntelQSV = true;
      encoders.push('h264_qsv');
    }
    
    if (output.includes('h264_amf')) {
      hasAMD = true;
      encoders.push('h264_amf');
    }
    
    // Always add CPU encoder as fallback
    encoders.push('libx264');
  } catch (error) {
    console.error('Failed to detect GPU:', error);
    encoders.push('libx264');
  }

  // Determine recommended encoder (priority: NVENC > QSV > AMF > CPU)
  let recommendedEncoder = 'libx264';
  if (hasNvidia) recommendedEncoder = 'h264_nvenc';
  else if (hasIntelQSV) recommendedEncoder = 'h264_qsv';
  else if (hasAMD) recommendedEncoder = 'h264_amf';

  return {
    hasNvidia,
    hasIntelQSV,
    hasAMD,
    recommendedEncoder,
    availableEncoders: encoders,
  };
}

/**
 * Get encoder-specific flags for best performance
 */
function getEncoderFlags(encoder: string, quality: 'fast' | 'balanced' | 'quality'): string[] {
  const qualityMap = {
    fast: { nvenc: 'p1', qsv: 'veryfast', amf: 'speed', x264: 'ultrafast', crf: 28 },
    balanced: { nvenc: 'p4', qsv: 'faster', amf: 'balanced', x264: 'veryfast', crf: 23 },
    quality: { nvenc: 'p7', qsv: 'slower', amf: 'quality', x264: 'slow', crf: 18 },
  };
  
  const q = qualityMap[quality];

  switch (encoder) {
    case 'h264_nvenc':
      return [
        '-c:v', 'h264_nvenc',
        '-preset', q.nvenc,
        '-tune', 'hq',
        '-rc', 'vbr',
        '-cq', String(q.crf),
        '-b:v', '0',
      ];
    
    case 'h264_qsv':
      return [
        '-c:v', 'h264_qsv',
        '-preset', q.qsv,
        '-global_quality', String(q.crf),
      ];
    
    case 'h264_amf':
      return [
        '-c:v', 'h264_amf',
        '-quality', q.amf,
        '-rc', 'cqp',
        '-qp_i', String(q.crf),
        '-qp_p', String(q.crf),
      ];
    
    default: // libx264
      return [
        '-c:v', 'libx264',
        '-preset', q.x264,
        '-crf', String(q.crf),
      ];
  }
}

/**
 * Process a video with FFmpeg using GPU acceleration
 */
export function processVideo(
  options: {
    videoPath: string;
    templatePath: string;
    outputPath: string;
    greenArea: { x: number; y: number; width: number; height: number };
    settings: {
      useGPU: boolean;
      encoder: string;
      quality: 'fast' | 'balanced' | 'quality';
      trimStart: number;
      trimEnd: number;
    };
  },
  onProgress: (progress: ProcessingProgress) => void
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const { videoPath, templatePath, outputPath, greenArea, settings } = options;
    const { x, y, width, height } = greenArea;

    onProgress({
      videoPath,
      progress: 0,
      stage: 'analyzing',
      message: 'Analisando vídeo...',
    });

    // Build filter complex for chroma key + overlay
    const filterComplex = [
      // Scale video to fit green area (cover mode)
      `[0:v]scale=w='if(gt(a,${width}/${height}),${width},-1)':h='if(gt(a,${width}/${height}),-1,${height})':force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-${width})/2:0,setsar=1[vid]`,
      // Template with chroma key
      `[1:v]scale=1080:1920,chromakey=0x00FF00:0.3:0.1[mask]`,
      // Black background
      `color=black:s=1080x1920:d=1[bg]`,
      // Overlay video in green area
      `[bg][vid]overlay=${x}:${y}:shortest=1[base]`,
      // Overlay template on top
      `[base][mask]overlay=0:0:shortest=1[out]`,
    ].join(';');

    // Get encoder-specific flags
    const encoderFlags = getEncoderFlags(
      settings.useGPU ? settings.encoder : 'libx264',
      settings.quality
    );

    // Build FFmpeg command
    const args = [
      '-y', // Overwrite output
      '-i', videoPath,
      '-i', templatePath,
      '-ss', String(settings.trimStart),
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-map', '0:a?', // Map audio if exists
      ...encoderFlags,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1', // Output progress to stdout
      outputPath,
    ];

    console.log('[FFmpeg] Command:', ffmpegPath, args.join(' '));

    const ffmpeg = spawn(ffmpegPath, args);
    let duration = 0;

    ffmpeg.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
      
      // Parse duration
      const durationMatch = line.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
      if (durationMatch) {
        const [, hours, minutes, seconds] = durationMatch;
        duration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
      }
    });

    ffmpeg.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      
      // Parse progress
      const timeMatch = line.match(/out_time_ms=(\d+)/);
      const speedMatch = line.match(/speed=\s*([\d.]+)x/);
      const fpsMatch = line.match(/fps=\s*([\d.]+)/);
      
      if (timeMatch && duration > 0) {
        const currentTime = parseInt(timeMatch[1]) / 1000000;
        const progress = Math.min(99, Math.round((currentTime / duration) * 100));
        
        onProgress({
          videoPath,
          progress,
          stage: 'processing',
          message: `Processando... ${progress}%`,
          fps: fpsMatch ? parseFloat(fpsMatch[1]) : undefined,
          speed: speedMatch ? `${speedMatch[1]}x` : undefined,
        });
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        onProgress({
          videoPath,
          progress: 100,
          stage: 'done',
          message: 'Concluído!',
        });
        resolve({ success: true, outputPath });
      } else {
        onProgress({
          videoPath,
          progress: 0,
          stage: 'error',
          message: `FFmpeg saiu com código ${code}`,
        });
        resolve({ success: false, error: `FFmpeg exit code: ${code}` });
      }
    });

    ffmpeg.on('error', (error) => {
      onProgress({
        videoPath,
        progress: 0,
        stage: 'error',
        message: error.message,
      });
      resolve({ success: false, error: error.message });
    });
  });
}
