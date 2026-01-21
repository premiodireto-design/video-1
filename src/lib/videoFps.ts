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

  const rVFC = (video as any).requestVideoFrameCallback as
    | ((cb: (now: number, meta: any) => void) => number)
    | undefined;

  if (typeof rVFC !== 'function') return null;
  if (video.paused || video.ended) return null;

  return new Promise<number | null>((resolve) => {
    let lastNow: number | null = null;
    const deltas: number[] = [];
    let frames = 0;
    const start = performance.now();
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
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

      if (frames >= sampleFrames || now - start >= timeoutMs) {
        finish();
        return;
      }

      try {
        rVFC(tick);
      } catch {
        finish();
      }
    };

    const timeoutId = window.setTimeout(() => finish(), timeoutMs + 200);
    try {
      rVFC(tick);
    } catch {
      window.clearTimeout(timeoutId);
      resolve(null);
    }
  });
}

export function clampFps(fps: number, min = 24, max = 60) {
  return Math.max(min, Math.min(max, fps));
}
