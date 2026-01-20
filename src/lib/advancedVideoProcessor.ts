import { type GreenArea } from './greenDetection';
import { supabase } from '@/integrations/supabase/client';
import {
  captureVideoFrame,
  analyzeVideoFrame,
  getDefaultAnalysis,
  calculateSmartPosition,
  type FrameAnalysis,
} from './frameAnalyzer';

export interface AdvancedSettingsType {
  fitMode: 'cover' | 'contain' | 'fill';
  normalizeAudio: boolean;
  maxQuality: boolean;
  removeBlackBars: boolean;
  watermark: string;
  useAiFraming: boolean;
  enableCaptions: boolean;
  captionStyle: 'bottom' | 'center' | 'top';
  captionLanguage: 'original' | 'pt-BR' | 'en-US' | 'es-ES';
  enableDubbing: boolean;
  dubbingLanguage: string;
  autoDubForeignOnly: boolean;
}

export interface AdvancedProcessingProgress {
  videoId: string;
  progress: number;
  stage: 'loading' | 'transcribing' | 'translating' | 'dubbing' | 'rendering' | 'encoding' | 'done' | 'error';
  message: string;
}

export type AdvancedProgressCallback = (progress: AdvancedProcessingProgress) => void;

interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

interface Transcription {
  text: string;
  words: TranscriptionWord[];
  detectedLanguage?: string;
}

/**
 * Extract audio from video as base64
 */
async function extractAudioBase64(videoFile: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;

    video.onloadedmetadata = async () => {
      try {
        const audioContext = new AudioContext();
        const response = await fetch(video.src);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Convert to WAV
        const wavBlob = audioBufferToWav(audioBuffer);
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(wavBlob);
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(video.src);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video for audio extraction'));
    };
  });
}

/**
 * Convert AudioBuffer to WAV Blob
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const samples = buffer.length;
  const dataSize = samples * blockAlign;
  const bufferSize = 44 + dataSize;
  
  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);
  
  // Write WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write audio data
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }
  
  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Transcribe audio using AI
 */
async function transcribeAudio(audioBase64: string, videoId: string): Promise<Transcription> {
  try {
    const { data, error } = await supabase.functions.invoke('transcribe-audio', {
      body: { audioBase64, videoId },
    });

    if (error) {
      console.warn('[AdvancedProcessor] Transcription error:', error);
      return { text: '', words: [], detectedLanguage: 'unknown' };
    }

    return {
      text: data?.text || '',
      words: data?.words || [],
      detectedLanguage: data?.detectedLanguage || 'unknown',
    };
  } catch (e) {
    console.warn('[AdvancedProcessor] Transcription failed:', e);
    return { text: '', words: [], detectedLanguage: 'unknown' };
  }
}

/**
 * Translate transcription to target language
 */
async function translateTranscription(
  transcription: Transcription,
  targetLanguage: string
): Promise<Transcription> {
  if (!transcription.text || transcription.text.length === 0) {
    return transcription;
  }

  try {
    const { data, error } = await supabase.functions.invoke('generate-dubbing', {
      body: { text: transcription.text, targetLanguage },
    });

    if (error || !data?.translatedText) {
      console.warn('[AdvancedProcessor] Translation failed:', error);
      return transcription;
    }

    // Re-estimate word timings for translated text
    const translatedWords = data.translatedText.split(/\s+/);
    const totalDuration = transcription.words.length > 0 
      ? transcription.words[transcription.words.length - 1].end 
      : 10;
    
    const wordDuration = totalDuration / translatedWords.length;
    
    const newWords: TranscriptionWord[] = translatedWords.map((word: string, i: number) => ({
      word,
      start: i * wordDuration,
      end: (i + 1) * wordDuration,
    }));

    return {
      text: data.translatedText,
      words: newWords,
      detectedLanguage: targetLanguage,
    };
  } catch (e) {
    console.warn('[AdvancedProcessor] Translation failed:', e);
    return transcription;
  }
}

/**
 * Generate dubbed audio using TTS
 */
async function generateDubbedAudio(
  transcription: Transcription,
  language: string,
  videoDuration: number
): Promise<{ audioBlob: Blob; translatedText: string } | null> {
  if (!transcription.text || transcription.text.length === 0) {
    console.log('[AdvancedProcessor] No text to dub');
    return null;
  }

  try {
    console.log('[AdvancedProcessor] Starting dubbing process...');
    
    // First translate the text
    const { data: translationData, error: translationError } = await supabase.functions.invoke('generate-dubbing', {
      body: { text: transcription.text, targetLanguage: language },
    });

    if (translationError || !translationData?.translatedText) {
      console.warn('[AdvancedProcessor] Translation failed:', translationError);
      return null;
    }

    console.log('[AdvancedProcessor] Text translated:', translationData.translatedText.substring(0, 100) + '...');

    // Generate TTS audio using our edge function
    const { data: ttsData, error: ttsError } = await supabase.functions.invoke('generate-tts', {
      body: { 
        text: translationData.translatedText, 
        targetLanguage: language,
        voiceGender: 'male'
      },
    });

    if (ttsError || !ttsData?.audioBase64) {
      console.warn('[AdvancedProcessor] TTS failed:', ttsError);
      return null;
    }

    console.log('[AdvancedProcessor] TTS audio generated, voice:', ttsData.voice);

    // Convert base64 to Blob
    const binaryString = atob(ttsData.audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });

    console.log('[AdvancedProcessor] Dubbed audio blob size:', audioBlob.size);

    return { 
      audioBlob, 
      translatedText: translationData.translatedText 
    };
  } catch (e) {
    console.warn('[AdvancedProcessor] Dubbing failed:', e);
    return null;
  }
}

/**
 * Detect if language is Portuguese
 */
function isPortuguese(lang: string): boolean {
  const ptVariants = ['pt', 'pt-br', 'pt-pt', 'portuguese', 'português', 'portugues'];
  return ptVariants.some(v => lang.toLowerCase().includes(v));
}

/**
 * Draw captions on canvas with improved timing
 */
function drawCaptions(
  ctx: CanvasRenderingContext2D,
  transcription: Transcription,
  currentTime: number,
  greenArea: GreenArea,
  style: 'bottom' | 'center' | 'top'
) {
  if (!transcription.words || transcription.words.length === 0) return;

  // Find current word with extended timing window (slower captions)
  const currentWordIndex = transcription.words.findIndex(
    (w, i) => {
      // Extend each word's duration by 30% for slower reading
      const extendedEnd = w.end + (w.end - w.start) * 0.3;
      const nextWord = transcription.words[i + 1];
      const effectiveEnd = nextWord ? Math.min(extendedEnd, nextWord.start) : extendedEnd;
      return currentTime >= w.start && currentTime <= effectiveEnd;
    }
  );

  if (currentWordIndex === -1) return;

  // Get 4-6 words context around current word for better readability
  const contextStart = Math.max(0, currentWordIndex - 2);
  const contextEnd = Math.min(transcription.words.length, currentWordIndex + 4);
  const contextWords = transcription.words.slice(contextStart, contextEnd);

  // Calculate position based on style
  const x = greenArea.x;
  const width = greenArea.width;
  let y: number;
  
  switch (style) {
    case 'top':
      y = greenArea.y + 50;
      break;
    case 'center':
      y = greenArea.y + greenArea.height / 2;
      break;
    case 'bottom':
    default:
      y = greenArea.y + greenArea.height - 70;
      break;
  }

  // Draw background
  const fontSize = Math.min(28, greenArea.width / 18);
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  
  const text = contextWords.map(w => w.word).join(' ');
  const textMetrics = ctx.measureText(text);
  const textWidth = textMetrics.width;
  const padding = 14;
  
  const bgX = x + (width - textWidth) / 2 - padding;
  const bgY = y - fontSize - padding / 2;
  const bgWidth = textWidth + padding * 2;
  const bgHeight = fontSize + padding + 4;

  // Draw rounded background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.beginPath();
  ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 10);
  ctx.fill();

  // Draw words with highlight on current word
  let currentX = x + (width - textWidth) / 2;
  
  for (let i = 0; i < contextWords.length; i++) {
    const word = contextWords[i];
    const isCurrentWord = i === (currentWordIndex - contextStart);
    
    // Yellow highlight for current word, white for others
    ctx.fillStyle = isCurrentWord ? '#FFD700' : '#FFFFFF';
    ctx.fillText(word.word, currentX, y);
    
    currentX += ctx.measureText(word.word + ' ').width;
  }
}

/**
 * Main advanced video processing function
 */
export async function processAdvancedVideo(
  videoFile: File,
  templateFile: File,
  greenArea: GreenArea,
  settings: AdvancedSettingsType,
  videoId: string,
  onProgress: AdvancedProgressCallback
): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    let audioContext: AudioContext | null = null;
    let dubbedAudioSource: AudioBufferSourceNode | null = null;
    
    try {
      onProgress({ videoId, progress: 0, stage: 'loading', message: 'Carregando arquivos...' });

      // Load template image
      const templateUrl = URL.createObjectURL(templateFile);
      const templateImg = new Image();
      await new Promise<void>((res, rej) => {
        templateImg.onload = () => res();
        templateImg.onerror = rej;
        templateImg.src = templateUrl;
      });

      // Load video
      const videoUrl = URL.createObjectURL(videoFile);
      const video = document.createElement('video');
      video.muted = false; // Keep unmuted for audio capture
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = rej;
        video.src = videoUrl;
      });

      const duration = video.duration;

      // Transcription for captions
      let transcription: Transcription = { text: '', words: [], detectedLanguage: 'unknown' };
      let captionTranscription: Transcription = { text: '', words: [], detectedLanguage: 'unknown' };
      
      if (settings.enableCaptions || settings.enableDubbing) {
        onProgress({ videoId, progress: 5, stage: 'transcribing', message: 'Transcrevendo áudio...' });
        
        try {
          const audioBase64 = await extractAudioBase64(videoFile);
          transcription = await transcribeAudio(audioBase64, videoId);
          console.log('[AdvancedProcessor] Detected language:', transcription.detectedLanguage);
        } catch (e) {
          console.warn('[AdvancedProcessor] Audio extraction failed:', e);
        }
      }

      // Translate captions if needed
      if (settings.enableCaptions && transcription.text) {
        if (settings.captionLanguage !== 'original') {
          onProgress({ videoId, progress: 10, stage: 'translating', message: 'Traduzindo legendas...' });
          captionTranscription = await translateTranscription(transcription, settings.captionLanguage);
        } else {
          captionTranscription = transcription;
        }
      }

      // Dubbing - check if should dub based on detected language
      let dubbedAudioBlob: Blob | null = null;
      let shouldDub: boolean = !!(settings.enableDubbing && transcription.text);
      
      if (shouldDub && settings.autoDubForeignOnly) {
        // Only dub if video is NOT in Portuguese
        const detectedLang = transcription.detectedLanguage || 'unknown';
        if (isPortuguese(detectedLang)) {
          console.log('[AdvancedProcessor] Video is in Portuguese, skipping dubbing');
          shouldDub = false;
        }
      }
      
      if (shouldDub) {
        onProgress({ videoId, progress: 15, stage: 'dubbing', message: 'Gerando dublagem...' });
        const dubbingResult = await generateDubbedAudio(transcription, settings.dubbingLanguage, duration);
        if (dubbingResult) {
          dubbedAudioBlob = dubbingResult.audioBlob;
          console.log('[AdvancedProcessor] Dubbed audio ready');
        }
      }

      // AI Framing analysis
      let frameAnalysis: FrameAnalysis = getDefaultAnalysis();
      
      if (settings.useAiFraming) {
        onProgress({ videoId, progress: 20, stage: 'rendering', message: 'Analisando enquadramento...' });
        try {
          video.currentTime = 0.1;
          await new Promise(res => setTimeout(res, 200));
          const frameBase64 = await captureVideoFrame(video);
          frameAnalysis = await analyzeVideoFrame(frameBase64);
        } catch (e) {
          console.warn('[AdvancedProcessor] Frame analysis failed:', e);
        }
      }

      onProgress({ videoId, progress: 25, stage: 'rendering', message: 'Renderizando vídeo...' });

      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = templateImg.width;
      canvas.height = templateImg.height;
      const ctx = canvas.getContext('2d')!;

      // Calculate video positioning
      const { offsetX, offsetY, scale } = calculateSmartPosition(
        video.videoWidth,
        video.videoHeight,
        greenArea.width,
        greenArea.height,
        frameAnalysis
      );

      // Setup MediaRecorder
      const fps = settings.maxQuality ? 60 : 30;
      const bitrate = settings.maxQuality ? 12000000 : 6000000;
      
      const stream = canvas.captureStream(fps);
      
      // Setup audio context and add audio track
      audioContext = new AudioContext();
      const destNode = audioContext.createMediaStreamDestination();
      
      if (dubbedAudioBlob) {
        // Use dubbed audio instead of original
        console.log('[AdvancedProcessor] Using dubbed audio...');
        try {
          const arrayBuffer = await dubbedAudioBlob.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          dubbedAudioSource = audioContext.createBufferSource();
          dubbedAudioSource.buffer = audioBuffer;
          dubbedAudioSource.connect(destNode);
          // Will start when video plays
        } catch (e) {
          console.warn('[AdvancedProcessor] Failed to decode dubbed audio:', e);
        }
      } else {
        // Use original video audio
        console.log('[AdvancedProcessor] Using original audio...');
        try {
          const sourceNode = audioContext.createMediaElementSource(video);
          const gainNode = audioContext.createGain();
          gainNode.gain.value = 1.0;
          sourceNode.connect(gainNode);
          gainNode.connect(destNode);
          gainNode.connect(audioContext.destination); // Also play locally if needed
        } catch (e) {
          console.warn('[AdvancedProcessor] Failed to capture original audio:', e);
        }
      }

      // Add audio track to stream
      destNode.stream.getAudioTracks().forEach(track => stream.addTrack(track));

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrate,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        URL.revokeObjectURL(templateUrl);
        URL.revokeObjectURL(videoUrl);
        
        if (audioContext) {
          audioContext.close();
        }
        
        const blob = new Blob(chunks, { type: 'video/webm' });
        onProgress({ videoId, progress: 100, stage: 'done', message: 'Concluído!' });
        resolve(blob);
      };

      recorder.onerror = (e) => {
        reject(new Error('Recording failed'));
      };

      // Reset video and start recording
      video.currentTime = 0;
      await new Promise(res => setTimeout(res, 100));

      recorder.start();
      
      // Start dubbed audio if available
      if (dubbedAudioSource) {
        dubbedAudioSource.start(0);
      }
      
      await video.play();

      const renderFrame = () => {
        if (video.paused || video.ended) {
          recorder.stop();
          return;
        }

        // Clear canvas and draw template
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Fill green area with white first (prevents black flash)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(greenArea.x, greenArea.y, greenArea.width, greenArea.height);
        
        // Draw video in green area
        ctx.save();
        ctx.beginPath();
        ctx.rect(greenArea.x - 2, greenArea.y - 2, greenArea.width + 4, greenArea.height + 4);
        ctx.clip();

        const drawX = greenArea.x + offsetX;
        const drawY = greenArea.y + offsetY;
        const drawW = video.videoWidth * scale;
        const drawH = video.videoHeight * scale;

        ctx.drawImage(video, drawX, drawY, drawW, drawH);
        ctx.restore();

        // Draw template on top (overlay)
        ctx.drawImage(templateImg, 0, 0);
        
        // Redraw video in green area (template has green, this replaces it)
        ctx.save();
        ctx.beginPath();
        ctx.rect(greenArea.x - 2, greenArea.y - 2, greenArea.width + 4, greenArea.height + 4);
        ctx.clip();
        ctx.drawImage(video, drawX, drawY, drawW, drawH);
        ctx.restore();

        // Draw captions if enabled
        if (settings.enableCaptions && captionTranscription.words.length > 0) {
          drawCaptions(ctx, captionTranscription, video.currentTime, greenArea, settings.captionStyle);
        }

        // Draw watermark
        if (settings.watermark) {
          ctx.font = 'bold 18px Arial';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.textAlign = 'right';
          ctx.fillText(settings.watermark, canvas.width - 20, canvas.height - 20);
        }

        // Update progress
        const progress = 25 + (video.currentTime / duration) * 70;
        onProgress({ videoId, progress, stage: 'rendering', message: `Renderizando... ${Math.round(video.currentTime)}s/${Math.round(duration)}s` });

        requestAnimationFrame(renderFrame);
      };

      renderFrame();
    } catch (error) {
      if (audioContext) {
        audioContext.close();
      }
      onProgress({ videoId, progress: 0, stage: 'error', message: error instanceof Error ? error.message : 'Erro desconhecido' });
      reject(error);
    }
  });
}