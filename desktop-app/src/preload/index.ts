import { contextBridge, ipcRenderer } from 'electron';

export interface GreenArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  success: boolean;
  area?: GreenArea;
  templateWidth?: number;
  templateHeight?: number;
  error?: string;
}

export interface TemplateSelection {
  path: string;
  detection: DetectionResult;
}

export interface UpdateStatus {
  status: string;
  message: string;
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
}

export interface ElectronAPI {
  detectGPU: () => Promise<{
    hasNvidia: boolean;
    hasIntelQSV: boolean;
    hasAMD: boolean;
    recommendedEncoder: string;
    availableEncoders: string[];
  }>;
  selectVideos: () => Promise<string[]>;
  selectTemplate: () => Promise<TemplateSelection | null>;
  selectOutputFolder: () => Promise<string | null>;
  processVideo: (options: {
    videoPath: string;
    templatePath: string;
    outputPath: string;
    greenArea: GreenArea;
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
  
  // Auto-update APIs
  checkForUpdates: () => Promise<{ success: boolean; updateInfo?: unknown; error?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  installUpdate: () => void;
  getAppVersion: () => Promise<string>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
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
  
  // Auto-update APIs
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => {
      callback(status);
    };
    ipcRenderer.on('update-status', handler);
    return () => {
      ipcRenderer.removeListener('update-status', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
