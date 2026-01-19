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

    // Carregar core/wasm/worker via BlobURL evita CORS e costuma ser mais estável.
    // Observação: o arquivo WASM é grande, então mantemos ele em CDN (não cabe no repo).

    const localBase = `${window.location.origin}/ffmpeg`;

    const pickBlobURL = async (candidates: string[], mime: string, label: string) => {
      for (const src of candidates) {
        try {
          return await toBlobURL(src, mime);
        } catch (e) {
          console.warn(`[FFmpeg Converter] Falha ao carregar ${label} de`, src, e);
        }
      }
      throw new Error(`Não foi possível carregar o motor de conversão (${label}).`);
    };

    const coreURL = await pickBlobURL(
      [
        `${localBase}/ffmpeg-core.js`,
        'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
      ],
      'text/javascript',
      'core'
    );

    const wasmURL = await pickBlobURL(
      [
        'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
      ],
      'application/wasm',
      'wasm'
    );

    const workerURL = await pickBlobURL(
      [
        'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.worker.js',
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.worker.js',
        `${localBase}/ffmpeg-core.worker.js`,
      ],
      'text/javascript',
      'worker'
    );

    await ff.load({ coreURL, wasmURL, workerURL });

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
  options?: {
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<Blob> {
  const ff = await loadFFmpegConverter();

  const inputName = 'input.webm';
  const outputName = 'output.mp4';

  const progressHandler = options?.onProgress
    ? ({ progress }: { progress: number }) => {
        options.onProgress?.(Math.round(progress * 100));
      }
    : null;

  // Always enforce a timeout via AbortSignal as well (some browsers/workers can get stuck).
  const timeoutMs = options?.timeoutMs ?? 3 * 60 * 1000; // 3 min
  const internalAbort = new AbortController();
  const linkAbort = () => {
    try {
      internalAbort.abort();
    } catch {}
  };

  let timeoutId: number | null = null;
  try {
    if (options?.signal) {
      if (options.signal.aborted) linkAbort();
      else options.signal.addEventListener('abort', linkAbort, { once: true });
    }

    timeoutId = window.setTimeout(() => {
      internalAbort.abort();
    }, timeoutMs);

    // Always clean old files if they exist (best-effort)
    try { await ff.deleteFile(inputName); } catch {}
    try { await ff.deleteFile(outputName); } catch {}

    await ff.writeFile(inputName, await fetchFile(webmBlob));

    if (progressHandler) {
      ff.on('progress', progressHandler);
    }

    // Convert to MP4 (H.264 + AAC)
    await ff.exec(
      [
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
      ],
      timeoutMs,
      { signal: internalAbort.signal }
    );

    const data = await ff.readFile(outputName);

    const bytes = data instanceof Uint8Array
      ? new Uint8Array(data)
      : new TextEncoder().encode(data as string);

    const isMp4 = bytes.length > 12 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70;

    if (!isMp4) {
      throw new Error('Conversão falhou: saída não parece MP4.');
    }

    return new Blob([bytes], { type: 'video/mp4' });
  } catch (err) {
    try {
      ff.terminate();
    } catch {}
    ffmpeg = null;
    throw err;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    if (options?.signal) {
      try {
        options.signal.removeEventListener('abort', linkAbort);
      } catch {}
    }

    if (progressHandler) {
      try {
        ff.off('progress', progressHandler);
      } catch {}
    }

    try { await ff.deleteFile(inputName); } catch {}
    try { await ff.deleteFile(outputName); } catch {}
  }
}

/**
 * Convert multiple WebM files to MP4
 */
export async function convertMultipleToMP4(
  files: { blob: Blob; filename: string }[],
  onProgress?: (current: number, total: number, filename: string) => void,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<{ blob: Blob; filename: string }[]> {
  const results: { blob: Blob; filename: string }[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (onProgress) {
      onProgress(i + 1, files.length, file.filename);
    }

    const mp4Blob = await convertWebMToMP4(file.blob, file.filename, {
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });
    const mp4Filename = file.filename.replace(/\.webm$/i, '.mp4');

    results.push({ blob: mp4Blob, filename: mp4Filename });
  }

  return results;
}
