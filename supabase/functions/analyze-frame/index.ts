import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnalysisResult {
  hasFace: boolean;
  facePosition: {
    x: number; // 0-1 normalized
    y: number; // 0-1 normalized
    width: number;
    height: number;
  } | null;
  contentFocus: {
    x: number; // 0-1, center of important content
    y: number; // 0-1, center of important content
  };
  suggestedCrop: {
    anchorX: number; // 0-1, horizontal anchor point
    anchorY: number; // 0-1, vertical anchor point (0=top, 0.5=center, 1=bottom)
  };
  // NEW: Detected actual video content area (excluding black bars, overlays, text)
  contentBounds: {
    x: number; // 0-1 normalized left edge of actual video content
    y: number; // 0-1 normalized top edge of actual video content
    width: number; // 0-1 normalized width of actual video content
    height: number; // 0-1 normalized height of actual video content
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64 } = await req.json();
    
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this video frame for optimal cropping. I need to:
1. Detect the ACTUAL video content area (exclude black bars, letterboxing, pillarboxing, overlay texts, watermarks, UI elements)
2. Identify faces and important content within that area
3. Suggest the best crop position

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "hasFace": boolean,
  "facePosition": { "x": 0-1, "y": 0-1, "width": 0-1, "height": 0-1 } or null,
  "contentFocus": { "x": 0-1, "y": 0-1 },
  "suggestedCrop": { "anchorX": 0-1, "anchorY": 0-1 },
  "contentBounds": { "x": 0-1, "y": 0-1, "width": 0-1, "height": 0-1 }
}

Where:
- contentBounds: The bounding box of the ACTUAL video content, excluding:
  * Black bars (top, bottom, left, right)
  * Overlay text/captions/subtitles that are not part of the original video
  * Watermarks or logos
  * UI elements or borders
  * If the video fills the entire frame with no bars/overlays, use { x: 0, y: 0, width: 1, height: 1 }
- facePosition: bounding box of the main face (normalized 0-1) within the full frame
- contentFocus: center of the most important visual content
- suggestedCrop.anchorX: where to anchor horizontally (0=left, 0.5=center, 1=right)
- suggestedCrop.anchorY: where to anchor vertically (0=top, 0.5=center, 1=bottom)

IMPORTANT: Be precise about contentBounds. Look for:
- Horizontal black bars (letterboxing) at top/bottom
- Vertical black bars (pillarboxing) on left/right
- Combined black bars (the actual video is a smaller rectangle inside)
- Text overlays that should be excluded from the main content

For talking head videos, anchorY should be low (0.1-0.3) to preserve the head.
For action videos, center on the action.`
              },
              {
                type: "image_url",
                image_url: {
                  url: imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
                }
              }
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, using default positioning" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted, using default positioning" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse the JSON from the response
    let analysis: AnalysisResult;
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
        // Ensure contentBounds exists
        if (!analysis.contentBounds) {
          analysis.contentBounds = { x: 0, y: 0, width: 1, height: 1 };
        }
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      // Return default values
      analysis = {
        hasFace: true,
        facePosition: null,
        contentFocus: { x: 0.5, y: 0.3 },
        suggestedCrop: { anchorX: 0.5, anchorY: 0.15 },
        contentBounds: { x: 0, y: 0, width: 1, height: 1 }
      };
    }

    console.log("[analyze-frame] Analysis result:", JSON.stringify(analysis));

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("analyze-frame error:", error);
    // Return default values on error to not block processing
    return new Response(
      JSON.stringify({
        hasFace: true,
        facePosition: null,
        contentFocus: { x: 0.5, y: 0.3 },
        suggestedCrop: { anchorX: 0.5, anchorY: 0.15 },
        contentBounds: { x: 0, y: 0, width: 1, height: 1 },
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
