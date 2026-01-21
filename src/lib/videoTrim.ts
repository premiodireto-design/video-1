import { fetchFile } from '@ffmpeg/util';

import { loadFFmpegConverter } from './videoConverter';

function pickExt(mimeType: string | undefined): { ext: 'webm' | 'mp4'; mime: string } {
  const t = (mimeType ?? '').toLowerCase();
  if (t.includes('mp4')) return { ext: 'mp4', mime: 'video/mp4' };
  return { ext: 'webm', mime: 'video/webm' };
}

/**
 * Test/workaround: trims the first N seconds using FFmpeg after the recording finishes.
 * This is intentionally simple and always re-encodes to avoid keyframe/seek issues.
 */
export async function trimStartWithFFmpeg(
  inputBlob: Blob,
  options: {
    trimSeconds: number;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<Blob> {
  const { ext, mime } = pickExt(inputBlob.type);
  const trimSeconds = Math.max(0, options.trimSeconds);
  if (!Number.isFinite(trimSeconds) || trimSeconds <= 0) return inputBlob;

  const ff = await loadFFmpegConverter();

  const inputName = `trim_input.${ext}`;
  const outputName = `trim_output.${ext}`;

  const timeoutMs = options.timeoutMs ?? 3 * 60 * 1000;
  const internalAbort = new AbortController();
  const linkAbort = () => {
    try {
      internalAbort.abort();
    } catch {}
  };

  let timeoutId: number | null = null;
  const progressHandler = options.onProgress
    ? ({ progress }: { progress: number }) => options.onProgress?.(Math.round(progress * 100))
    : null;

  try {
    if (options.signal) {
      if (options.signal.aborted) linkAbort();
      else options.signal.addEventListener('abort', linkAbort, { once: true });
    }

    timeoutId = window.setTimeout(() => {
      internalAbort.abort();
    }, timeoutMs);

    try {
      await ff.deleteFile(inputName);
    } catch {}
    try {
      await ff.deleteFile(outputName);
    } catch {}

    await ff.writeFile(inputName, await fetchFile(inputBlob));

    if (progressHandler) ff.on('progress', progressHandler);

    // Re-encode and reset timestamps so the output starts at t=0.
    // IMPORTANT: many “first second freeze” issues are actually timestamp/PTS problems.
    // We prefer accurate seeking by placing `-ss` AFTER `-i`.
    const baseFilters = ['-vf', 'setpts=PTS-STARTPTS', '-af', 'asetpts=PTS-STARTPTS'];
    const baseTsFix = ['-avoid_negative_ts', 'make_zero', '-reset_timestamps', '1', '-fflags', '+genpts'];

    const buildCmdAccurate = () =>
      ext === 'mp4'
        ? [
            '-i',
            inputName,
            '-ss',
            `${trimSeconds}`,
            ...baseFilters,
            ...baseTsFix,
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '23',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            '-y',
            outputName,
          ]
        : [
            '-i',
            inputName,
            '-ss',
            `${trimSeconds}`,
            ...baseFilters,
            ...baseTsFix,
            '-c:v',
            'libvpx',
            '-b:v',
            '3M',
            '-crf',
            '10',
            '-c:a',
            'libopus',
            '-b:a',
            '128k',
            '-y',
            outputName,
          ];

    // Fallback: faster seeking by placing `-ss` BEFORE `-i` (less accurate but can be more reliable on some inputs).
    const buildCmdFastSeek = () =>
      ext === 'mp4'
        ? [
            '-ss',
            `${trimSeconds}`,
            '-i',
            inputName,
            ...baseFilters,
            ...baseTsFix,
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '23',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            '-y',
            outputName,
          ]
        : [
            '-ss',
            `${trimSeconds}`,
            '-i',
            inputName,
            ...baseFilters,
            ...baseTsFix,
            '-c:v',
            'libvpx',
            '-b:v',
            '3M',
            '-crf',
            '10',
            '-c:a',
            'libopus',
            '-b:a',
            '128k',
            '-y',
            outputName,
          ];

    console.log('[VideoTrim] Trimming start with FFmpeg:', { ext, trimSeconds });

    try {
      await ff.exec(buildCmdAccurate());
    } catch (e) {
      console.warn('[VideoTrim] Accurate seek trim failed; retrying with fast seek...', e);
      // Best-effort cleanup before retry
      try {
        await ff.deleteFile(outputName);
      } catch {}
      await ff.exec(buildCmdFastSeek());
    }

    const data = await ff.readFile(outputName);
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(data as string);
    return new Blob([bytes], { type: mime });
  } catch (err) {
    // If FFmpeg stalls, reset it so future conversions can recover.
    try {
      ff.terminate();
    } catch {}
    throw err;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    if (options.signal) {
      try {
        options.signal.removeEventListener('abort', linkAbort);
      } catch {}
    }
    if (progressHandler) {
      try {
        ff.off('progress', progressHandler);
      } catch {}
    }
    try {
      await ff.deleteFile(inputName);
    } catch {}
    try {
      await ff.deleteFile(outputName);
    } catch {}
  }
}
