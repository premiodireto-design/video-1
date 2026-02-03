import { spawn, spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync, mkdtempSync, readdirSync, readFileSync, unlinkSync, rmdirSync } from 'fs';
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

    resolve({ width: 1920, height: 1080 });
  });
}

/**
 * Detects the area with actual motion/video content by comparing frames.
 * This finds the region where pixels CHANGE between frames, ignoring:
 * - Static overlays (text, logos)
 * - Black/colored borders
 * - Any static content
 * 
 * @param videoPath - Path to the video file
 * @param sampleCount - How many frames to sample (default: 6)
 * @returns MotionArea with the detected motion boundaries
 */
export async function detectMotionArea(
  videoPath: string,
  sampleCount: number = 6
): Promise<MotionArea> {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

  // Get original video dimensions
  const dims = await getVideoDimensions(videoPath, ffprobePath);
  const originalWidth = dims.width;
  const originalHeight = dims.height;

  console.log(`[MotionDetect] Original dimensions: ${originalWidth}x${originalHeight}`);

  // Create temp directory for frame extraction
  const tempDir = mkdtempSync(join(tmpdir(), 'motion-'));

  try {
    // Step 1: Get video duration
    const durationResult = spawnSync(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoPath,
    ], { encoding: 'utf8', timeout: 10000 });

    let duration = 10; // fallback
    if (durationResult.status === 0 && durationResult.stdout.trim()) {
      duration = parseFloat(durationResult.stdout.trim()) || 10;
    }
    console.log(`[MotionDetect] Video duration: ${duration}s`);

    // Step 2: Extract frames at different timestamps (skip first and last 0.5s)
    const startTime = 0.5;
    const endTime = Math.max(1, duration - 0.5);
    const interval = (endTime - startTime) / (sampleCount - 1);

    console.log(`[MotionDetect] Extracting ${sampleCount} frames...`);

    const extractPromises: Promise<void>[] = [];
    for (let i = 0; i < sampleCount; i++) {
      const timestamp = startTime + (interval * i);
      const outputPath = join(tempDir, `frame_${i.toString().padStart(3, '0')}.png`);

      extractPromises.push(new Promise((resolve) => {
        const args = [
          '-ss', String(timestamp),
          '-i', videoPath,
          '-frames:v', '1',
          '-f', 'image2',
          '-y',
          outputPath,
        ];

        const proc = spawn(ffmpegPath, args);
        
        // Timeout de 15 segundos por frame
        const timeout = setTimeout(() => {
          console.log(`[MotionDetect] Frame ${i} extraction timeout, killing process`);
          try { proc.kill('SIGKILL'); } catch {}
          resolve();
        }, 15000);

        proc.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
        proc.on('error', (err) => {
          console.log(`[MotionDetect] Frame ${i} extraction error:`, err.message);
          clearTimeout(timeout);
          resolve();
        });
      }));
    }

    await Promise.all(extractPromises);

    // Step 3: Read all frames and find motion area
    const frameFiles = readdirSync(tempDir).filter(f => f.endsWith('.png')).sort();

    if (frameFiles.length < 2) {
      console.log('[MotionDetect] Not enough frames, using full area');
      return {
        x: 0, y: 0,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        hasStaticBorders: false,
      };
    }

    // Use FFmpeg to create a motion difference mask
    // Compare consecutive frames and find where they differ
    console.log(`[MotionDetect] Analyzing motion across ${frameFiles.length} frames...`);

    const motionResult = await analyzeMotionWithFFmpeg(
      tempDir,
      frameFiles,
      originalWidth,
      originalHeight,
      ffmpegPath
    );

    // Cleanup temp files
    try {
      for (const file of readdirSync(tempDir)) {
        unlinkSync(join(tempDir, file));
      }
      rmdirSync(tempDir);
    } catch {}

    return motionResult;

  } catch (error) {
    console.error('[MotionDetect] Error:', error);

    // Cleanup on error
    try {
      for (const file of readdirSync(tempDir)) {
        unlinkSync(join(tempDir, file));
      }
      rmdirSync(tempDir);
    } catch {}

    return {
      x: 0, y: 0,
      width: originalWidth,
      height: originalHeight,
      originalWidth,
      originalHeight,
      hasStaticBorders: false,
    };
  }
}

/**
 * Analyzes motion between frames using FFmpeg filters
 */
async function analyzeMotionWithFFmpeg(
  tempDir: string,
  frameFiles: string[],
  originalWidth: number,
  originalHeight: number,
  ffmpegPath: string
): Promise<MotionArea> {
  // Strategy: Use blend filter to find difference between frames,
  // then use crop detection on the difference to find the motion area

  const framePaths = frameFiles.map(f => join(tempDir, f));
  const diffPath = join(tempDir, 'motion_diff.png');

  // Create a composite showing maximum difference across all frame pairs
  // This highlights areas with motion and darkens static areas
  const inputArgs: string[] = [];
  framePaths.forEach((p, i) => {
    inputArgs.push('-i', p);
  });

  // Build filter to blend consecutive frames and accumulate differences
  // blend=all_mode=difference shows only pixels that changed
  const filterParts: string[] = [];
  
  // Create difference between each consecutive pair
  for (let i = 0; i < framePaths.length - 1; i++) {
    filterParts.push(`[${i}:v][${i + 1}:v]blend=all_mode=difference[diff${i}]`);
  }

  // Merge all differences using lighten mode (shows max change)
  if (filterParts.length === 1) {
    filterParts.push(`[diff0]format=gray,eq=brightness=0.5:contrast=3[out]`);
  } else {
    // Chain lighten blend to accumulate all differences
    let currentLabel = 'diff0';
    for (let i = 1; i < filterParts.length; i++) {
      const nextLabel = i === filterParts.length - 1 ? 'merged' : `acc${i}`;
      filterParts.push(`[${currentLabel}][diff${i}]blend=all_mode=lighten[${nextLabel}]`);
      currentLabel = nextLabel;
    }
    filterParts.push(`[merged]format=gray,eq=brightness=0.5:contrast=3[out]`);
  }

  const filterComplex = filterParts.join(';');

  // Run FFmpeg to create motion difference image
  return new Promise((resolve) => {
    const args = [
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-y',
      diffPath,
    ];

    console.log('[MotionDetect] Creating motion difference image...');
    const proc = spawn(ffmpegPath, args);

    // Timeout de 30 segundos para a análise de movimento
    const timeout = setTimeout(async () => {
      console.log('[MotionDetect] Motion analysis timeout, killing process');
      try { proc.kill('SIGKILL'); } catch {}
      resolve(await fallbackCropDetect(framePaths[0], originalWidth, originalHeight, ffmpegPath));
    }, 30000);

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !existsSync(diffPath)) {
        console.log('[MotionDetect] Motion diff failed, trying cropdetect fallback');
        resolve(await fallbackCropDetect(framePaths[0], originalWidth, originalHeight, ffmpegPath));
        return;
      }

      // Now run cropdetect on the difference image
      // The motion area will be the bright (white) area in the diff
      const cropResult = await detectCropFromDiff(diffPath, originalWidth, originalHeight, ffmpegPath);

      // Cleanup diff image
      try { unlinkSync(diffPath); } catch {}

      resolve(cropResult);
    });

    proc.on('error', async () => {
      clearTimeout(timeout);
      resolve(await fallbackCropDetect(framePaths[0], originalWidth, originalHeight, ffmpegPath));
    });
  });
}

/**
 * Detect crop boundaries from the motion difference image
 */
async function detectCropFromDiff(
  diffPath: string,
  originalWidth: number,
  originalHeight: number,
  ffmpegPath: string
): Promise<MotionArea> {
  return new Promise((resolve) => {
    // Use cropdetect on the inverted diff image (motion areas are bright)
    // We need to detect the bounding box of the bright areas
    const args = [
      '-i', diffPath,
      '-vf', 'negate,cropdetect=limit=30:round=2:reset=0',
      '-f', 'null',
      '-frames:v', '1',
      '-',
    ];

    console.log('[MotionDetect] Running cropdetect on motion diff...');
    const proc = spawn(ffmpegPath, args);

    // Timeout de 15 segundos
    const timeout = setTimeout(() => {
      console.log('[MotionDetect] Cropdetect timeout, using full frame');
      try { proc.kill('SIGKILL'); } catch {}
      resolve({
        x: 0, y: 0,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        hasStaticBorders: false,
      });
    }, 15000);

    let stderr = '';
    const cropMatches: Array<{ w: number; h: number; x: number; y: number }> = [];

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
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
      if (cropMatches.length === 0) {
        console.log('[MotionDetect] No motion crop detected, using full frame');
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

      // Use the last (most stable) crop value
      const bestCrop = cropMatches[cropMatches.length - 1];

      // Add small padding to ensure we don't clip actual content
      const padding = 4;
      const x = Math.max(0, bestCrop.x - padding);
      const y = Math.max(0, bestCrop.y - padding);
      const width = Math.min(originalWidth - x, bestCrop.w + padding * 2);
      const height = Math.min(originalHeight - y, bestCrop.h + padding * 2);

      // Make dimensions even for codec compatibility
      const evenWidth = width % 2 === 0 ? width : width - 1;
      const evenHeight = height % 2 === 0 ? height : height - 1;

      const hasStaticBorders =
        evenWidth < originalWidth - 8 ||
        evenHeight < originalHeight - 8 ||
        x > 4 ||
        y > 4;

      console.log(`[MotionDetect] Motion area: ${evenWidth}x${evenHeight} at ${x},${y} (hasBorders: ${hasStaticBorders})`);

      resolve({
        x,
        y,
        width: evenWidth,
        height: evenHeight,
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
 * Fallback to standard cropdetect if motion detection fails
 */
async function fallbackCropDetect(
  framePath: string,
  originalWidth: number,
  originalHeight: number,
  ffmpegPath: string
): Promise<MotionArea> {
  return new Promise((resolve) => {
    const args = [
      '-i', framePath,
      '-vf', 'cropdetect=limit=40:round=2',
      '-f', 'null',
      '-frames:v', '1',
      '-',
    ];

    console.log('[MotionDetect] Running fallback cropdetect...');
    const proc = spawn(ffmpegPath, args);

    // Timeout de 15 segundos
    const timeout = setTimeout(() => {
      console.log('[MotionDetect] Fallback cropdetect timeout');
      try { proc.kill('SIGKILL'); } catch {}
      resolve({
        x: 0, y: 0,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        hasStaticBorders: false,
      });
    }, 15000);

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
      if (cropMatches.length === 0) {
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

      const bestCrop = cropMatches[cropMatches.length - 1];
      const hasStaticBorders =
        bestCrop.w < originalWidth - 4 ||
        bestCrop.h < originalHeight - 4;

      resolve({
        x: bestCrop.x,
        y: bestCrop.y,
        width: bestCrop.w,
        height: bestCrop.h,
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
