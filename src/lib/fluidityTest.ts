/**
 * Fluidity Test - measures dropped frames during a short render test
 * and recommends optimal FPS/resolution settings.
 */

export interface FluidityTestResult {
  originalFps: number;
  recommendedFps: number;
  droppedFrames: number;
  totalFrames: number;
  dropRate: number; // percentage
  recommendedResolution: '1080' | '720' | '540';
  quality: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface FluidityTestProgress {
  stage: 'preparing' | 'testing' | 'done';
  progress: number;
  message: string;
}

/**
 * Run a quick fluidity test using a video sample.
 * This test records a few seconds and measures frame drops.
 */
export async function runFluidityTest(
  videoFile: File,
  onProgress?: (progress: FluidityTestProgress) => void
): Promise<FluidityTestResult> {
  const video = document.createElement('video');
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.volume = 0;

  const videoUrl = URL.createObjectURL(videoFile);

  onProgress?.({
    stage: 'preparing',
    progress: 10,
    message: 'Carregando vídeo...',
  });

  await new Promise<void>((res, rej) => {
    video.oncanplaythrough = () => res();
    video.onerror = () => rej(new Error('Erro ao carregar vídeo'));
    video.src = videoUrl;
    video.load();
  });

  onProgress?.({
    stage: 'testing',
    progress: 30,
    message: 'Detectando FPS original...',
  });

  // Detect original FPS
  video.currentTime = 0;
  await new Promise<void>((r) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      r();
    };
    video.addEventListener('seeked', onSeeked);
    // If already at 0, trigger immediately
    if (video.currentTime === 0) r();
  });

  try {
    await video.play();
  } catch (playError) {
    console.warn('[FluidityTest] Play failed:', playError);
    URL.revokeObjectURL(videoUrl);
    // Return default values if playback fails
    return {
      originalFps: 30,
      recommendedFps: 30,
      droppedFrames: 0,
      totalFrames: 90,
      dropRate: 0,
      recommendedResolution: '1080',
      quality: 'good',
    };
  }

  const originalFps = await estimateFps(video);

  onProgress?.({
    stage: 'testing',
    progress: 50,
    message: `FPS detectado: ${originalFps}. Testando fluidez...`,
  });

  // Create test canvas (1080x1920)
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Reset video
  video.pause();
  video.currentTime = 0;
  await new Promise<void>((r) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      r();
    };
    video.addEventListener('seeked', onSeeked);
    if (video.currentTime === 0) r();
  });

  // Run test for 3 seconds
  const testDuration = 3; // seconds
  let framesRendered = 0;
  let droppedFrames = 0;
  const expectedInterval = 1000 / originalFps;
  let lastFrameTime = 0;
  const startTime = performance.now();
  let testRunning = true;

  try {
    await video.play();
  } catch (e) {
    console.warn('[FluidityTest] Second play failed:', e);
    URL.revokeObjectURL(videoUrl);
    return {
      originalFps: Math.round(originalFps),
      recommendedFps: 30,
      droppedFrames: 0,
      totalFrames: 90,
      dropRate: 0,
      recommendedResolution: '1080',
      quality: 'good',
    };
  }

  const rVFCMethod = (video as any).requestVideoFrameCallback;
  const hasRVFC = typeof rVFCMethod === 'function';

  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      if (!testRunning) return;

      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed >= testDuration || video.ended || video.paused) {
        testRunning = false;
        resolve();
        return;
      }

      // Render frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      framesRendered++;

      // Check for dropped frames (if interval is too long)
      if (lastFrameTime > 0) {
        const delta = now - lastFrameTime;
        // If delta is > 1.5x expected, we likely dropped frames
        if (delta > expectedInterval * 1.5) {
          const estimatedDropped = Math.floor(delta / expectedInterval) - 1;
          droppedFrames += estimatedDropped;
        }
      }
      lastFrameTime = now;

      // Update progress
      const progress = 50 + Math.round((elapsed / testDuration) * 40);
      onProgress?.({
        stage: 'testing',
        progress: Math.min(90, progress),
        message: `Testando... ${Math.round(elapsed)}s / ${testDuration}s`,
      });

      // Use correct 'this' context to avoid "Illegal invocation"
      if (hasRVFC) {
        rVFCMethod.call(video, tick);
      } else {
        requestAnimationFrame(() => tick(performance.now()));
      }
    };

    if (hasRVFC) {
      rVFCMethod.call(video, tick);
    } else {
      requestAnimationFrame(() => tick(performance.now()));
    }

    // Safety timeout
    setTimeout(() => {
      testRunning = false;
      resolve();
    }, (testDuration + 1) * 1000);
  });

  video.pause();
  URL.revokeObjectURL(videoUrl);

  const expectedFrames = Math.round(testDuration * originalFps);
  const totalFrames = framesRendered + droppedFrames;
  const dropRate = totalFrames > 0 ? (droppedFrames / totalFrames) * 100 : 0;

  // Determine recommendations
  let recommendedFps: number;
  let recommendedResolution: '1080' | '720' | '540';
  let quality: 'excellent' | 'good' | 'fair' | 'poor';

  if (dropRate < 3) {
    quality = 'excellent';
    recommendedFps = originalFps;
    recommendedResolution = '1080';
  } else if (dropRate < 8) {
    quality = 'good';
    recommendedFps = originalFps >= 60 ? 30 : originalFps;
    recommendedResolution = '1080';
  } else if (dropRate < 15) {
    quality = 'fair';
    recommendedFps = 30;
    recommendedResolution = '720';
  } else {
    quality = 'poor';
    recommendedFps = 24;
    recommendedResolution = '540';
  }

  onProgress?.({
    stage: 'done',
    progress: 100,
    message: 'Teste concluído!',
  });

  return {
    originalFps: Math.round(originalFps),
    recommendedFps,
    droppedFrames,
    totalFrames: expectedFrames,
    dropRate: Math.round(dropRate * 10) / 10,
    recommendedResolution,
    quality,
  };
}

async function estimateFps(video: HTMLVideoElement): Promise<number> {
  const rVFC = (video as any).requestVideoFrameCallback as
    | ((cb: (now: number, meta: any) => void) => number)
    | undefined;

  if (typeof rVFC !== 'function') {
    // Fallback: assume 30 fps
    return 30;
  }

  return new Promise<number>((resolve) => {
    const deltas: number[] = [];
    let lastNow: number | null = null;
    let frames = 0;
    const maxFrames = 30;

    const tick = (now: number) => {
      if (video.paused || video.ended) {
        finish();
        return;
      }

      if (lastNow !== null) {
        const d = now - lastNow;
        if (d > 0 && d < 200) deltas.push(d);
      }
      lastNow = now;
      frames++;

      if (frames >= maxFrames) {
        finish();
        return;
      }

      rVFC(tick);
    };

    const finish = () => {
      if (deltas.length < 5) {
        resolve(30);
        return;
      }
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const fps = avg > 0 ? 1000 / avg : 30;
      resolve(Math.min(60, Math.max(24, Math.round(fps))));
    };

    rVFC(tick);

    // Safety timeout
    setTimeout(finish, 2000);
  });
}
