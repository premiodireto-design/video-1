import { spawn, spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';

export interface CropInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  hasBorders: boolean;
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
 * Detects black/white borders (letterboxing) in a video using FFmpeg's cropdetect filter.
 * This analyzes multiple frames to find the actual content area.
 * 
 * @param videoPath - Path to the video file
 * @param sampleDurationSeconds - How many seconds to analyze (default: 5)
 * @returns CropInfo with the detected content boundaries
 */
export async function detectVideoBorders(
  videoPath: string,
  sampleDurationSeconds: number = 5
): Promise<CropInfo> {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

  // First, get original video dimensions
  const dims = await getVideoDimensions(videoPath, ffprobePath);
  const originalWidth = dims.width;
  const originalHeight = dims.height;

  console.log(`[CropDetect] Original dimensions: ${originalWidth}x${originalHeight}`);

  return new Promise((resolve) => {
    // Use cropdetect filter to detect borders
    // - limit: threshold for black (24 is good for near-black borders)
    // - round: round dimensions to multiples (2 for even values)
    // - reset: reset detection every N frames (0 = never reset, accumulate best crop)
    // We use a higher limit (40) to also catch very dark gray borders
    const args = [
      '-hide_banner',
      '-i', videoPath,
      '-t', String(sampleDurationSeconds),
      '-vf', 'cropdetect=limit=40:round=2:reset=0',
      '-f', 'null',
      '-',
    ];

    console.log('[CropDetect] Running cropdetect...');
    const ffmpeg = spawn(ffmpegPath, args);

    let stderr = '';
    const cropMatches: Array<{ w: number; h: number; x: number; y: number }> = [];

    ffmpeg.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();

      // Parse crop values from stderr: crop=1920:1080:0:0
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
        if (match) {
          const [, w, h, x, y] = match.map(Number);
          cropMatches.push({ w, h, x, y });
        }
      }
    });

    ffmpeg.on('close', (code) => {
      if (cropMatches.length === 0) {
        console.log('[CropDetect] No crop detected, using full frame');
        resolve({
          x: 0,
          y: 0,
          width: originalWidth,
          height: originalHeight,
          originalWidth,
          originalHeight,
          hasBorders: false,
        });
        return;
      }

      // Get the most common/stable crop values (last few are usually best)
      // Use the last 10 values or all if fewer
      const recentCrops = cropMatches.slice(-10);
      
      // Find the most restrictive crop that appeared consistently
      // (smallest content area that removes all borders)
      const bestCrop = findBestCrop(recentCrops, originalWidth, originalHeight);

      const hasBorders = 
        bestCrop.w < originalWidth - 4 || 
        bestCrop.h < originalHeight - 4 ||
        bestCrop.x > 2 ||
        bestCrop.y > 2;

      console.log(`[CropDetect] Detected crop: ${bestCrop.w}x${bestCrop.h} at ${bestCrop.x},${bestCrop.y} (hasBorders: ${hasBorders})`);

      resolve({
        x: bestCrop.x,
        y: bestCrop.y,
        width: bestCrop.w,
        height: bestCrop.h,
        originalWidth,
        originalHeight,
        hasBorders,
      });
    });

    ffmpeg.on('error', (err) => {
      console.error('[CropDetect] FFmpeg error:', err);
      resolve({
        x: 0,
        y: 0,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        hasBorders: false,
      });
    });
  });
}

/**
 * Find the best crop from multiple samples.
 * Prioritizes the most common values, with a slight preference for larger content areas.
 */
function findBestCrop(
  crops: Array<{ w: number; h: number; x: number; y: number }>,
  origW: number,
  origH: number
): { w: number; h: number; x: number; y: number } {
  if (crops.length === 0) {
    return { w: origW, h: origH, x: 0, y: 0 };
  }

  // Group crops by their values (with small tolerance for jitter)
  const tolerance = 8;
  const grouped = new Map<string, { crop: typeof crops[0]; count: number }>();

  for (const crop of crops) {
    // Quantize to reduce jitter
    const key = `${Math.round(crop.w / tolerance) * tolerance}:${Math.round(crop.h / tolerance) * tolerance}:${Math.round(crop.x / tolerance) * tolerance}:${Math.round(crop.y / tolerance) * tolerance}`;
    
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
    } else {
      grouped.set(key, { crop, count: 1 });
    }
  }

  // Sort by count (most common first), then by area (larger first)
  const sorted = Array.from(grouped.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (b.crop.w * b.crop.h) - (a.crop.w * a.crop.h);
  });

  return sorted[0]?.crop || { w: origW, h: origH, x: 0, y: 0 };
}

/**
 * Get video dimensions using FFprobe
 */
async function getVideoDimensions(
  videoPath: string,
  ffprobePath: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const result = spawnSync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      videoPath,
    ], { encoding: 'utf8', timeout: 10000 });

    if (result.status === 0 && result.stdout.trim()) {
      const [width, height] = result.stdout.trim().split(',').map(Number);
      if (width && height) {
        resolve({ width, height });
        return;
      }
    }

    // Fallback
    resolve({ width: 1920, height: 1080 });
  });
}

/**
 * Generates FFmpeg crop filter string to remove detected borders.
 * Returns null if no cropping is needed.
 */
export function generateCropFilter(cropInfo: CropInfo): string | null {
  if (!cropInfo.hasBorders) {
    return null;
  }

  // Ensure even dimensions
  const w = cropInfo.width % 2 === 0 ? cropInfo.width : cropInfo.width - 1;
  const h = cropInfo.height % 2 === 0 ? cropInfo.height : cropInfo.height - 1;
  const x = cropInfo.x;
  const y = cropInfo.y;

  return `crop=${w}:${h}:${x}:${y}`;
}
