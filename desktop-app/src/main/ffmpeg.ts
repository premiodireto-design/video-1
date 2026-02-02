import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { extractFirstFrame, analyzeVideoFrame, calculateSmartPosition, getDefaultAnalysis, type FrameAnalysis } from './aiFraming';

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
  // Optimized presets for speed + quality + smooth playback
  const qualityMap = {
    fast: { nvenc: 'p4', qsv: 'veryfast', amf: 'speed', x264: 'veryfast', crf: 26 },
    balanced: { nvenc: 'p5', qsv: 'faster', amf: 'balanced', x264: 'faster', crf: 22 },
    quality: { nvenc: 'p6', qsv: 'slower', amf: 'quality', x264: 'medium', crf: 18 },
  };
  
  const q = qualityMap[quality];

  // Common flags for smooth playback (constant frame rate, proper GOP)
  const smoothFlags = [
    '-vsync', 'cfr',        // Constant frame rate - prevents stutters
    '-g', '30',             // GOP size = 1 second at 30fps
    '-bf', '0',             // No B-frames for smoother playback
  ];

  switch (encoder) {
    case 'h264_nvenc':
      // Optimized NVENC flags with new preset naming (p1-p7)
      return [
        '-c:v', 'h264_nvenc',
        '-preset', q.nvenc,
        '-rc', 'vbr',           // Variable bitrate for better quality
        '-cq', String(q.crf),
        '-b:v', '0',            // Let CQ control quality
        '-spatial-aq', '1',     // Spatial adaptive quantization
        '-temporal-aq', '1',    // Temporal adaptive quantization
        ...smoothFlags,
      ];
    
    case 'h264_qsv':
      return [
        '-c:v', 'h264_qsv',
        '-preset', q.qsv,
        '-global_quality', String(q.crf),
        ...smoothFlags,
      ];
    
    case 'h264_amf':
      return [
        '-c:v', 'h264_amf',
        '-quality', q.amf,
        '-rc', 'cqp',
        '-qp_i', String(q.crf),
        '-qp_p', String(q.crf),
        ...smoothFlags,
      ];
    
    default: // libx264
      return [
        '-c:v', 'libx264',
        '-preset', q.x264,
        '-crf', String(q.crf),
        '-tune', 'film',        // Better for real content vs fastdecode
        '-x264-params', 'ref=3:bframes=0',  // Optimized for smooth playback
        '-threads', '0',
        ...smoothFlags,
      ];
  }
}

/**
 * Get video dimensions using FFprobe
 */
async function getVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      videoPath,
    ];

    let stdout = '';
    const ffprobe = spawn(ffprobePath, args);

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        const [width, height] = stdout.trim().split(',').map(Number);
        if (width && height) {
          resolve({ width, height });
          return;
        }
      }
      // Fallback to common dimensions if ffprobe fails
      resolve({ width: 1920, height: 1080 });
    });

    ffprobe.on('error', () => {
      resolve({ width: 1920, height: 1080 });
    });
  });
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
      useAiFraming?: boolean; // NEW: Use AI to detect faces and position video
    };
  },
  onProgress: (progress: ProcessingProgress) => void
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const { videoPath, templatePath, outputPath, greenArea, settings } = options;
    const { x, y, width, height } = greenArea;

    const isNvencDriverIssue = (stderr: string) => {
      const s = stderr.toLowerCase();
      return (
        s.includes('driver does not support the required nvenc api version') ||
        s.includes('minimum required nvidia driver') ||
        s.includes('nvenc api version')
      );
    };

    // Run the async processing logic
    (async () => {
      let frameAnalysis: FrameAnalysis | null = null;
      let aiOffsetX = 0;
      let aiOffsetY = 0;

      // If AI framing is enabled, analyze the first frame
      if (settings.useAiFraming) {
        onProgress({
          videoPath,
          progress: 0,
          stage: 'analyzing',
          message: 'Analisando vídeo com IA...',
        });

        try {
          // Get video dimensions first
          const videoDims = await getVideoDimensions(videoPath);
          console.log('[FFmpeg] Video dimensions:', videoDims);

          // Extract and analyze first frame
          const frameBase64 = await extractFirstFrame(videoPath);
          frameAnalysis = await analyzeVideoFrame(frameBase64);
          console.log('[FFmpeg] AI analysis result:', frameAnalysis);

          // Calculate smart positioning
          const smartPos = calculateSmartPosition(
            videoDims.width,
            videoDims.height,
            width,
            height,
            frameAnalysis
          );

          // For FFmpeg, we need to calculate the crop offset based on AI anchor points
          // The smart position gives us pixel offsets, but we need to convert to FFmpeg crop expression
          // The anchorX/Y values (0-1) determine where to crop from
          aiOffsetX = frameAnalysis.suggestedCrop.anchorX;
          aiOffsetY = frameAnalysis.suggestedCrop.anchorY;

          onProgress({
            videoPath,
            progress: 5,
            stage: 'analyzing',
            message: frameAnalysis.hasFace
              ? 'Rosto detectado! Enquadrando...'
              : 'Conteúdo analisado! Enquadrando...',
          });
        } catch (aiError) {
          console.warn('[FFmpeg] AI analysis failed, using center crop:', aiError);
          aiOffsetX = 0.5;
          aiOffsetY = 0.15; // Default top-aligned for talking heads
        }
      } else {
        onProgress({
          videoPath,
          progress: 0,
          stage: 'analyzing',
          message: 'Analisando vídeo...',
        });
        aiOffsetX = 0.5;
        aiOffsetY = 0.5; // Center crop when AI is disabled
      }

      // Build filter complex for chroma key + overlay
      // IMPORTANT:
      // - Template PNG must have transparent pixels where the video should appear (green area).
      // - We overlay the video first on a black background, then overlay the template on top.
      // - The template's green pixels are removed via chromakey, revealing the video below.
      // - Apply margin (2px) to avoid green edge artifacts.
      const targetAspect = width / height;
      const margin = 2; // Safety margin to hide green edge pixels

      // Calculate crop position based on AI anchor points
      // anchorX: 0=left, 0.5=center, 1=right
      // anchorY: 0=top, 0.5=center, 1=bottom
      // For FFmpeg crop: crop=w:h:x:y where x and y are the top-left corner of the crop area
      // When anchorY=0 (top), we want y=0 (keep top)
      // When anchorY=1 (bottom), we want y=(ih-height) (keep bottom)
      const cropX = `(iw-${width})*${aiOffsetX}`;
      const cropY = `(ih-${height})*${aiOffsetY}`;

      const filterComplex = [
        // Scale video to cover the green area (true cover mode)
        // If the input is wider than target => fit height; else => fit width.
        // Then crop using AI-determined anchor points
        // Also convert colorspace to sRGB for consistency with template
        `[0:v]scale=w='if(gt(a,${targetAspect}),-1,${width})':h='if(gt(a,${targetAspect}),${height},-1)',crop=${width}:${height}:${cropX}:${cropY},setsar=1,format=rgb24[vid]`,
        // Template with chroma key - use tighter tolerance for cleaner edges
        `[1:v]scale=1080:1920,format=rgb24,chromakey=0x00FF00:0.25:0.08[mask]`,
        // Infinite black background
        `color=black:s=1080x1920[bg]`,
        // Overlay video in green area with margin (slightly inward to hide edges)
        `[bg][vid]overlay=${x + margin}:${y + margin}:shortest=1[base]`,
        // Overlay template on top
        `[base][mask]overlay=0:0:shortest=1,format=yuv420p[out]`,
      ].join(';');

    // Get encoder-specific flags
    const pickEncoder = (useGpu: boolean) => (useGpu ? settings.encoder : 'libx264');
    const buildEncoderFlags = (useGpu: boolean) =>
      getEncoderFlags(pickEncoder(useGpu), settings.quality);

    const runOnce = (useGpu: boolean) => {
      const encoderFlags = buildEncoderFlags(useGpu);

      // Build FFmpeg command
      const args = [
        '-y', // Overwrite output
        '-i', videoPath,
        // Loop template image for the entire processing duration
        '-loop', '1',
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
      const stderrLines: string[] = [];

      ffmpeg.stderr.on('data', (data: Buffer) => {
        const line = data.toString();
        // Keep a rolling buffer of stderr lines for better diagnostics
        for (const l of line.split(/\r?\n/)) {
          const trimmed = l.trim();
          if (!trimmed) continue;
          stderrLines.push(trimmed);
          if (stderrLines.length > 200) stderrLines.shift();
        }

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
            message: `Processando... ${progress}%${useGpu ? ' (GPU)' : ' (CPU)'}`,
            fps: fpsMatch ? parseFloat(fpsMatch[1]) : undefined,
            speed: speedMatch ? `${speedMatch[1]}x` : undefined,
          });
        }
      });

      return new Promise<{ code: number | null; stderrTail: string; stderrAll: string }>((res) => {
        ffmpeg.on('close', (code) => {
          const stderrAll = stderrLines.join('\n');
          const stderrTail = stderrLines.slice(-25).join('\n');
          res({ code, stderrTail, stderrAll });
        });

        ffmpeg.on('error', (error) => {
          const stderrAll = stderrLines.join('\n');
          const stderrTail = stderrLines.slice(-25).join('\n');
          // Use -1 to represent spawn-level errors
          console.error('[FFmpeg] spawn error:', error);
          res({ code: -1, stderrTail, stderrAll: `${stderrAll}\n${error.message}`.trim() });
        });
      });
    };

      // First attempt: respect user setting
      const firstUseGpu = !!settings.useGPU;
      const first = await runOnce(firstUseGpu);

      if (first.code === 0) {
        onProgress({
          videoPath,
          progress: 100,
          stage: 'done',
          message: 'Concluído!',
        });
        resolve({ success: true, outputPath });
        return;
      }

      // If NVENC fails due to driver incompatibility, auto-fallback to CPU
      if (firstUseGpu && isNvencDriverIssue(first.stderrAll)) {
        onProgress({
          videoPath,
          progress: 0,
          stage: 'processing',
          message: 'GPU incompatível (driver antigo). Reprocessando no CPU...',
        });

        const second = await runOnce(false);
        if (second.code === 0) {
          onProgress({
            videoPath,
            progress: 100,
            stage: 'done',
            message: 'Concluído! (CPU)',
          });
          resolve({ success: true, outputPath });
          return;
        }

        const hint2 = second.stderrTail
          ? `\n\n--- FFmpeg stderr (últimas linhas) ---\n${second.stderrTail}`
          : '';
        onProgress({
          videoPath,
          progress: 0,
          stage: 'error',
          message: `FFmpeg saiu com código ${second.code}${hint2}`,
        });
        resolve({ success: false, error: `FFmpeg exit code: ${second.code}${hint2}` });
        return;
      }

      const hint = first.stderrTail
        ? `\n\n--- FFmpeg stderr (últimas linhas) ---\n${first.stderrTail}`
        : '';

      onProgress({
        videoPath,
        progress: 0,
        stage: 'error',
        message: `FFmpeg saiu com código ${first.code}${hint}`,
      });
      resolve({ success: false, error: `FFmpeg exit code: ${first.code}${hint}` });
    })();
  });
}
