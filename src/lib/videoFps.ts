export interface EstimateFpsOptions {
  sampleFrames?: number;
  timeoutMs?: number;
}

/**
 * Estimate the real display FPS of a playing <video> using requestVideoFrameCallback.
 * Returns null when unsupported or if it can't measure in time.
 */
export async function estimateVideoFps(
  video: HTMLVideoElement,
  opts: EstimateFpsOptions = {}
): Promise<number | null> {
  const sampleFrames = opts.sampleFrames ?? 20;
  const timeoutMs = opts.timeoutMs ?? 900;

  // Check if requestVideoFrameCallback is supported
  const rVFCMethod = (video as any).requestVideoFrameCallback;
  if (typeof rVFCMethod !== 'function') return null;
  if (video.paused || video.ended) return null;

  return new Promise<number | null>((resolve) => {
    let lastNow: number | null = null;
    const deltas: number[] = [];
    let frames = 0;
    const start = performance.now();
    let resolved = false;
    let timeoutId: number | null = null;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      if (deltas.length < 5) {
        resolve(null);
        return;
      }
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const fps = avg > 0 ? 1000 / avg : null;
      resolve(fps && Number.isFinite(fps) ? fps : null);
    };

    const tick = (now: number) => {
      if (resolved) return;
      if (video.paused || video.ended) {
        finish();
        return;
      }

      if (lastNow != null) {
        const d = now - lastNow;
        if (d > 0 && d < 200) deltas.push(d);
      }
      lastNow = now;
      frames += 1;

      if (frames >= sampleFrames || performance.now() - start >= timeoutMs) {
        finish();
        return;
      }

      try {
        // IMPORTANT: Call with correct 'this' context to avoid "Illegal invocation"
        rVFCMethod.call(video, tick);
      } catch {
        finish();
      }
    };

    timeoutId = window.setTimeout(() => finish(), timeoutMs + 200);
    try {
      // IMPORTANT: Call with correct 'this' context to avoid "Illegal invocation"
      rVFCMethod.call(video, tick);
    } catch {
      if (timeoutId) window.clearTimeout(timeoutId);
      resolve(null);
    }
  });
}

export function clampFps(fps: number, min = 24, max = 60) {
  return Math.max(min, Math.min(max, fps));
}
