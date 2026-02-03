import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';

// Configure logging
autoUpdater.logger = log;
(autoUpdater.logger as typeof log).transports.file.level = 'info';

// Disable auto download - we want to ask the user first
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow: BrowserWindow | null = null;

export function initAutoUpdater(window: BrowserWindow): void {
  mainWindow = window;

  // Check for updates on startup (after 3 seconds delay)
  setTimeout(() => {
    checkForUpdates();
  }, 3000);

  // Check for updates every 30 minutes
  setInterval(() => {
    checkForUpdates();
  }, 30 * 60 * 1000);
}

function checkForUpdates(): void {
  log.info('[AutoUpdater] Checking for updates...');
  autoUpdater.checkForUpdates().catch((err) => {
    log.error('[AutoUpdater] Error checking for updates:', err);
  });
}

// ========== Auto Updater Events ==========

autoUpdater.on('checking-for-update', () => {
  log.info('[AutoUpdater] Checking for update...');
  sendStatusToWindow('checking-for-update', 'Verificando atualizações...');
});

autoUpdater.on('update-available', (info) => {
  log.info('[AutoUpdater] Update available:', info.version);
  sendStatusToWindow('update-available', `Nova versão disponível: ${info.version}`, {
    version: info.version,
    releaseNotes: info.releaseNotes,
    releaseDate: info.releaseDate,
  });
});

autoUpdater.on('update-not-available', (info) => {
  log.info('[AutoUpdater] No update available. Current version is latest.');
  sendStatusToWindow('update-not-available', 'Você está usando a versão mais recente!');
});

autoUpdater.on('error', (err) => {
  log.error('[AutoUpdater] Error:', err);
  sendStatusToWindow('error', `Erro ao verificar atualizações: ${err.message}`);
});

autoUpdater.on('download-progress', (progressObj) => {
  const message = `Baixando: ${Math.round(progressObj.percent)}%`;
  log.info(`[AutoUpdater] ${message}`);
  sendStatusToWindow('download-progress', message, {
    percent: progressObj.percent,
    bytesPerSecond: progressObj.bytesPerSecond,
    transferred: progressObj.transferred,
    total: progressObj.total,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  log.info('[AutoUpdater] Update downloaded:', info.version);
  sendStatusToWindow('update-downloaded', `Atualização ${info.version} baixada! Reinicie para instalar.`, {
    version: info.version,
  });
});

function sendStatusToWindow(status: string, message: string, data?: Record<string, unknown>): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, message, ...data });
  }
}

// ========== IPC Handlers ==========

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
  return autoUpdater.currentVersion.version;
});
