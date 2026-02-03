import React, { useState, useEffect } from 'react';

interface UpdateStatus {
  status: string;
  message: string;
  version?: string;
  percent?: number;
}

export function UpdateNotification() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    // Get current app version
    window.electronAPI?.getAppVersion?.().then(setAppVersion).catch(() => {});

    // Listen for update status
    const unsubscribe = window.electronAPI?.onUpdateStatus?.((status) => {
      setUpdateStatus(status);
      
      if (status.status === 'download-progress') {
        setIsDownloading(true);
      } else if (status.status === 'update-downloaded' || status.status === 'error') {
        setIsDownloading(false);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleDownload = async () => {
    setIsDownloading(true);
    await window.electronAPI?.downloadUpdate?.();
  };

  const handleInstall = () => {
    window.electronAPI?.installUpdate?.();
  };

  const handleDismiss = () => {
    setUpdateStatus(null);
  };

  // Don't render anything if no update status or if it's just checking
  if (!updateStatus || updateStatus.status === 'checking-for-update' || updateStatus.status === 'update-not-available') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl shadow-2xl p-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            {updateStatus.status === 'update-available' && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">🎉</span>
                  <h3 className="font-bold">Nova versão disponível!</h3>
                </div>
                <p className="text-sm text-blue-100 mb-3">
                  Versão {updateStatus.version} está pronta para download.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="px-4 py-2 bg-white text-blue-600 rounded-lg font-medium text-sm hover:bg-blue-50 transition disabled:opacity-50"
                  >
                    {isDownloading ? 'Baixando...' : 'Baixar agora'}
                  </button>
                  <button
                    onClick={handleDismiss}
                    className="px-4 py-2 bg-blue-500/30 rounded-lg text-sm hover:bg-blue-500/50 transition"
                  >
                    Depois
                  </button>
                </div>
              </>
            )}

            {updateStatus.status === 'download-progress' && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl animate-bounce">⬇️</span>
                  <h3 className="font-bold">Baixando atualização...</h3>
                </div>
                <div className="w-full bg-blue-400/30 rounded-full h-2 mb-2">
                  <div
                    className="bg-white h-2 rounded-full transition-all duration-300"
                    style={{ width: `${updateStatus.percent || 0}%` }}
                  />
                </div>
                <p className="text-sm text-blue-100">
                  {Math.round(updateStatus.percent || 0)}% concluído
                </p>
              </>
            )}

            {updateStatus.status === 'update-downloaded' && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">✅</span>
                  <h3 className="font-bold">Atualização pronta!</h3>
                </div>
                <p className="text-sm text-blue-100 mb-3">
                  Reinicie o app para aplicar a versão {updateStatus.version}.
                </p>
                <button
                  onClick={handleInstall}
                  className="px-4 py-2 bg-white text-blue-600 rounded-lg font-medium text-sm hover:bg-blue-50 transition"
                >
                  Reiniciar agora
                </button>
              </>
            )}

            {updateStatus.status === 'error' && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">⚠️</span>
                  <h3 className="font-bold">Erro na atualização</h3>
                </div>
                <p className="text-sm text-blue-100 mb-3">
                  {updateStatus.message}
                </p>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-blue-500/30 rounded-lg text-sm hover:bg-blue-500/50 transition"
                >
                  Fechar
                </button>
              </>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="text-white/70 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Current version footer */}
        {appVersion && (
          <div className="mt-3 pt-2 border-t border-white/20 text-xs text-blue-200">
            Versão atual: {appVersion}
          </div>
        )}
      </div>
    </div>
  );
}
