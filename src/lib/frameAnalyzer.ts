import { supabase } from "@/integrations/supabase/client";

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
    anchorX: number;
    anchorY: number;
  };
  // NEW: Detected actual video content area (excluding black bars, overlays, text)
  contentBounds?: {
    x: number; // 0-1 normalized left edge of actual video content
    y: number; // 0-1 normalized top edge of actual video content
    width: number; // 0-1 normalized width of actual video content
    height: number; // 0-1 normalized height of actual video content
  };
  error?: string;
}

/**
 * Captures the first frame of a video as a base64 image
 */
export async function captureVideoFrame(videoElement: HTMLVideoElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Cannot create canvas context"));
      return;
    }
    
    ctx.drawImage(videoElement, 0, 0);
    
    // Convert to JPEG for smaller size
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    resolve(dataUrl);
  });
}

/**
 * Analyzes a video frame using AI to determine optimal cropping position
 * and detect the actual video content area (excluding black bars, overlays)
 */
export async function analyzeVideoFrame(imageBase64: string): Promise<FrameAnalysis> {
  try {
    const { data, error } = await supabase.functions.invoke("analyze-frame", {
      body: { imageBase64 },
    });

    if (error) {
      console.warn("[FrameAnalyzer] Edge function error:", error);
      return getDefaultAnalysis();
    }

    return data as FrameAnalysis;
  } catch (e) {
    console.warn("[FrameAnalyzer] Analysis failed:", e);
    return getDefaultAnalysis();
  }
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
    contentBounds: { x: 0, y: 0, width: 1, height: 1 }, // Full frame by default
  };
}

/**
 * Calculates video positioning based on AI analysis
 * Now also considers contentBounds to crop out black bars and overlays
 */
export function calculateSmartPosition(
  videoWidth: number,
  videoHeight: number,
  frameWidth: number,
  frameHeight: number,
  analysis: FrameAnalysis
): { 
  offsetX: number; 
  offsetY: number; 
  scale: number;
  // Source crop coordinates (to extract only the actual content from video)
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
} {
  // Get content bounds (default to full frame if not provided)
  const bounds = analysis.contentBounds || { x: 0, y: 0, width: 1, height: 1 };
  
  // Calculate the actual content area in pixels
  const contentX = bounds.x * videoWidth;
  const contentY = bounds.y * videoHeight;
  const contentWidth = bounds.width * videoWidth;
  const contentHeight = bounds.height * videoHeight;
  
  // Use the content dimensions for aspect ratio calculations
  const contentAspect = contentWidth / contentHeight;
  const frameAspect = frameWidth / frameHeight;
  
  // Calculate scale to cover the frame using ONLY the content area
  let scale: number;
  if (contentAspect > frameAspect) {
    // Content is wider than frame - scale by height
    scale = frameHeight / contentHeight;
  } else {
    // Content is taller than frame - scale by width
    scale = frameWidth / contentWidth;
  }
  
  const scaledWidth = contentWidth * scale;
  const scaledHeight = contentHeight * scale;
  
  // Calculate offsets based on AI analysis (for positioning within the content)
  const { anchorX, anchorY } = analysis.suggestedCrop;
  
  // Calculate how much overflow we have
  const overflowX = scaledWidth - frameWidth;
  const overflowY = scaledHeight - frameHeight;
  
  // Position based on anchor points
  const offsetX = -overflowX * anchorX;
  const offsetY = -overflowY * anchorY;
  
  return {
    offsetX,
    offsetY,
    scale,
    // Source coordinates for extracting content from original video
    sourceX: contentX,
    sourceY: contentY,
    sourceWidth: contentWidth,
    sourceHeight: contentHeight,
  };
}
