import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Cloud video processing edge function.
 *
 * LIMITATION: FFmpeg.wasm requires Web Workers, which are NOT available in
 * Deno/Edge Functions. Therefore, true server-side video processing is not
 * possible with FFmpeg.wasm in this environment.
 *
 * This endpoint currently returns an informative error. To enable real cloud
 * processing, you would need:
 * - A dedicated server/VM with FFmpeg installed
 * - Or a third-party video processing API (Cloudinary, Mux, etc.)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Parse request to validate it (even though we can't process)
    const body = await req.json();
    console.log("[process-video] Received request:", JSON.stringify(body));

    // Return informative error about the limitation
    const processingTime = (Date.now() - startTime) / 1000;

    return new Response(
      JSON.stringify({
        success: false,
        error:
          "Processamento na nuvem não disponível: FFmpeg.wasm não funciona em Edge Functions (requer Web Workers). Use o processamento local por enquanto.",
        processingTimeSeconds: processingTime,
        suggestion: "Desative 'Processar na nuvem' nas configurações.",
      }),
      {
        status: 501, // Not Implemented
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
