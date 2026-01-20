import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TranslationResult {
  translatedText: string;
  originalText: string;
  words?: Array<{ text: string; start: number; end: number }>;
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, words, targetLanguage = "pt-BR" } = await req.json();
    
    if (!text) {
      return new Response(
        JSON.stringify({ error: "Text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use Lovable AI to translate the text while preserving word timings
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
            role: "system",
            content: `You are an expert translator. Translate the given text to ${targetLanguage} (Brazilian Portuguese).

IMPORTANT: You must respond ONLY with a valid JSON object in this exact format:
{
  "translatedText": "full translated text here",
  "words": [
    {"text": "palavra1", "start": 0.0, "end": 0.5},
    {"text": "palavra2", "start": 0.5, "end": 1.0}
  ]
}

Rules:
- Translate naturally, not word-by-word literally
- Preserve the meaning and tone
- If word timings are provided, estimate proportional timings for translated words
- Portuguese may have more or fewer words than the original
- Distribute timings proportionally across the translated text
- Keep the translation casual and natural for video content
- Do not include any text outside the JSON object`
          },
          {
            role: "user",
            content: words && words.length > 0 
              ? `Translate this text to ${targetLanguage}. Original words with timings: ${JSON.stringify(words)}\n\nFull text: "${text}"`
              : `Translate this text to ${targetLanguage}: "${text}"`
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add credits" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to translate text" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || "";
    
    // Parse the JSON response from AI
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      
      const translation = JSON.parse(jsonMatch[0]);
      
      const result: TranslationResult = {
        translatedText: translation.translatedText || translation.translated_text || text,
        originalText: text,
        words: translation.words || []
      };
      
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      // Return basic translation without word timings
      return new Response(
        JSON.stringify({ 
          translatedText: content.replace(/[{}"]/g, '').trim() || text,
          originalText: text,
          words: []
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Translation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
