import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { app } from 'electron';

// Use the Supabase edge function URL
const SUPABASE_URL = 'https://xviadfsqehvtkonasmgj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2aWFkZnNxZWh2dGtvbmFzbWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNjA4OTYsImV4cCI6MjA4NTYzNjg5Nn0.bEsQJiumvHvF8Y3uN1qMuu9Moc8_oj9w9BAphzWFYWc';

export interface FrameAnalysis {
  hasFace: boolean;
  facePosition: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  contentFocus: {
    x: number;
    y: number;
  };
  suggestedCrop: {
    anchorX: number; // 0-1, horizontal anchor (0=left, 0.5=center, 1=right)
    anchorY: number; // 0-1, vertical anchor (0=top, 0.5=center, 1=bottom)
  };
  error?: string;
}

/**
 * Returns default analysis when AI is unavailable
 */
export function getDefaultAnalysis(): FrameAnalysis {
  return {
    hasFace: true,
    facePosition: null,
    contentFocus: { x: 0.5, y: 0.3 },
    suggestedCrop: { anchorX: 0.5, anchorY: 0.15 }, // Top-centered for talking heads
  };
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
 * Extracts the first frame of a video as a JPEG using FFmpeg
 */
export async function extractFirstFrame(videoPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFFmpegPath();
    const tempDir = mkdtempSync(join(tmpdir(), 'frame-'));
    const outputPath = join(tempDir, 'frame.jpg');

    const args = [
      '-y',
      '-ss', '0.5', // Seek to 0.5s to skip any initial black frames
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      '-f', 'image2',
      outputPath,
    ];

    console.log('[AIFraming] Extracting first frame...');
    const ffmpeg = spawn(ffmpegPath, args);
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && existsSync(outputPath)) {
        try {
          const imageBuffer = readFileSync(outputPath);
          const base64 = imageBuffer.toString('base64');
          const dataUrl = `data:image/jpeg;base64,${base64}`;

          // Cleanup temp files
          try {
            unlinkSync(outputPath);
            rmdirSync(tempDir);
          } catch {}

          console.log('[AIFraming] Frame extracted successfully');
          resolve(dataUrl);
        } catch (e) {
          reject(new Error(`Failed to read extracted frame: ${e}`));
        }
      } else {
        reject(new Error(`FFmpeg failed to extract frame: ${stderr.slice(-200)}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

/**
 * Calls the Supabase edge function to analyze a video frame
 */
export async function analyzeVideoFrame(imageBase64: string): Promise<FrameAnalysis> {
  try {
    console.log('[AIFraming] Calling analyze-frame edge function...');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-frame`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ imageBase64 }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('[AIFraming] Rate limited, using default analysis');
        return getDefaultAnalysis();
      }
      if (response.status === 402) {
        console.warn('[AIFraming] AI credits exhausted, using default analysis');
        return getDefaultAnalysis();
      }
      throw new Error(`Edge function error: ${response.status}`);
    }

    const data = await response.json() as FrameAnalysis;
    console.log('[AIFraming] Analysis result:', data);
    return data;
  } catch (e) {
    console.warn('[AIFraming] Analysis failed, using default:', e);
    return getDefaultAnalysis();
  }
}

/**
 * Calculates video positioning based on AI analysis
 * This replicates the logic from src/lib/frameAnalyzer.ts
 */
export function calculateSmartPosition(
  videoWidth: number,
  videoHeight: number,
  frameWidth: number,
  frameHeight: number,
  analysis: FrameAnalysis
): { offsetX: number; offsetY: number; scale: number } {
  const videoAspect = videoWidth / videoHeight;
  const frameAspect = frameWidth / frameHeight;

  // Calculate scale to cover the frame
  let scale: number;
  if (videoAspect > frameAspect) {
    // Video is wider than frame - scale by height
    scale = frameHeight / videoHeight;
  } else {
    // Video is taller than frame - scale by width
    scale = frameWidth / videoWidth;
  }

  const scaledWidth = videoWidth * scale;
  const scaledHeight = videoHeight * scale;

  // Calculate offsets based on AI analysis
  const { anchorX, anchorY } = analysis.suggestedCrop;

  // Calculate how much overflow we have
  const overflowX = scaledWidth - frameWidth;
  const overflowY = scaledHeight - frameHeight;

  // Position based on anchor points
  // anchorX=0 means keep left edge, anchorX=1 means keep right edge
  // anchorY=0 means keep top edge, anchorY=1 means keep bottom edge
  const offsetX = -overflowX * anchorX;
  const offsetY = -overflowY * anchorY;

  return {
    offsetX,
    offsetY,
    scale,
  };
}
