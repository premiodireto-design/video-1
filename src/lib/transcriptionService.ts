import { supabase } from "@/integrations/supabase/client";
import type { CaptionData, CaptionWord } from "./videoProcessor";

/**
 * Extracts audio from a video file and returns it as a base64 string
 */
export async function extractAudioFromVideo(videoFile: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const videoUrl = URL.createObjectURL(videoFile);
    
    video.onloadedmetadata = async () => {
      try {
        // Create an offline audio context to render audio
        const duration = Math.min(video.duration, 60); // Max 60 seconds for API limits
        const sampleRate = 16000; // 16kHz for transcription
        const audioContext = new OfflineAudioContext(1, sampleRate * duration, sampleRate);
        
        // We can't directly extract audio from video in browser without playing it
        // So we'll record the audio while playing the video silently
        const audioBlob = await recordVideoAudio(video, duration);
        
        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          URL.revokeObjectURL(videoUrl);
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = () => {
          URL.revokeObjectURL(videoUrl);
          reject(new Error('Failed to read audio data'));
        };
        reader.readAsDataURL(audioBlob);
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
    video.load();
  });
}

/**
 * Records audio from a video element
 */
async function recordVideoAudio(video: HTMLVideoElement, maxDuration: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      // Create audio context and connect to video
      const audioContext = new AudioContext();
      const source = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      
      // Also connect to speakers so we can hear (muted via video.volume)
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0; // Silent
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Connect to recorder
      source.connect(destination);
      
      const mediaRecorder = new MediaRecorder(destination.stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        audioContext.close();
        const blob = new Blob(chunks, { type: 'audio/webm' });
        resolve(blob);
      };
      
      mediaRecorder.onerror = () => {
        audioContext.close();
        reject(new Error('Audio recording failed'));
      };
      
      // Start recording and play video
      video.currentTime = 0;
      video.volume = 0.001; // Near silent
      video.muted = false;
      
      video.oncanplay = () => {
        mediaRecorder.start();
        video.play().catch(reject);
      };
      
      video.onended = () => {
        mediaRecorder.stop();
      };
      
      // Timeout safety
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          video.pause();
          mediaRecorder.stop();
        }
      }, (maxDuration + 1) * 1000);
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Transcribes audio using the Lovable AI transcription service
 */
export async function transcribeAudio(audioBase64: string): Promise<CaptionData> {
  try {
    const { data, error } = await supabase.functions.invoke('transcribe-audio', {
      body: { audioBase64 }
    });
    
    if (error) {
      console.error('[TranscriptionService] Edge function error:', error);
      throw error;
    }
    
    if (data.error) {
      console.warn('[TranscriptionService] Transcription warning:', data.error);
    }
    
    return {
      text: data.text || '',
      words: data.words || []
    };
  } catch (error) {
    console.error('[TranscriptionService] Transcription failed:', error);
    // Return empty captions on error
    return { text: '', words: [] };
  }
}

/**
 * Full pipeline: extract audio from video and transcribe it
 */
export async function transcribeVideo(videoFile: File): Promise<CaptionData> {
  console.log('[TranscriptionService] Starting transcription for:', videoFile.name);
  
  try {
    const audioBase64 = await extractAudioFromVideo(videoFile);
    console.log('[TranscriptionService] Audio extracted, size:', audioBase64.length);
    
    const captions = await transcribeAudio(audioBase64);
    console.log('[TranscriptionService] Transcription complete:', captions.text.substring(0, 100));
    
    return captions;
  } catch (error) {
    console.error('[TranscriptionService] Full pipeline failed:', error);
    return { text: '', words: [] };
  }
}

/**
 * Generates mock caption data for testing (word-by-word timing)
 */
export function generateMockCaptions(duration: number): CaptionData {
  const sampleText = "Este é um exemplo de legenda animada que aparece no vídeo com destaque palavra por palavra";
  const words = sampleText.split(' ');
  const wordDuration = duration / words.length;
  
  return {
    text: sampleText,
    words: words.map((word, index) => ({
      text: word,
      start: index * wordDuration,
      end: (index + 1) * wordDuration
    }))
  };
}
