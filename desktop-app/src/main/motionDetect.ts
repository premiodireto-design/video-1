import { spawn, spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync, mkdtempSync, unlinkSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { app } from 'electron';

export interface MotionArea {
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  hasStaticBorders: boolean;
}

/**
 * Get FFmpeg path (same logic as ffmpeg.ts)
 */
function getFFmpegPath(): string {
  const platform = process.platform;
  const ext = platform === 'win32' ? '.exe' : '';

  if (app.isPackaged) {
    const bundledPath = join(process.resourcesPath, 'ffmpeg-bin', `ffmpeg${ext}`);
    if (existsSync(bundledPath)) {
      return bundledPath;
    }
  }

  if (platform === 'win32') {
    const commonPaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      join(process.env.USERPROFILE || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    ];
    for (const p of commonPaths) {
      if (existsSync(p)) return p;
    }
  }

  return 'ffmpeg';
}

/**
 * Get video dimensions using FFprobe (sync for speed)
 */
function getVideoDimensionsSync(
  videoPath: string,
  ffprobePath: string
): { width: number; height: number } {
  const result = spawnSync(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    videoPath,
  ], { encoding: 'utf8', timeout: 5000 });

  if (result.status === 0 && result.stdout.trim()) {
    const [width, height] = result.stdout.trim().split(',').map(Number);
    if (width && height) {
      return { width, height };
    }
  }

  return { width: 1920, height: 1080 };
}

/**
 * Fast detection of content area using cropdetect on a single frame.
 * This is optimized for speed - extracts one frame and runs cropdetect.
 * 
 * @param videoPath - Path to the video file
 * @returns MotionArea with the detected content boundaries
 */
export async function detectMotionArea(
  videoPath: string,
  _sampleCount: number = 6 // ignored, kept for API compatibility
): Promise<MotionArea> {
  const startTime = Date.now();
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

  // Get original video dimensions (sync for speed)
  const dims = getVideoDimensionsSync(videoPath, ffprobePath);
  const originalWidth = dims.width;
  const originalHeight = dims.height;

  console.log(`[MotionDetect] Dimensions: ${originalWidth}x${originalHeight}`);

  // Run cropdetect directly on the video (no frame extraction needed)
  // This is MUCH faster - single FFmpeg call
  return new Promise((resolve) => {
    const args = [
      '-ss', '1', // Skip first second
      '-i', videoPath,
      '-t', '0.5', // Analyze only 0.5 seconds
      '-vf', 'cropdetect=limit=24:round=2:reset=1',
      '-f', 'null',
      '-',
    ];

    console.log('[MotionDetect] Running fast cropdetect...');
    const proc = spawn(ffmpegPath, args);

    // Timeout de 5 segundos máximo
    const timeout = setTimeout(() => {
      console.log('[MotionDetect] Timeout, using full frame');
      try { proc.kill('SIGKILL'); } catch {}
      resolve({
        x: 0, y: 0,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        hasStaticBorders: false,
      });
    }, 5000);

    const cropMatches: Array<{ w: number; h: number; x: number; y: number }> = [];

    proc.stderr.on('data', (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
        if (match) {
          const [, w, h, x, y] = match.map(Number);
          cropMatches.push({ w, h, x, y });
        }
      }
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      const elapsed = Date.now() - startTime;
      
      if (cropMatches.length === 0) {
        console.log(`[MotionDetect] No crop detected (${elapsed}ms), using full frame`);
        resolve({
          x: 0, y: 0,
          width: originalWidth,
          height: originalHeight,
          originalWidth,
          originalHeight,
          hasStaticBorders: false,
        });
        return;
      }

      // Find the most common crop value (mode)
      const cropCounts = new Map<string, { count: number; crop: typeof cropMatches[0] }>();
      for (const crop of cropMatches) {
        const key = `${crop.w}:${crop.h}:${crop.x}:${crop.y}`;
        const existing = cropCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          cropCounts.set(key, { count: 1, crop });
        }
      }

      // Get the most frequent crop
      let bestCrop = cropMatches[cropMatches.length - 1];
      let maxCount = 0;
      for (const { count, crop } of cropCounts.values()) {
        if (count > maxCount) {
          maxCount = count;
          bestCrop = crop;
        }
      }

      // Ensure even dimensions
      const width = bestCrop.w % 2 === 0 ? bestCrop.w : bestCrop.w - 1;
      const height = bestCrop.h % 2 === 0 ? bestCrop.h : bestCrop.h - 1;

      // Check if there are significant borders to remove
      const hasStaticBorders =
        width < originalWidth - 8 ||
        height < originalHeight - 8 ||
        bestCrop.x > 4 ||
        bestCrop.y > 4;

      console.log(`[MotionDetect] Content area: ${width}x${height} at ${bestCrop.x},${bestCrop.y} (borders: ${hasStaticBorders}) [${elapsed}ms]`);

      resolve({
        x: bestCrop.x,
        y: bestCrop.y,
        width,
        height,
        originalWidth,
        originalHeight,
        hasStaticBorders,
      });
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve({
        x: 0, y: 0,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        hasStaticBorders: false,
      });
    });
  });
}

/**
 * Generates FFmpeg crop filter string for the motion area.
 * Returns null if no cropping is needed.
 */
export function generateMotionCropFilter(motionArea: MotionArea): string | null {
  if (!motionArea.hasStaticBorders) {
    return null;
  }

  // Ensure even dimensions
  const w = motionArea.width % 2 === 0 ? motionArea.width : motionArea.width - 1;
  const h = motionArea.height % 2 === 0 ? motionArea.height : motionArea.height - 1;

  return `crop=${w}:${h}:${motionArea.x}:${motionArea.y}`;
}
