import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { audioBase64, videoId } = await req.json();

    if (!audioBase64) {
      return new Response(
        JSON.stringify({ error: "No audio provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ text: "", words: [], detectedLanguage: "unknown" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use Gemini for transcription with word-level timestamps and language detection
    const prompt = `Transcribe this audio to text with word-level timestamps and detect the language.
Return ONLY a valid JSON object in this exact format:
{
  "text": "full transcription text here",
  "words": [
    {"word": "word1", "start": 0.0, "end": 0.8},
    {"word": "word2", "start": 0.8, "end": 1.6}
  ],
  "detectedLanguage": "en-US"
}

IMPORTANT TIMING RULES:
- Average speaking rate is 120-150 words per minute (about 0.4-0.5 seconds per word)
- Short words (1-4 chars): 0.3-0.5 seconds
- Medium words (5-8 chars): 0.5-0.7 seconds  
- Long words (9+ chars): 0.7-1.0 seconds
- Add small pauses (0.1-0.3s) between sentences

For detectedLanguage, use standard locale codes:
- "pt-BR" for Brazilian Portuguese
- "pt-PT" for European Portuguese
- "en-US" for American English
- "en-GB" for British English
- "es-ES" for Spanish
- etc.

If you cannot transcribe, return: {"text": "", "words": [], "detectedLanguage": "unknown"}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:audio/wav;base64,${audioBase64.substring(0, 50000)}`,
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      
      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded", text: "", words: [], detectedLanguage: "unknown" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "Credits exhausted", text: "", words: [], detectedLanguage: "unknown" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.error("AI Gateway error:", status);
      return new Response(
        JSON.stringify({ text: "", words: [], detectedLanguage: "unknown" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log("[Transcribe] Detected language:", parsed.detectedLanguage);
        return new Response(
          JSON.stringify({
            text: parsed.text || "",
            words: parsed.words || [],
            detectedLanguage: parsed.detectedLanguage || "unknown",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (e) {
      console.error("Failed to parse transcription:", e);
    }

    return new Response(
      JSON.stringify({ text: "", words: [], detectedLanguage: "unknown" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Transcription error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", text: "", words: [], detectedLanguage: "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
