import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

/**
 * Load FFmpeg single-threaded version (no SharedArrayBuffer required).
 * Uses toBlobURL to avoid CORS issues when loading from CDN.
 */
export async function loadFFmpegConverter(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const ff = new FFmpeg();

    ff.on('log', ({ message }) => {
      console.log('[FFmpeg Converter]', message);
    });

    // Single-threaded core (no SharedArrayBuffer needed)
    const baseURL = 'https://unpkg.com/@ffmpeg/core-st@0.12.6/dist/esm';

    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpeg = ff;
    return ff;
  })();

  try {
    return await loadingPromise;
  } finally {
    // keep ffmpeg cached; clear only the promise
    loadingPromise = null;
  }
}

/**
 * Convert WebM to MP4 using FFmpeg
 */
export async function convertWebMToMP4(
  webmBlob: Blob,
  filename: string,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ff = await loadFFmpegConverter();

  const inputName = 'input.webm';
  const outputName = 'output.mp4';

  // Always clean old files if they exist (best-effort)
  try { await ff.deleteFile(inputName); } catch {}
  try { await ff.deleteFile(outputName); } catch {}

  await ff.writeFile(inputName, await fetchFile(webmBlob));

  // Set up progress tracking
  if (onProgress) {
    ff.on('progress', ({ progress }) => {
      onProgress(Math.round(progress * 100));
    });
  }

  // Convert to MP4 (H.264 + AAC) in FULL HD (1080x1920) at 30fps.
  // Note: audio might be missing if the input webm has no audio track.
  await ff.exec([
    '-i', inputName,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y',
    outputName,
  ]);

  const data = await ff.readFile(outputName);

  // Cleanup
  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);

  // Convert to Blob - create a new Uint8Array to avoid SharedArrayBuffer issues
  let blobData: BlobPart;
  if (data instanceof Uint8Array) {
    blobData = new Uint8Array(data);
  } else {
    blobData = new TextEncoder().encode(data as string);
  }

  return new Blob([blobData], { type: 'video/mp4' });
}

/**
 * Convert multiple WebM files to MP4
 */
export async function convertMultipleToMP4(
  files: { blob: Blob; filename: string }[],
  onProgress?: (current: number, total: number, filename: string) => void
): Promise<{ blob: Blob; filename: string }[]> {
  const results: { blob: Blob; filename: string }[] = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (onProgress) {
      onProgress(i + 1, files.length, file.filename);
    }
    
    const mp4Blob = await convertWebMToMP4(file.blob, file.filename);
    const mp4Filename = file.filename.replace(/\.webm$/i, '.mp4');
    
    results.push({ blob: mp4Blob, filename: mp4Filename });
  }
  
  return results;
}
