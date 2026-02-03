import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { app } from 'electron';

export interface GreenArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  success: boolean;
  area?: GreenArea;
  templateWidth?: number;
  templateHeight?: number;
  error?: string;
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
 * Get FFprobe path
 */
function getFFprobePath(): string {
  const ffmpegPath = getFFmpegPath();
  return ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
}

/**
 * Get image dimensions using FFprobe
 */
function getImageDimensions(imagePath: string): { width: number; height: number } | null {
  const ffprobePath = getFFprobePath();
  
  try {
    const result = spawnSync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=s=x:p=0',
      imagePath
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    });
    
    if (result.status !== 0) return null;
    
    const [widthStr, heightStr] = result.stdout.trim().split('x');
    const width = parseInt(widthStr, 10);
    const height = parseInt(heightStr, 10);
    
    if (isNaN(width) || isNaN(height)) return null;
    
    return { width, height };
  } catch {
    return null;
  }
}

/**
 * Detects a solid green (#00FF00) rectangular area in an image file
 * Uses FFmpeg to convert to raw RGB and then scans pixels
 */
export async function detectGreenArea(imagePath: string): Promise<DetectionResult> {
  console.log('[GreenDetection] Loading image:', imagePath);

  // Get dimensions first
  const dims = getImageDimensions(imagePath);
  if (!dims) {
    return {
      success: false,
      error: 'Não foi possível obter dimensões da imagem. Verifique se é um arquivo de imagem válido.',
    };
  }

  const { width, height } = dims;
  console.log('[GreenDetection] Image dimensions:', width, 'x', height);

  // Create temp file for raw RGB output
  const tempDir = mkdtempSync(join(tmpdir(), 'greendet-'));
  const rawPath = join(tempDir, 'pixels.raw');

  try {
    const ffmpegPath = getFFmpegPath();
    
    // Convert image to raw RGB24 format
    const result = spawnSync(ffmpegPath, [
      '-y',
      '-i', imagePath,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      rawPath
    ], {
      windowsHide: true,
      timeout: 30000
    });

    if (result.status !== 0 || !existsSync(rawPath)) {
      return {
        success: false,
        templateWidth: width,
        templateHeight: height,
        error: 'Falha ao processar imagem com FFmpeg.',
      };
    }

    // Read raw RGB data
    const rawData = readFileSync(rawPath);
    const expectedSize = width * height * 3;
    
    if (rawData.length !== expectedSize) {
      console.warn('[GreenDetection] Raw data size mismatch:', rawData.length, 'vs', expectedSize);
    }

    // Find green pixels with tolerance
    const greenPixels: { x: number; y: number }[] = [];
    const tolerance = 60; // Tolerance for compression artifacts

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        const r = rawData[i];
        const g = rawData[i + 1];
        const b = rawData[i + 2];

        // Check if pixel is close to #00FF00 (pure green)
        // Green should be high (>200), red and blue should be low (<tolerance)
        if (r < tolerance && g > 200 && b < tolerance) {
          greenPixels.push({ x, y });
        }
      }
    }

    console.log('[GreenDetection] Found', greenPixels.length, 'green pixels');

    if (greenPixels.length < 100) {
      return {
        success: false,
        templateWidth: width,
        templateHeight: height,
        error:
          'Não foi possível detectar a área verde (#00FF00). Verifique se o retângulo está preenchido com verde sólido (sem gradiente/sombra) e exporte novamente do Canva.',
      };
    }

    // Calculate bounding box
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const pixel of greenPixels) {
      if (pixel.x < minX) minX = pixel.x;
      if (pixel.y < minY) minY = pixel.y;
      if (pixel.x > maxX) maxX = pixel.x;
      if (pixel.y > maxY) maxY = pixel.y;
    }

    const area: GreenArea = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };

    console.log('[GreenDetection] Bounding box:', area);

    // Validate the detected area is a reasonable size
    if (area.width < 50 || area.height < 50) {
      return {
        success: false,
        templateWidth: width,
        templateHeight: height,
        error:
          'A área verde detectada é muito pequena. Certifique-se de que o retângulo verde tem pelo menos 50x50 pixels.',
      };
    }

    // Check if it's roughly rectangular (density check)
    const expectedPixels = area.width * area.height;
    const actualDensity = greenPixels.length / expectedPixels;

    console.log('[GreenDetection] Density:', (actualDensity * 100).toFixed(1), '%');

    if (actualDensity < 0.7) {
      return {
        success: false,
        templateWidth: width,
        templateHeight: height,
        error:
          'A área verde não parece ser um retângulo sólido. Verifique se não há gradientes, sombras ou formas irregulares.',
      };
    }

    console.log('[GreenDetection] ✓ Detection successful:', area);

    return {
      success: true,
      area,
      templateWidth: width,
      templateHeight: height,
    };
  } catch (error) {
    console.error('[GreenDetection] Error:', error);
    return {
      success: false,
      templateWidth: width,
      templateHeight: height,
      error: `Erro ao processar imagem: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // Cleanup temp files
    try {
      if (existsSync(rawPath)) unlinkSync(rawPath);
      rmdirSync(tempDir);
    } catch {}
  }
}
