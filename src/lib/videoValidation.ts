/**
 * Video validation utilities - checks if a WebM blob is valid and playable
 * by attempting to seek to multiple points in the video.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  failedAt?: string;
}

/**
 * Validates a video blob by loading it and attempting seeks at 25%, 50%, 75%.
 * Returns validation result indicating if the video is playable throughout.
 */
export async function validateVideoBlob(blob: Blob, timeoutMs = 8000): Promise<ValidationResult> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.style.position = 'fixed';
  video.style.left = '-99999px';
  video.style.top = '-99999px';
  video.style.width = '1px';
  video.style.height = '1px';
  document.body.appendChild(video);

  const url = URL.createObjectURL(blob);

  const cleanup = () => {
    URL.revokeObjectURL(url);
    try {
      video.pause();
      video.src = '';
      video.load();
      video.remove();
    } catch {}
  };

  try {
    // Load video metadata
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout loading metadata')), timeoutMs);
      
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      video.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Error loading video'));
      };
      
      video.src = url;
      video.load();
    });

    const duration = video.duration;
    if (!duration || !isFinite(duration) || duration <= 0) {
      cleanup();
      return { valid: false, error: 'Invalid duration', failedAt: 'metadata' };
    }

    console.log(`[VideoValidation] Duration: ${duration}s, testing seeks...`);

    // Test seeks at 25%, 50%, 75%
    const seekPoints = [0.25, 0.5, 0.75];
    
    for (const point of seekPoints) {
      const seekTime = duration * point;
      const pointLabel = `${Math.round(point * 100)}%`;
      
      try {
        await seekAndVerify(video, seekTime, timeoutMs / 3);
        console.log(`[VideoValidation] Seek to ${pointLabel} (${seekTime.toFixed(2)}s) OK`);
      } catch (err) {
        console.warn(`[VideoValidation] Seek to ${pointLabel} failed:`, err);
        cleanup();
        return { valid: false, error: `Failed at ${pointLabel}`, failedAt: pointLabel };
      }
    }

    cleanup();
    console.log('[VideoValidation] Video validated successfully');
    return { valid: true };

  } catch (err) {
    cleanup();
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.warn('[VideoValidation] Validation failed:', errorMsg);
    return { valid: false, error: errorMsg, failedAt: 'load' };
  }
}

async function seekAndVerify(video: HTMLVideoElement, targetTime: number, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Seek timeout')), timeoutMs);
    
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      clearTimeout(timeout);
      
      // Verify we can actually read the current time (not frozen)
      if (Math.abs(video.currentTime - targetTime) > 2) {
        reject(new Error(`Seek position mismatch: ${video.currentTime} vs ${targetTime}`));
        return;
      }
      
      // Try to draw a frame to verify decoder works
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, 64, 64);
          // If we get here without error, the frame is decodable
        }
      } catch (drawErr) {
        reject(new Error('Cannot decode frame at ' + targetTime));
        return;
      }
      
      resolve();
    };
    
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      clearTimeout(timeout);
      reject(new Error('Error during seek'));
    };
    
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = targetTime;
  });
}

/**
 * Get fallback recording options for when validation fails.
 * Uses VP8 (more compatible) and lower bitrate.
 */
export function getFallbackRecordingOptions(): {
  preferredMimeTypes: string[];
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
} {
  return {
    preferredMimeTypes: [
      'video/webm;codecs=vp8,opus', // VP8 is more stable than VP9 in many browsers
      'video/webm;codecs=vp8',
      'video/webm',
    ],
    videoBitsPerSecond: 4000000, // Lower bitrate for stability
    audioBitsPerSecond: 128000,
  };
}
