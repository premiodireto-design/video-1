import { spawn, spawnSync, execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { app } from 'electron';
import { extractFirstFrame, analyzeVideoFrame, calculateSmartPosition, getDefaultAnalysis, type FrameAnalysis } from './aiFraming';
import { detectVideoBorders, generateCropFilter, type CropInfo } from './videoCropDetect';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function makeEven(n: number): number {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v + 1;
}

export interface GPUInfo {
  hasNvidia: boolean;
  hasIntelQSV: boolean;
  hasAMD: boolean;
  recommendedEncoder: string;
  availableEncoders: string[];
}

export interface ProcessingProgress {
  videoPath: string;
  progress: number;
  stage: 'analyzing' | 'processing' | 'done' | 'error';
  message: string;
  fps?: number;
  speed?: string;
}

/**
 * Get FFmpeg binary path
 * Tries bundled version first, then system FFmpeg, then common install locations
 */
function getFFmpegPath(): string {
  const platform = process.platform;
  const ext = platform === 'win32' ? '.exe' : '';
  
  console.log('[FFmpeg] Detecting FFmpeg path...');
  console.log('[FFmpeg] Platform:', platform);
  console.log('[FFmpeg] Is packaged:', app.isPackaged);
  
  // 1. Try bundled FFmpeg (if app is packaged and ffmpeg-bin exists)
  if (app.isPackaged) {
    const bundledPath = join(process.resourcesPath, 'ffmpeg-bin', `ffmpeg${ext}`);
    console.log('[FFmpeg] Checking bundled path:', bundledPath);
    if (existsSync(bundledPath)) {
      console.log('[FFmpeg] ✓ Using bundled:', bundledPath);
      return bundledPath;
    }
    console.log('[FFmpeg] ✗ Bundled not found');
  }
  
  // 2. Try common Windows installation paths
  if (platform === 'win32') {
    const commonPaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      join(process.env.USERPROFILE || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    ];
    
    console.log('[FFmpeg] Checking common Windows paths...');
    for (const p of commonPaths) {
      console.log('[FFmpeg] Checking:', p);
      const exists = existsSync(p);
      console.log('[FFmpeg] Exists:', exists);
      if (exists) {
        console.log('[FFmpeg] ✓ Found at:', p);
        return p;
      }
    }
  }
  
  // 3. Fallback to system PATH
  console.log('[FFmpeg] ✗ No local path found, using system PATH');
  return 'ffmpeg';
}

/**
 * Detect available GPU encoders
 */
export function detectGPU(): GPUInfo {
  const ffmpegPath = getFFmpegPath();
  const encoders: string[] = [];
  
  let hasNvidia = false;
  let hasIntelQSV = false;
  let hasAMD = false;

  console.log('[GPU] Starting GPU detection...');

  const canUseEncoder = (encoder: 'h264_nvenc' | 'h264_qsv' | 'h264_amf'): boolean => {
    // Many FFmpeg builds list GPU encoders even when the machine/driver can't actually use them.
    // Do a tiny smoke-test encode against a generated source.
    const args = [
      '-hide_banner',
      '-loglevel',
      'warning', // Use warning instead of error to see more output
      '-f',
      'lavfi',
      '-i',
      'nullsrc=s=128x128:d=0.2',
      '-frames:v',
      '2',
      '-c:v',
      encoder,
      '-f',
      'null',
      '-',
    ];
    
    console.log(`[GPU] Testing encoder: ${encoder}`);
    
    try {
      const res = spawnSync(ffmpegPath, args, {
        windowsHide: true,
        timeout: 15000, // Increased timeout for slower GPUs
        encoding: 'utf8',
      });
      
      const stderr = res.stderr || '';
      const stdout = res.stdout || '';
      
      console.log(`[GPU] ${encoder} exit code: ${res.status}`);
      if (stderr) {
        console.log(`[GPU] ${encoder} stderr: ${stderr.slice(0, 300)}`);
      }
      
      // Check for specific failure messages even if exit code is 0
      const lowerErr = stderr.toLowerCase();
      const hasInitError = 
        lowerErr.includes('cannot load') ||
        lowerErr.includes('no nvenc capable') ||
        lowerErr.includes('driver does not support') ||
        lowerErr.includes('mfxinit') ||
        lowerErr.includes('amf') && lowerErr.includes('failed');
      
      if (hasInitError) {
        console.log(`[GPU] ${encoder} has init errors in stderr, marking as unavailable`);
        return false;
      }
      
      const success = res.status === 0;
      console.log(`[GPU] ${encoder} available: ${success}`);
      return success;
    } catch (err) {
      console.log(`[GPU] ${encoder} test threw exception:`, err);
      return false;
    }
  };

  try {
    // 1) Check which encoders exist in the FFmpeg build
    console.log('[GPU] Checking FFmpeg encoders list...');
    const output = execSync(`"${ffmpegPath}" -hide_banner -encoders`, { encoding: 'utf8' });

    const hasNvencInBuild = output.includes('h264_nvenc');
    const hasQsvInBuild = output.includes('h264_qsv');
    const hasAmfInBuild = output.includes('h264_amf');

    console.log(`[GPU] Encoders in build - NVENC: ${hasNvencInBuild}, QSV: ${hasQsvInBuild}, AMF: ${hasAmfInBuild}`);

    // 2) Verify they actually work on this machine
    if (hasNvencInBuild && canUseEncoder('h264_nvenc')) {
      hasNvidia = true;
      encoders.push('h264_nvenc');
    }

    if (hasQsvInBuild && canUseEncoder('h264_qsv')) {
      hasIntelQSV = true;
      encoders.push('h264_qsv');
    }

    if (hasAmfInBuild && canUseEncoder('h264_amf')) {
      hasAMD = true;
      encoders.push('h264_amf');
    }

    // Always add CPU encoder as fallback
    encoders.push('libx264');
  } catch (error) {
    console.error('[GPU] Failed to detect GPU:', error);
    encoders.push('libx264');
  }

  // Determine recommended encoder (priority: NVENC > QSV > AMF > CPU)
  let recommendedEncoder = 'libx264';
  if (hasNvidia) recommendedEncoder = 'h264_nvenc';
  else if (hasIntelQSV) recommendedEncoder = 'h264_qsv';
  else if (hasAMD) recommendedEncoder = 'h264_amf';

  console.log(`[GPU] Detection complete - NVIDIA: ${hasNvidia}, Intel: ${hasIntelQSV}, AMD: ${hasAMD}`);
  console.log(`[GPU] Recommended encoder: ${recommendedEncoder}`);
  console.log(`[GPU] Available encoders: ${encoders.join(', ')}`);

  return {
    hasNvidia,
    hasIntelQSV,
    hasAMD,
    recommendedEncoder,
    availableEncoders: encoders,
  };
}

/**
 * Get encoder-specific flags for best performance and quality
 * Optimized for Full HD (1080x1920) output with high visual fidelity
 */
function getEncoderFlags(encoder: string, quality: 'fast' | 'balanced' | 'quality'): string[] {
  // Instagram Reels optimized settings
  // All presets now use high bitrate minimums (>=10M) for maximum quality after IG compression
  const qualityMap = {
    fast:     { nvenc: 'p5', qsv: 'faster', amf: 'balanced', x264: 'medium', crf: 19, bitrate: '10M', maxrate: '13M', bufsize: '26M' },
    balanced: { nvenc: 'p6', qsv: 'slow',   amf: 'quality',  x264: 'slow',   crf: 17, bitrate: '12M', maxrate: '15M', bufsize: '30M' },
    quality:  { nvenc: 'p7', qsv: 'slower',  amf: 'quality',  x264: 'slow',   crf: 17, bitrate: '12M', maxrate: '15M', bufsize: '30M' },
  };
  
  const q = qualityMap[quality];

  // Instagram Reels optimized common flags
  const reelsFlags = [
    '-r', '30',                // Force 30fps output
    '-vsync', 'cfr',           // Constant frame rate
    '-g', '60',                // Keyframe every 60 frames (2s at 30fps)
    '-keyint_min', '60',       // Minimum keyframe interval
    '-sc_threshold', '0',      // Disable scene change detection for consistent GOP
    '-pix_fmt', 'yuv420p',     // Maximum compatibility
  ];

  switch (encoder) {
    case 'h264_nvenc':
      return [
        '-c:v', 'h264_nvenc',
        '-preset', q.nvenc,
        '-rc', 'vbr',
        '-cq', String(q.crf),
        '-b:v', q.bitrate,
        '-maxrate', q.maxrate,
        '-bufsize', q.bufsize,
        '-spatial-aq', '1',
        '-temporal-aq', '1',
        '-aq-strength', '8',
        '-rc-lookahead', '32',
        '-profile:v', 'high',
        '-level', '4.1',
        ...reelsFlags,
      ];
    
    case 'h264_qsv':
      return [
        '-c:v', 'h264_qsv',
        '-preset', q.qsv,
        '-global_quality', String(q.crf),
        '-b:v', q.bitrate,
        '-maxrate', q.maxrate,
        '-bufsize', q.bufsize,
        '-look_ahead', '1',
        '-profile:v', 'high',
        '-level', '4.1',
        ...reelsFlags,
      ];
    
    case 'h264_amf':
      return [
        '-c:v', 'h264_amf',
        '-quality', q.amf,
        '-rc', 'vbr_latency',
        '-b:v', q.bitrate,
        '-maxrate', q.maxrate,
        '-bufsize', q.bufsize,
        '-profile:v', 'high',
        '-level', '4.1',
        ...reelsFlags,
      ];
    
    default: // libx264 - Instagram Reels optimized
      return [
        '-c:v', 'libx264',
        '-preset', q.x264,
        '-crf', String(q.crf),
        '-profile:v', 'high',
        '-level', '4.1',
        '-b:v', q.bitrate,
        '-maxrate', q.maxrate,
        '-bufsize', q.bufsize,
        '-x264-params', 'ref=4:bframes=2:aq-mode=3:psy-rd=1.0:deblock=-1,-1',
        '-threads', '0',
        ...reelsFlags,
      ];
  }
}

/**
 * Get video dimensions using FFprobe
 */
async function getVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      videoPath,
    ];

    let stdout = '';
    const ffprobe = spawn(ffprobePath, args);

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        const [width, height] = stdout.trim().split(',').map(Number);
        if (width && height) {
          resolve({ width, height });
          return;
        }
      }
      // Fallback to common dimensions if ffprobe fails
      resolve({ width: 1920, height: 1080 });
    });

    ffprobe.on('error', () => {
      resolve({ width: 1920, height: 1080 });
    });
  });
}

async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number } | null> {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      imagePath,
    ];

    let stdout = '';
    const ffprobe = spawn(ffprobePath, args);

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        const [width, height] = stdout.trim().split(',').map(Number);
        if (width && height) {
          resolve({ width, height });
          return;
        }
      }
      resolve(null);
    });

    ffprobe.on('error', () => resolve(null));
  });
}

/**
 * Process a video with FFmpeg using GPU acceleration
 */
export function processVideo(
  options: {
    videoPath: string;
    templatePath: string;
    outputPath: string;
    greenArea: { x: number; y: number; width: number; height: number };
    settings: {
      useGPU: boolean;
      encoder: string;
      quality: 'fast' | 'balanced' | 'quality';
      trimStart: number;
      trimEnd: number;
      useAiFraming?: boolean;
      useTeste?: boolean;
      useMirror?: boolean;
      useSubtitleMode?: boolean;
    };
  },
  onProgress: (progress: ProcessingProgress) => void
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const { videoPath, templatePath, outputPath, greenArea, settings } = options;
    const { x, y, width, height } = greenArea;

    const isGpuEncoderInitIssue = (stderr: string) => {
      const s = stderr.toLowerCase();
      return (
        // NVENC (very common on non-NVIDIA PCs, or NVIDIA w/out proper drivers)
        s.includes('cannot load nvcuda.dll') ||
        s.includes('no nvenc capable devices found') ||
        // Generic encoder init failures
        s.includes('error while opening encoder') ||
        s.includes('could not open encoder') ||
        s.includes('encoder not found') ||
        s.includes('unknown encoder') ||
        s.includes('driver does not support the required nvenc api version') ||
        s.includes('minimum required nvidia driver') ||
        s.includes('nvenc api version') ||
        // Intel QSV
        s.includes('mfx') ||
        s.includes('qsv') && s.includes('failed') ||
        // AMD AMF
        s.includes('amf') && (s.includes('failed') || s.includes('error'))
      );
    };

    // Run the async processing logic
    (async () => {
      let frameAnalysis: FrameAnalysis | null = null;
      let aiOffsetX = 0;
      let aiOffsetY = 0;
      let borderCropFilter: string | null = null;
      const isSubtitleMode = !!settings.useSubtitleMode;

       // Resolve output canvas size from the actual template file.
       // This keeps overlay coordinates (greenArea x/y) consistent across any template resolution.
       const templateDims = await getImageDimensions(templatePath);
       const outW = templateDims?.width ?? 1080;
       const outH = templateDims?.height ?? 1920;

      // STEP 1: Detect and remove any black/white borders from the video
      // This runs before AI analysis to ensure we're analyzing clean content
      onProgress({
        videoPath,
        progress: 0,
        stage: 'analyzing',
        message: 'Detectando molduras no vídeo...',
      });

      try {
        const borderInfo = await detectVideoBorders(videoPath, 3);
        if (borderInfo.hasBorders) {
          // In subtitle/text mode, expand the detected content area with extra vertical margin
          // so text at top/bottom doesn't get cut flush
          if (isSubtitleMode) {
            // Generous margins to NEVER cut text/captions at top or bottom
            const extraMarginY = Math.max(24, Math.round(borderInfo.originalHeight * 0.06)); // at least 24px or 6% of height
            const extraMarginX = Math.max(8, Math.round(borderInfo.originalWidth * 0.02)); // horizontal margin

            // Expand crop area: move Y up & increase height, clamp to original bounds
            borderInfo.y = Math.max(0, borderInfo.y - extraMarginY);
            borderInfo.x = Math.max(0, borderInfo.x - extraMarginX);
            // Expand width/height but don't exceed original dimensions
            borderInfo.width = Math.min(borderInfo.originalWidth - borderInfo.x, borderInfo.width + extraMarginX * 2);
            borderInfo.height = Math.min(borderInfo.originalHeight - borderInfo.y, borderInfo.height + extraMarginY * 2);
            // Keep even
            borderInfo.width = borderInfo.width % 2 === 0 ? borderInfo.width : borderInfo.width - 1;
            borderInfo.height = borderInfo.height % 2 === 0 ? borderInfo.height : borderInfo.height - 1;

            console.log(`[FFmpeg] Subtitle mode: expanded crop area by ${extraMarginY}px top/bottom for text safety`);
          }

          borderCropFilter = generateCropFilter(borderInfo);
          console.log('[FFmpeg] Border detection: will crop', borderCropFilter);
          onProgress({
            videoPath,
            progress: 2,
            stage: 'analyzing',
            message: `Moldura detectada (${borderInfo.originalWidth}→${borderInfo.width}px). Removendo...`,
          });
        } else {
          console.log('[FFmpeg] Border detection: no borders found');
        }
      } catch (cropErr) {
        console.warn('[FFmpeg] Border detection failed, continuing without pre-crop:', cropErr);
      }

      // STEP 2: AI Framing - analyze content and determine optimal positioning
      if (settings.useAiFraming) {
        onProgress({
          videoPath,
          progress: 3,
          stage: 'analyzing',
          message: 'Analisando vídeo com IA...',
        });

        try {
          // Get video dimensions first (post-crop dimensions if borders were detected)
          const videoDims = await getVideoDimensions(videoPath);
          console.log('[FFmpeg] Video dimensions:', videoDims);

          // Extract and analyze first frame
          const frameBase64 = await extractFirstFrame(videoPath);
          frameAnalysis = await analyzeVideoFrame(frameBase64);
          console.log('[FFmpeg] AI analysis result:', frameAnalysis);

          // Calculate smart positioning
          const smartPos = calculateSmartPosition(
            videoDims.width,
            videoDims.height,
            width,
            height,
            frameAnalysis
          );

           // For FFmpeg, we use anchor points (0-1) to decide how we crop within the scaled image.
           // Clamp to prevent invalid values from generating out-of-range crop expressions.
           aiOffsetX = clamp01(frameAnalysis.suggestedCrop.anchorX);
           aiOffsetY = clamp01(frameAnalysis.suggestedCrop.anchorY);

           // Slight top-bias: user wants a bit more focus on the top/rostos.
           // Smaller anchorY = keep more of the top.
           aiOffsetY = clamp01(aiOffsetY * 0.85);

          onProgress({
            videoPath,
            progress: 5,
            stage: 'analyzing',
            message: frameAnalysis.hasFace
              ? 'Rosto detectado! Enquadrando...'
              : 'Conteúdo analisado! Enquadrando...',
          });
        } catch (aiError) {
          console.warn('[FFmpeg] AI analysis failed, using center crop:', aiError);
          aiOffsetX = 0.5;
          aiOffsetY = 0.15; // Default top-aligned for talking heads
        }
      } else {
        onProgress({
          videoPath,
          progress: 3,
          stage: 'analyzing',
          message: 'Analisando vídeo...',
        });
        aiOffsetX = 0.5;
        aiOffsetY = 0.5; // Center crop when AI is disabled
      }

      // Final clamp (covers both AI and non-AI paths)
      aiOffsetX = clamp01(aiOffsetX);
      aiOffsetY = clamp01(aiOffsetY);

      // Build filter complex for chroma key + overlay
      // IMPORTANT:
      // - Template PNG must have transparent pixels where the video should appear (green area).
      // - We overlay the video first on a black background, then overlay the template on top.
      // - The template's green pixels are removed via chromakey, revealing the video below.
      // - Apply margin (2px) to avoid green edge artifacts.
      const margin = 2; // Safety margin to hide green edge pixels

      // Expand target dimensions slightly to ensure complete coverage (avoid any black borders)
      const expandedWidth = makeEven(width + (margin * 2));
      const expandedHeight = makeEven(height + (margin * 2));

      // Subtitle mode uses CONTAIN (fit entire video, no cropping) instead of COVER (crop to fill)

      let scaleExpr: string;
      let cropExpr: string | null;

      if (isSubtitleMode) {
        // CONTAIN mode: scale to fit entirely within the area with generous breathing room
        // ~10% padding so text at top/bottom has clear space and never gets cut
        const padPercent = 0.10;
        const innerW = makeEven(Math.floor(expandedWidth * (1 - padPercent)));
        const innerH = makeEven(Math.floor(expandedHeight * (1 - padPercent)));
        scaleExpr = `scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease:flags=lanczos`;
        cropExpr = null; // No crop needed
        console.log('[FFmpeg] Subtitle mode: CONTAIN with 5% breathing room');
      } else {
        // TRUE "cover" mode (cross-machine reliable):
        const safeWidth = makeEven(expandedWidth + 4);
        const safeHeight = makeEven(expandedHeight + 4);
        
        scaleExpr = `scale=${safeWidth}:${safeHeight}:force_original_aspect_ratio=increase:flags=lanczos`;
        
        const cropXExpr = `floor((iw-${expandedWidth})*${aiOffsetX})`;
        const cropYExpr = `floor((ih-${expandedHeight})*${aiOffsetY})`;
        cropExpr = `crop=${expandedWidth}:${expandedHeight}:${cropXExpr}:${cropYExpr}`;
      }

      // Build video filter pipeline
      const videoPipelineSteps: (string | null)[] = [
        borderCropFilter,
        scaleExpr,
        cropExpr,
      ];

      // In subtitle mode, pad to exact size centering the content (black fills breathing room)
      if (isSubtitleMode) {
        videoPipelineSteps.push(`pad=${expandedWidth}:${expandedHeight}:(ow-iw)/2:(oh-ih)/2:black`);
      }

      videoPipelineSteps.push('unsharp=3:3:0.3:3:3:0.1'); // Subtle sharpening

      // TESTE mode: add denoise + subtle color/contrast filters
      if (settings.useTeste) {
        videoPipelineSteps.push('hqdn3d=4:3:6:4'); // Denoise: luma/chroma spatial/temporal
        videoPipelineSteps.push('eq=contrast=1.02:brightness=0.01:saturation=1.03'); // Subtle enhancement
        videoPipelineSteps.push('curves=preset=lighter'); // Very subtle brightness curve
      }

      // Mirror mode: horizontal flip
      if (settings.useMirror) {
        videoPipelineSteps.push('hflip');
      }

      // Subtle dynamic brightness/contrast oscillation (applied only to the video inside the frame)
      videoPipelineSteps.push("eq=brightness='0.01*sin(2*PI*t/6)':contrast='1.0+0.02*sin(2*PI*t/7)'");

      videoPipelineSteps.push('setsar=1', 'format=rgb24');
      const videoPipeline = videoPipelineSteps.filter(Boolean).join(',');

      const filterComplex = [
        // Step 1: Process video (remove borders → scale → crop → sharpen → format)
        `[0:v]${videoPipeline}[vid]`,
        // Template with HIGH QUALITY Lanczos scaling + chroma key
        // flags=lanczos ensures the template PNG stays crisp and sharp
        `[1:v]scale=${outW}:${outH}:flags=lanczos,format=rgba,chromakey=0x00FF00:0.25:0.08[mask]`,
        // Infinite black background at full resolution
        `color=black:s=${outW}x${outH}[bg]`,
        // Overlay video in green area (slightly oversized to cover completely with margin overlap)
        `[bg][vid]overlay=${x}:${y}:shortest=1[base]`,
        // Overlay template on top, then convert to yuv420p with high quality chroma subsampling
        `[base][mask]overlay=0:0:shortest=1,format=yuv420p[out]`,
      ].join(';');

    // Build ordered list of encoders to try: GPU options first (if enabled), then CPU fallback
    const encodersToTry: string[] = [];
    if (settings.useGPU) {
      // Get the list of encoders that actually work on this machine (already validated with smoke tests)
      const gpuInfo = detectGPU();
      // Add all working GPU encoders in priority order
      if (gpuInfo.hasNvidia) encodersToTry.push('h264_nvenc');
      if (gpuInfo.hasIntelQSV) encodersToTry.push('h264_qsv');
      if (gpuInfo.hasAMD) encodersToTry.push('h264_amf');
    }
    // Always add CPU as final fallback
    encodersToTry.push('libx264');

    console.log('[FFmpeg] Encoders to try (in order):', encodersToTry);

    // Get video duration for TESTE mode end-trim
    let videoDuration = 0;
    if (settings.useTeste) {
      try {
        const dims = await getVideoDimensions(videoPath);
        // Also get duration via ffprobe
        const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
        const durResult = spawnSync(ffprobePath, [
          '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath
        ], { encoding: 'utf8', timeout: 10000 });
        videoDuration = parseFloat(durResult.stdout?.trim() || '0') || 0;
        console.log('[FFmpeg] Video duration for TESTE trim:', videoDuration);
      } catch (e) {
        console.warn('[FFmpeg] Could not get duration for TESTE trim:', e);
      }
    }

    const runWithEncoder = (encoder: string) => {
      const encoderFlags = getEncoderFlags(encoder, settings.quality);
      const isGpuEncoder = encoder !== 'libx264';
      const encoderLabel = {
        'h264_nvenc': 'NVIDIA',
        'h264_qsv': 'Intel',
        'h264_amf': 'AMD',
        'libx264': 'CPU',
      }[encoder] || encoder;

      // TESTE mode: trim 1 second from end
      const testeEndTrim = settings.useTeste ? 1 : 0;
      const effectiveEnd = (videoDuration > 0 && testeEndTrim > 0)
        ? videoDuration - settings.trimStart - testeEndTrim
        : 0;

      const args = [
        '-y', // Overwrite output
        '-i', videoPath,
        // Loop template image for the entire processing duration
        '-loop', '1',
        '-i', templatePath,
        '-ss', String(settings.trimStart),
        ...(effectiveEnd > 0 ? ['-t', String(effectiveEnd)] : []),
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-map', '0:a?', // Map audio if exists
        ...encoderFlags,
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-movflags', '+faststart',
        '-progress', 'pipe:1', // Output progress to stdout
        outputPath,
      ];

      console.log(`[FFmpeg] Trying encoder: ${encoder}`);
      console.log('[FFmpeg] Command:', ffmpegPath, args.join(' '));
      const ffmpeg = spawn(ffmpegPath, args);
      let duration = 0;
      const stderrLines: string[] = [];

      ffmpeg.stderr.on('data', (data: Buffer) => {
        const line = data.toString();
        // Keep a rolling buffer of stderr lines for better diagnostics
        for (const l of line.split(/\r?\n/)) {
          const trimmed = l.trim();
          if (!trimmed) continue;
          stderrLines.push(trimmed);
          if (stderrLines.length > 200) stderrLines.shift();
        }

        // Parse duration
        const durationMatch = line.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
        if (durationMatch) {
          const [, hours, minutes, seconds] = durationMatch;
          duration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
        }
      });

      ffmpeg.stdout.on('data', (data: Buffer) => {
        const line = data.toString();

        // Parse progress
        const timeMatch = line.match(/out_time_ms=(\d+)/);
        const speedMatch = line.match(/speed=\s*([\d.]+)x/);
        const fpsMatch = line.match(/fps=\s*([\d.]+)/);

        if (timeMatch && duration > 0) {
          const currentTime = parseInt(timeMatch[1]) / 1000000;
          const progress = Math.min(99, Math.round((currentTime / duration) * 100));

          onProgress({
            videoPath,
            progress,
            stage: 'processing',
            message: `Processando... ${progress}% (${encoderLabel})`,
            fps: fpsMatch ? parseFloat(fpsMatch[1]) : undefined,
            speed: speedMatch ? `${speedMatch[1]}x` : undefined,
          });
        }
      });

      return new Promise<{ code: number | null; stderrTail: string; stderrAll: string; encoder: string }>((res) => {
        ffmpeg.on('close', (code) => {
          const stderrAll = stderrLines.join('\n');
          const stderrTail = stderrLines.slice(-25).join('\n');
          res({ code, stderrTail, stderrAll, encoder });
        });

        ffmpeg.on('error', (error) => {
          const stderrAll = stderrLines.join('\n');
          const stderrTail = stderrLines.slice(-25).join('\n');
          // Use -1 to represent spawn-level errors
          console.error('[FFmpeg] spawn error:', error);
          res({ code: -1, stderrTail, stderrAll: `${stderrAll}\n${error.message}`.trim(), encoder });
        });
      });
    };

    const isEncoderInitFailure = (stderr: string) => {
      const s = stderr.toLowerCase();
      return (
        // NVENC failures
        s.includes('cannot load nvcuda.dll') ||
        s.includes('no nvenc capable devices found') ||
        s.includes('driver does not support the required nvenc api version') ||
        s.includes('minimum required nvidia driver') ||
        s.includes('nvenc api version') ||
        // Generic encoder failures
        s.includes('error while opening encoder') ||
        s.includes('could not open encoder') ||
        s.includes('encoder not found') ||
        s.includes('unknown encoder') ||
        // Intel QSV failures
        s.includes('mfxinit') ||
        s.includes('qsvinit') ||
        (s.includes('qsv') && s.includes('failed')) ||
        // AMD AMF failures
        (s.includes('amf') && (s.includes('failed') || s.includes('error') || s.includes('init')))
      );
    };

    // Try each encoder in order until one succeeds
    let lastResult: { code: number | null; stderrTail: string; stderrAll: string; encoder: string } | null = null;

    for (let i = 0; i < encodersToTry.length; i++) {
      const encoder = encodersToTry[i];
      const isLastEncoder = i === encodersToTry.length - 1;
      const encoderLabel = {
        'h264_nvenc': 'NVIDIA',
        'h264_qsv': 'Intel',
        'h264_amf': 'AMD',
        'libx264': 'CPU',
      }[encoder] || encoder;

      onProgress({
        videoPath,
        progress: 0,
        stage: 'processing',
        message: `Iniciando processamento (${encoderLabel})...`,
      });

      const result = await runWithEncoder(encoder);
      lastResult = result;

      if (result.code === 0) {
        // Success!
        onProgress({
          videoPath,
          progress: 100,
          stage: 'done',
          message: `Concluído! (${encoderLabel})`,
        });
        resolve({ success: true, outputPath });
        return;
      }

      // Check if it's an encoder init failure - if so, try next encoder
      if (!isLastEncoder && isEncoderInitFailure(result.stderrAll)) {
        const nextEncoder = encodersToTry[i + 1];
        const nextLabel = {
          'h264_nvenc': 'NVIDIA',
          'h264_qsv': 'Intel',
          'h264_amf': 'AMD',
          'libx264': 'CPU',
        }[nextEncoder] || nextEncoder;

        console.log(`[FFmpeg] Encoder ${encoder} failed, trying ${nextEncoder}...`);
        onProgress({
          videoPath,
          progress: 0,
          stage: 'processing',
          message: `${encoderLabel} indisponível. Tentando ${nextLabel}...`,
        });
        continue;
      }

      // For other errors (not encoder init), or if it's the last encoder, fail
      break;
    }

    // All encoders failed
    const hint = lastResult?.stderrTail
      ? `\n\n--- FFmpeg stderr (últimas linhas) ---\n${lastResult.stderrTail}`
      : '';

    onProgress({
      videoPath,
      progress: 0,
      stage: 'error',
      message: `FFmpeg saiu com código ${lastResult?.code}${hint}`,
    });
    resolve({ success: false, error: `FFmpeg exit code: ${lastResult?.code}${hint}` });
    })();
  });
}
