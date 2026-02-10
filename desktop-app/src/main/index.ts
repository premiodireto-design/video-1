import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { processVideo, detectGPU, type GPUInfo } from './ffmpeg';
import { detectGreenArea, type DetectionResult, type GreenArea } from './greenDetection';
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.videotemplatepro.desktop');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ========== IPC Handlers ==========

// Detect GPU capabilities
ipcMain.handle('detect-gpu', async (): Promise<GPUInfo> => {
  return detectGPU();
});

// Select files dialog
ipcMain.handle('select-videos', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'hevc', 'm4v'] },
    ],
  });
  return result.filePaths;
});

// Select template and detect green area
ipcMain.handle('select-template', async (): Promise<{ path: string; detection: DetectionResult } | null> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] },
    ],
  });
  
  const templatePath = result.filePaths[0];
  if (!templatePath) return null;
  
  // Auto-detect the green area in the template
  console.log('[IPC] Detecting green area in template:', templatePath);
  const detection = await detectGreenArea(templatePath);
  console.log('[IPC] Green area detection result:', detection);
  
  return { path: templatePath, detection };
});

// Select output folder
ipcMain.handle('select-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.filePaths[0] || null;
});

// Process a video
ipcMain.handle('process-video', async (event, options: {
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
    useTeste?: boolean;
    useMirror?: boolean;
  };
}) => {
  return processVideo(options, (progress) => {
    event.sender.send('video-progress', progress);
  });
});
