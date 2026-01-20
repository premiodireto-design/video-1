import { supabase } from "@/integrations/supabase/client";
import type { CaptionData } from "./videoProcessor";

declare global {
  interface Window {
    puter?: {
      ai: {
        txt2speech: (text: string, options?: { voice?: string; lang?: string }) => Promise<Blob>;
      };
    };
  }
}

/**
 * Loads the Puter.js SDK for free TTS
 */
export async function loadPuterSDK(): Promise<boolean> {
  if (window.puter) return true;
  
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://js.puter.com/v2/';
    script.async = true;
    
    script.onload = () => {
      // Wait for puter to initialize
      setTimeout(() => {
        resolve(!!window.puter);
      }, 500);
    };
    
    script.onerror = () => {
      console.error('[DubbingService] Failed to load Puter SDK');
      resolve(false);
    };
    
    document.head.appendChild(script);
  });
}

/**
 * Translates text using the Lovable AI translation service
 */
export async function translateText(
  text: string, 
  words: Array<{ text: string; start: number; end: number }>,
  targetLanguage: string = 'pt-BR'
): Promise<CaptionData> {
  try {
    const { data, error } = await supabase.functions.invoke('translate-text', {
      body: { text, words, targetLanguage }
    });
    
    if (error) {
      console.error('[DubbingService] Translation error:', error);
      throw error;
    }
    
    return {
      text: data.translatedText || text,
      words: data.words || []
    };
  } catch (error) {
    console.error('[DubbingService] Translation failed:', error);
    throw error;
  }
}

/**
 * Generates speech audio from text using Puter.js (free, no API key)
 */
export async function textToSpeech(text: string, language: string = 'pt-BR'): Promise<Blob> {
  const loaded = await loadPuterSDK();
  
  if (!loaded || !window.puter) {
    throw new Error('Failed to load Puter SDK for text-to-speech');
  }
  
  try {
    // Use Brazilian Portuguese voice
    const audioBlob = await window.puter.ai.txt2speech(text, {
      lang: language,
      voice: language === 'pt-BR' ? 'pt-BR-FranciscaNeural' : undefined
    });
    
    return audioBlob;
  } catch (error) {
    console.error('[DubbingService] TTS error:', error);
    throw error;
  }
}

/**
 * Creates an audio element from a blob
 */
export function createAudioFromBlob(blob: Blob): HTMLAudioElement {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  return audio;
}

/**
 * Combines original video with new audio track
 * Returns a Blob with the dubbed video
 */
export async function combineVideoWithAudio(
  videoBlob: Blob,
  audioBlob: Blob,
  keepOriginalAudio: boolean = false,
  originalAudioVolume: number = 0.2
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const videoUrl = URL.createObjectURL(videoBlob);
    
    video.onloadedmetadata = async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d')!;
        
        // Create audio context for mixing
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        
        // Add new dubbed audio
        const dubbedAudioElement = new Audio(URL.createObjectURL(audioBlob));
        dubbedAudioElement.volume = 1;
        
        const dubbedSource = audioContext.createMediaElementSource(dubbedAudioElement);
        dubbedSource.connect(destination);
        
        // Optionally mix in original audio at lower volume
        let originalSource: MediaElementAudioSourceNode | null = null;
        if (keepOriginalAudio) {
          const originalAudioClone = video.cloneNode(true) as HTMLVideoElement;
          originalAudioClone.src = videoUrl;
          originalAudioClone.volume = originalAudioVolume;
          originalSource = audioContext.createMediaElementSource(originalAudioClone);
          originalSource.connect(destination);
        }
        
        // Combine video + audio streams
        const canvasStream = canvas.captureStream(30);
        const combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...destination.stream.getAudioTracks()
        ]);
        
        const recorder = new MediaRecorder(combinedStream, {
          mimeType: 'video/webm;codecs=vp9,opus',
          videoBitsPerSecond: 8000000
        });
        
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        
        recorder.onstop = () => {
          URL.revokeObjectURL(videoUrl);
          audioContext.close();
          resolve(new Blob(chunks, { type: 'video/webm' }));
        };
        
        // Start everything
        recorder.start();
        video.currentTime = 0;
        dubbedAudioElement.currentTime = 0;
        
        await Promise.all([
          video.play(),
          dubbedAudioElement.play()
        ]);
        
        // Render frames
        const renderFrame = () => {
          if (video.ended || video.paused) {
            recorder.stop();
            return;
          }
          ctx.drawImage(video, 0, 0);
          requestAnimationFrame(renderFrame);
        };
        renderFrame();
        
        video.onended = () => {
          dubbedAudioElement.pause();
          recorder.stop();
        };
        
      } catch (error) {
        URL.revokeObjectURL(videoUrl);
        reject(error);
      }
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(videoUrl);
      reject(new Error('Failed to load video'));
    };
    
    video.src = videoUrl;
    video.muted = true;
    video.load();
  });
}

/**
 * Full dubbing pipeline: transcribe -> translate -> TTS -> combine
 */
export interface DubbingResult {
  translatedCaptions: CaptionData;
  dubbedAudioBlob: Blob;
}

export async function dubVideo(
  originalCaptions: CaptionData,
  targetLanguage: string = 'pt-BR'
): Promise<DubbingResult> {
  console.log('[DubbingService] Starting dubbing pipeline...');
  
  // Step 1: Translate the transcription
  console.log('[DubbingService] Translating text...');
  const translatedCaptions = await translateText(
    originalCaptions.text,
    originalCaptions.words,
    targetLanguage
  );
  console.log('[DubbingService] Translation complete:', translatedCaptions.text.substring(0, 50));
  
  // Step 2: Generate speech from translated text
  console.log('[DubbingService] Generating speech...');
  const dubbedAudioBlob = await textToSpeech(translatedCaptions.text, targetLanguage);
  console.log('[DubbingService] Speech generated, size:', dubbedAudioBlob.size);
  
  return {
    translatedCaptions,
    dubbedAudioBlob
  };
}
