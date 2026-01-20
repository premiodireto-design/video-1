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
  };
}

/**
 * Calculates video positioning based on AI analysis
 */
export function calculateSmartPosition(
  videoWidth: number,
  videoHeight: number,
  frameWidth: number,
  frameHeight: number,
  analysis: FrameAnalysis
): { offsetX: number; offsetY: number; scale: number } {
  const videoAspect = videoWidth / videoHeight;
  const frameAspect = frameWidth / frameHeight;
  
  // Calculate scale to cover the frame
  let scale: number;
  if (videoAspect > frameAspect) {
    // Video is wider than frame - scale by height
    scale = frameHeight / videoHeight;
  } else {
    // Video is taller than frame - scale by width
    scale = frameWidth / videoWidth;
  }
  
  const scaledWidth = videoWidth * scale;
  const scaledHeight = videoHeight * scale;
  
  // Calculate offsets based on AI analysis
  const { anchorX, anchorY } = analysis.suggestedCrop;
  
  // Calculate how much overflow we have
  const overflowX = scaledWidth - frameWidth;
  const overflowY = scaledHeight - frameHeight;
  
  // Position based on anchor points
  // anchorX=0 means keep left edge, anchorX=1 means keep right edge
  // anchorY=0 means keep top edge, anchorY=1 means keep bottom edge
  const offsetX = -overflowX * anchorX;
  const offsetY = -overflowY * anchorY;
  
  return {
    offsetX,
    offsetY,
    scale,
  };
}
