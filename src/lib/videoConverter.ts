import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let isLoading = false;

/**
 * Load FFmpeg single-threaded version (no SharedArrayBuffer required)
 */
export async function loadFFmpegConverter(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) {
    return ffmpeg;
  }

  if (isLoading) {
    // Wait for existing load to complete
    while (isLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (ffmpeg && ffmpeg.loaded) {
      return ffmpeg;
    }
  }

  isLoading = true;

  try {
    const ff = new FFmpeg();
    
    ff.on('log', ({ message }) => {
      console.log('[FFmpeg Converter]', message);
    });

    // Use single-threaded core (no SharedArrayBuffer needed)
    const baseURL = 'https://unpkg.com/@ffmpeg/core-st@0.12.6/dist/esm';
    
    await ff.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });

    ffmpeg = ff;
    return ff;
  } finally {
    isLoading = false;
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
  const outputName = filename.replace(/\.[^/.]+$/, '') + '.mp4';
  
  // Write input file
  await ff.writeFile(inputName, await fetchFile(webmBlob));
  
  // Set up progress tracking
  ff.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress(Math.round(progress * 100));
    }
  });
  
  // Convert to MP4 with high quality settings
  // -c:v libx264: H.264 codec
  // -preset veryfast: fast encoding
  // -crf 18: high quality
  // -c:a aac: AAC audio codec
  // -b:a 192k: audio bitrate
  // -pix_fmt yuv420p: compatibility
  // -movflags +faststart: web optimization
  await ff.exec([
    '-i', inputName,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    outputName
  ]);
  
  // Read output
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
