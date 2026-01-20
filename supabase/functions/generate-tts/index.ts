import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to encode ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// TikTok TTS voice IDs (via public wrapper API)
const tiktokVoiceMap: Record<string, string> = {
  // Portuguese voices
  "pt-BR-male": "br_003", // Brazilian Portuguese Male
  "pt-BR-female": "br_004", // Brazilian Portuguese Female
  // English voices  
  "en-US-male": "en_us_006", // US English Male
  "en-US-female": "en_us_001", // US English Female
  "en-GB-male": "en_uk_001", // UK English Male
  "en-GB-female": "en_uk_003", // UK English Female
  // Spanish voices
  "es-ES-male": "es_002", // Spanish Male
  "es-MX-male": "es_mx_002", // Mexican Spanish Male
};

// Google Translate TTS as fallback
async function generateWithGoogleTTS(text: string, lang: string): Promise<ArrayBuffer | null> {
  try {
    // Split text into chunks (Google TTS has ~200 char limit)
    const chunks: string[] = [];
    const words = text.split(' ');
    let currentChunk = '';
    
    for (const word of words) {
      if ((currentChunk + ' ' + word).length > 180) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = word;
      } else {
        currentChunk = currentChunk ? currentChunk + ' ' + word : word;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());

    // Get first chunk only for now (to avoid rate limits)
    const textToSpeak = chunks[0] || text.substring(0, 180);
    const encodedText = encodeURIComponent(textToSpeak);
    
    const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=${lang}&client=tw-ob`;
    
    const response = await fetch(googleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://translate.google.com/',
      },
    });

    if (response.ok) {
      return await response.arrayBuffer();
    }
  } catch (e) {
    console.error('[TTS] Google TTS error:', e);
  }
  return null;
}

// TikTok TTS via public wrapper
async function generateWithTikTokTTS(text: string, voice: string): Promise<ArrayBuffer | null> {
  try {
    // Use a public TikTok TTS wrapper
    const response = await fetch('https://tiktok-tts.weilbyte.dev/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.substring(0, 300), // TikTok has character limits
        voice: voice,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.data) {
        // Decode base64 audio data
        const binaryString = atob(data.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
      }
    } else {
      console.error('[TTS] TikTok API error:', response.status);
    }
  } catch (e) {
    console.error('[TTS] TikTok TTS error:', e);
  }
  return null;
}

// VoiceRSS as another fallback (limited free tier)
async function generateWithVoiceRSS(text: string, lang: string): Promise<ArrayBuffer | null> {
  try {
    const apiKey = 'b20c9a6e7e5b4a8eaa8b9c7d8e9f0a1b'; // Demo key
    const encodedText = encodeURIComponent(text.substring(0, 300));
    const url = `https://api.voicerss.org/?key=${apiKey}&hl=${lang}&src=${encodedText}&c=MP3`;
    
    const response = await fetch(url);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      // Check if it's valid audio (not an error message)
      if (buffer.byteLength > 1000) {
        return buffer;
      }
    }
  } catch (e) {
    console.error('[TTS] VoiceRSS error:', e);
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, targetLanguage, voiceGender = "male" } = await req.json();

    if (!text) {
      return new Response(
        JSON.stringify({ error: "No text provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[TTS] Generating audio for text length: ${text.length}, lang: ${targetLanguage}`);

    // Get appropriate voice
    const voiceKey = `${targetLanguage}-${voiceGender}`;
    const tiktokVoice = tiktokVoiceMap[voiceKey] || tiktokVoiceMap["pt-BR-male"];
    
    // Lang code for Google TTS
    const googleLang = targetLanguage?.split('-')[0] || 'pt';

    let audioBuffer: ArrayBuffer | null = null;
    let usedVoice = 'tiktok';

    // Try TikTok TTS first (best quality, TikTok-like voices)
    console.log(`[TTS] Trying TikTok TTS with voice: ${tiktokVoice}`);
    audioBuffer = await generateWithTikTokTTS(text, tiktokVoice);

    // Fallback to Google Translate TTS
    if (!audioBuffer) {
      console.log(`[TTS] Trying Google Translate TTS`);
      audioBuffer = await generateWithGoogleTTS(text, googleLang);
      usedVoice = 'google';
    }

    // Final fallback to VoiceRSS
    if (!audioBuffer) {
      console.log(`[TTS] Trying VoiceRSS`);
      audioBuffer = await generateWithVoiceRSS(text, targetLanguage || 'pt-br');
      usedVoice = 'voicerss';
    }

    if (!audioBuffer) {
      return new Response(
        JSON.stringify({ error: "All TTS providers failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBase64 = arrayBufferToBase64(audioBuffer);
    console.log(`[TTS] Successfully generated ${audioBuffer.byteLength} bytes using ${usedVoice}`);

    return new Response(
      JSON.stringify({
        audioBase64,
        format: "mp3",
        voice: usedVoice,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[TTS] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
