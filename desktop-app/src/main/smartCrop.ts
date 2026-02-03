/**
 * Smart Crop Detection - Detecta molduras de QUALQUER cor usando edgedetect
 * 
 * Este módulo usa detecção de bordas (edge detection) em vez de detecção de cores,
 * permitindo identificar molduras pretas, brancas, azuis ou de qualquer outra cor.
 * 
 * O processo:
 * 1. Aplica edgedetect para encontrar linhas/divisórias no vídeo
 * 2. Usa cropdetect na imagem processada para identificar a área útil
 * 3. Retorna as coordenadas de recorte para remover molduras
 */

import { spawn, spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';

export interface SmartCropInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  hasBorders: boolean;
  detectionMethod: 'edgedetect' | 'cropdetect' | 'none';
}

/**
 * Get FFmpeg path with relative/portable path support
 */
function getFFmpegPath(): string {
  const platform = process.platform;
  const ext = platform === 'win32' ? '.exe' : '';

  // 1. Bundled FFmpeg (packaged app)
  if (app.isPackaged) {
    const bundledPath = join(process.resourcesPath, 'ffmpeg-bin', `ffmpeg${ext}`);
    if (existsSync(bundledPath)) {
      return bundledPath;
    }
  }

  // 2. Relative path from app directory (dev mode)
  const relativePaths = [
    join(__dirname, '..', '..', 'ffmpeg-bin', `ffmpeg${ext}`),
    join(__dirname, '..', 'ffmpeg-bin', `ffmpeg${ext}`),
    join(process.cwd(), 'ffmpeg-bin', `ffmpeg${ext}`),
  ];

  for (const p of relativePaths) {
    if (existsSync(p)) {
      console.log('[SmartCrop] Using relative FFmpeg:', p);
      return p;
    }
  }

  // 3. Common Windows installation paths
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

  // 4. Fallback to system PATH
  return 'ffmpeg';
}

/**
 * Get video dimensions synchronously
 */
function getVideoDimensionsSync(
  videoPath: string,
  ffprobePath: string
): { width: number; height: number; duration: number } {
  const result = spawnSync(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    videoPath,
  ], { encoding: 'utf8', timeout: 10000 });

  let width = 1920;
  let height = 1080;
  let duration = 10;

  if (result.status === 0 && result.stdout.trim()) {
    const lines = result.stdout.trim().split('\n');
    // First line: width,height
    if (lines[0]) {
      const [w, h] = lines[0].split(',').map(Number);
      if (w && h) {
        width = w;
        height = h;
      }
    }
    // Second line: duration
    if (lines[1]) {
      const d = parseFloat(lines[1]);
      if (d && d > 0) {
        duration = d;
      }
    }
  }

  return { width, height, duration };
}

/**
 * Detecta molduras usando edgedetect + cropdetect
 * Funciona com molduras de QUALQUER cor (preta, branca, colorida)
 * 
 * @param videoPath - Caminho do vídeo
 * @param sampleDurationSeconds - Duração da análise (padrão: 5s)
 * @returns SmartCropInfo com coordenadas de recorte
 */
export async function detectSmartCrop(
  videoPath: string,
  sampleDurationSeconds: number = 5
): Promise<SmartCropInfo> {
  const startTime = Date.now();
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

  console.log('[SmartCrop] Starting smart border detection...');
  console.log('[SmartCrop] FFmpeg path:', ffmpegPath);

  // Get video dimensions and duration
  const dims = getVideoDimensionsSync(videoPath, ffprobePath);
  const originalWidth = dims.width;
  const originalHeight = dims.height;

  console.log(`[SmartCrop] Video: ${originalWidth}x${originalHeight}, duration: ${dims.duration}s`);

  // Clamp sample duration to video duration
  const analyzeDuration = Math.min(sampleDurationSeconds, dims.duration - 1, 5);

  return new Promise((resolve) => {
    // Pipeline:
    // 1. Scale to 1080p for consistent analysis
    // 2. Apply edgedetect to find lines/borders (catches any color)
    // 3. Use cropdetect with round=16 for precision
    //
    // Params:
    // - edgedetect low=0.1 high=0.4: balanced sensitivity
    // - cropdetect limit=24 round=16: standard detection with good precision
    // - hwaccel=auto: try GPU acceleration if available
    const args = [
      '-hide_banner',
      '-hwaccel', 'auto', // Auto-detect hardware acceleration
      '-ss', '1', // Skip first second
      '-i', `"${videoPath}"`, // Quoted path for spaces/special chars
      '-t', String(analyzeDuration),
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,edgedetect=low=0.1:high=0.4,cropdetect=limit=24:round=16',
      '-f', 'null',
      '-',
    ];

    // Use shell: true for proper quote handling on Windows
    console.log('[SmartCrop] Running edgedetect + cropdetect...');
    const proc = spawn(ffmpegPath, args.map(a => a.replace(/^"|"$/g, '')), {
      windowsHide: true,
    });

    // Timeout: 15 seconds max
    const timeout = setTimeout(() => {
      console.log('[SmartCrop] Timeout, falling back to simple cropdetect');
      try { proc.kill('SIGKILL'); } catch {}
      // Fall back to simple cropdetect
      fallbackCropDetect(videoPath, ffmpegPath, originalWidth, originalHeight)
        .then(resolve)
        .catch(() => resolve({
          x: 0, y: 0,
          width: originalWidth,
          height: originalHeight,
          originalWidth,
          originalHeight,
          hasBorders: false,
          detectionMethod: 'none',
        }));
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

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const elapsed = Date.now() - startTime;

      if (cropMatches.length === 0) {
        console.log(`[SmartCrop] No crop detected (${elapsed}ms), using full frame`);
        resolve({
          x: 0, y: 0,
          width: originalWidth,
          height: originalHeight,
          originalWidth,
          originalHeight,
          hasBorders: false,
          detectionMethod: 'none',
        });
        return;
      }

      // Find most consistent crop value
      const bestCrop = findBestCrop(cropMatches, originalWidth, originalHeight);

      // Ensure even dimensions
      const width = bestCrop.w % 2 === 0 ? bestCrop.w : bestCrop.w - 1;
      const height = bestCrop.h % 2 === 0 ? bestCrop.h : bestCrop.h - 1;

      // Check if borders are significant enough to crop
      const hasBorders =
        width < originalWidth - 16 ||
        height < originalHeight - 16 ||
        bestCrop.x > 8 ||
        bestCrop.y > 8;

      console.log(`[SmartCrop] Detected: ${width}x${height} at ${bestCrop.x},${bestCrop.y} (borders: ${hasBorders}) [${elapsed}ms]`);

      resolve({
        x: bestCrop.x,
        y: bestCrop.y,
        width,
        height,
        originalWidth,
        originalHeight,
        hasBorders,
        detectionMethod: 'edgedetect',
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[SmartCrop] Process error:', err);
      resolve({
        x: 0, y: 0,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        hasBorders: false,
        detectionMethod: 'none',
      });
    });
  });
}

/**
 * Fallback: Simple cropdetect without edgedetect
 * Used when edgedetect times out or fails
 */
async function fallbackCropDetect(
  videoPath: string,
  ffmpegPath: string,
  originalWidth: number,
  originalHeight: number
): Promise<SmartCropInfo> {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-hwaccel', 'auto',
      '-ss', '1',
      '-i', videoPath,
      '-t', '2',
      '-vf', 'cropdetect=limit=24:round=2',
      '-f', 'null',
      '-',
    ];

    const proc = spawn(ffmpegPath, args);
    const cropMatches: Array<{ w: number; h: number; x: number; y: number }> = [];

    const timeout = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve({
        x: 0, y: 0,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        hasBorders: false,
        detectionMethod: 'none',
      });
    }, 10000);

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
          hasBorders: false,
          detectionMethod: 'none',
        });
        return;
      }

      const bestCrop = findBestCrop(cropMatches, originalWidth, originalHeight);
      const width = bestCrop.w % 2 === 0 ? bestCrop.w : bestCrop.w - 1;
      const height = bestCrop.h % 2 === 0 ? bestCrop.h : bestCrop.h - 1;

      const hasBorders =
        width < originalWidth - 8 ||
        height < originalHeight - 8 ||
        bestCrop.x > 4 ||
        bestCrop.y > 4;

      resolve({
        x: bestCrop.x,
        y: bestCrop.y,
        width,
        height,
        originalWidth,
        originalHeight,
        hasBorders,
        detectionMethod: 'cropdetect',
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
        hasBorders: false,
        detectionMethod: 'none',
      });
    });
  });
}

/**
 * Find the most consistent crop value from multiple samples
 */
function findBestCrop(
  crops: Array<{ w: number; h: number; x: number; y: number }>,
  origW: number,
  origH: number
): { w: number; h: number; x: number; y: number } {
  if (crops.length === 0) {
    return { w: origW, h: origH, x: 0, y: 0 };
  }

  // Group by similar values (tolerance of 16px)
  const tolerance = 16;
  const grouped = new Map<string, { crop: typeof crops[0]; count: number }>();

  for (const crop of crops) {
    const key = `${Math.round(crop.w / tolerance) * tolerance}:${Math.round(crop.h / tolerance) * tolerance}:${Math.round(crop.x / tolerance) * tolerance}:${Math.round(crop.y / tolerance) * tolerance}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
    } else {
      grouped.set(key, { crop, count: 1 });
    }
  }

  // Sort by count (most frequent) then by area (larger first)
  const sorted = Array.from(grouped.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (b.crop.w * b.crop.h) - (a.crop.w * a.crop.h);
  });

  return sorted[0]?.crop || { w: origW, h: origH, x: 0, y: 0 };
}

/**
 * Generate FFmpeg crop filter string
 */
export function generateSmartCropFilter(cropInfo: SmartCropInfo): string | null {
  if (!cropInfo.hasBorders) {
    return null;
  }

  // Ensure even dimensions
  const w = cropInfo.width % 2 === 0 ? cropInfo.width : cropInfo.width - 1;
  const h = cropInfo.height % 2 === 0 ? cropInfo.height : cropInfo.height - 1;

  return `crop=${w}:${h}:${cropInfo.x}:${cropInfo.y}`;
}
