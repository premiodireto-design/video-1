import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  detectGPU: () => Promise<{
    hasNvidia: boolean;
    hasIntelQSV: boolean;
    hasAMD: boolean;
    recommendedEncoder: string;
    availableEncoders: string[];
  }>;
  selectVideos: () => Promise<string[]>;
  selectTemplate: () => Promise<string | null>;
  selectOutputFolder: () => Promise<string | null>;
  processVideo: (options: {
    videoPath: string;
    templatePath: string;
    outputPath: string;
    greenArea: { x: number; y: number; width: number; height: number };
    settings: {
      useGPU: boolean;
      encoder: string;
      quality: 'fast' | 'balanced' | 'quality';
      trimStart: number;
      trimEnd: number;
      useAiFraming?: boolean;
    };
  }) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
  onVideoProgress: (callback: (progress: {
    videoPath: string;
    progress: number;
    stage: 'analyzing' | 'processing' | 'done' | 'error';
    message: string;
    fps?: number;
    speed?: string;
  }) => void) => () => void;
}

const electronAPI: ElectronAPI = {
  detectGPU: () => ipcRenderer.invoke('detect-gpu'),
  selectVideos: () => ipcRenderer.invoke('select-videos'),
  selectTemplate: () => ipcRenderer.invoke('select-template'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  processVideo: (options) => ipcRenderer.invoke('process-video', options),
  onVideoProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => {
      callback(progress);
    };
    ipcRenderer.on('video-progress', handler);
    return () => {
      ipcRenderer.removeListener('video-progress', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
