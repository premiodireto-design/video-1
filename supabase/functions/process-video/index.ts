import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ProcessingRequest {
  videoPath: string; // Path in 'videos' bucket
  templatePath: string; // Path in 'templates' bucket
  greenArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  settings: {
    fitMode: 'cover' | 'contain';
    maxQuality: boolean;
    trimStart?: number;
    trimEnd?: number;
  };
  outputFilename: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { videoPath, templatePath, greenArea, settings, outputFilename }: ProcessingRequest = await req.json();

    console.log("[process-video] Starting processing:", { videoPath, templatePath, outputFilename });

    // Download video from storage
    const { data: videoData, error: videoError } = await supabase.storage
      .from("videos")
      .download(videoPath);

    if (videoError || !videoData) {
      console.error("[process-video] Video download error:", videoError);
      throw new Error(`Failed to download video: ${videoError?.message || "Unknown error"}`);
    }

    console.log("[process-video] Video downloaded, size:", videoData.size);

    // Download template from storage
    const { data: templateData, error: templateError } = await supabase.storage
      .from("templates")
      .download(templatePath);

    if (templateError || !templateData) {
      console.error("[process-video] Template download error:", templateError);
      throw new Error(`Failed to download template: ${templateError?.message || "Unknown error"}`);
    }

    console.log("[process-video] Template downloaded, size:", templateData.size);

    // Import FFmpeg
    const { FFmpeg } = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.10");
    const { fetchFile, toBlobURL } = await import("https://esm.sh/@ffmpeg/util@0.12.1");

    const ffmpeg = new FFmpeg();

    // Load FFmpeg WASM
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    console.log("[process-video] FFmpeg loaded");

    // Write input files to FFmpeg virtual filesystem
    const videoBytes = new Uint8Array(await videoData.arrayBuffer());
    const templateBytes = new Uint8Array(await templateData.arrayBuffer());
    
    await ffmpeg.writeFile("input.mp4", videoBytes);
    await ffmpeg.writeFile("template.png", templateBytes);

    console.log("[process-video] Files written to FFmpeg FS");

    // Calculate crop/scale parameters based on green area
    const { x, y, width, height } = greenArea;
    const trimStart = settings.trimStart ?? 0.5;
    const trimEnd = settings.trimEnd ?? 0.5;
    
    // Output dimensions (1080x1920 for vertical video)
    const outW = 1080;
    const outH = 1920;

    // FFmpeg filter complex:
    // 1. Scale video to fit green area (cover mode)
    // 2. Crop to exact green area dimensions
    // 3. Overlay on template
    // 4. Overlay template with green as chroma key
    
    const scaleMode = settings.fitMode === 'cover' 
      ? `scale=w='if(gt(a,${width}/${height}),${width},-1)':h='if(gt(a,${width}/${height}),-1,${height})':force_original_aspect_ratio=increase`
      : `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease`;

    const filterComplex = [
      // Input 0: video - scale and crop to fit green area
      `[0:v]${scaleMode},crop=${width}:${height}:(iw-${width})/2:0,setsar=1[vid]`,
      // Input 1: template - remove green (chroma key)
      `[1:v]scale=${outW}:${outH},chromakey=0x00FF00:0.3:0.1[mask]`,
      // Create black background
      `color=black:s=${outW}x${outH}:d=1[bg]`,
      // Place video in green area position
      `[bg][vid]overlay=${x}:${y}:shortest=1[base]`,
      // Overlay template on top
      `[base][mask]overlay=0:0:shortest=1[out]`,
    ].join(";");

    // Build FFmpeg command
    const ffmpegArgs = [
      "-i", "input.mp4",
      "-i", "template.png",
      "-ss", String(trimStart),
      "-t", "999999", // We'll let it run to end minus trimEnd
      "-filter_complex", filterComplex,
      "-map", "[out]",
      "-map", "0:a?", // Map audio if exists
      "-c:v", "libx264",
      "-preset", settings.maxQuality ? "medium" : "ultrafast",
      "-crf", settings.maxQuality ? "18" : "23",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-y",
      "output.mp4",
    ];

    console.log("[process-video] Running FFmpeg with args:", ffmpegArgs.join(" "));

    await ffmpeg.exec(ffmpegArgs);

    console.log("[process-video] FFmpeg processing complete");

    // Read output file - handle FFmpeg FileData type
    const outputData = await ffmpeg.readFile("output.mp4");
    // deno-lint-ignore no-explicit-any
    const outputBlob = new Blob([outputData as any], { type: "video/mp4" });

    console.log("[process-video] Output size:", outputBlob.size);

    // Upload to outputs bucket
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("outputs")
      .upload(outputFilename, outputBlob, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (uploadError) {
      console.error("[process-video] Upload error:", uploadError);
      throw new Error(`Failed to upload output: ${uploadError.message}`);
    }

    console.log("[process-video] Output uploaded:", uploadData.path);

    // Generate signed URL for download (valid for 1 hour)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from("outputs")
      .createSignedUrl(outputFilename, 3600);

    if (signedUrlError) {
      console.error("[process-video] Signed URL error:", signedUrlError);
      throw new Error(`Failed to create download URL: ${signedUrlError.message}`);
    }

    const processingTime = (Date.now() - startTime) / 1000;
    console.log(`[process-video] Complete! Processing time: ${processingTime.toFixed(1)}s`);

    return new Response(
      JSON.stringify({
        success: true,
        outputPath: uploadData.path,
        downloadUrl: signedUrlData.signedUrl,
        processingTimeSeconds: processingTime,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[process-video] Error:", error);
    
    const processingTime = (Date.now() - startTime) / 1000;
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        processingTimeSeconds: processingTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
