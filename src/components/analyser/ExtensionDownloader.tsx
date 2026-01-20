import { useState } from 'react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';

// Extension files content
const MANIFEST_JSON = `{
  "manifest_version": 3,
  "name": "TikTok Video Extractor",
  "version": "1.0.0",
  "description": "Extrai dados de vídeos de perfis do TikTok para análise",
  "permissions": ["activeTab", "scripting"],
  "host_permissions": ["*://*.tiktok.com/*"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icon16.png",
      "48": "icon48.png",
      "128": "icon128.png"
    }
  },
  "icons": {
    "16": "icon16.png",
    "48": "icon48.png",
    "128": "icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["*://*.tiktok.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}`;

const POPUP_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TikTok Extractor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
      padding: 16px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .header svg { width: 28px; height: 28px; }
    .header h1 { font-size: 16px; font-weight: 600; }
    .status {
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .status-label {
      font-size: 11px;
      text-transform: uppercase;
      color: rgba(255,255,255,0.5);
      margin-bottom: 4px;
    }
    .status-value { font-size: 14px; font-weight: 500; }
    .status-value.ready { color: #00f5d4; }
    .status-value.not-ready { color: #ff6b6b; }
    .count-box {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: linear-gradient(135deg, #00f5d4 0%, #00bbf9 100%);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .count-number { font-size: 32px; font-weight: 700; color: #1a1a2e; }
    .count-label { font-size: 14px; color: #1a1a2e; opacity: 0.8; }
    .btn {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 8px;
    }
    .btn-primary {
      background: linear-gradient(135deg, #fe2c55 0%, #25f4ee 100%);
      color: #fff;
    }
    .btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(254, 44, 85, 0.4);
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    .btn-secondary {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }
    .btn-secondary:hover { background: rgba(255,255,255,0.15); }
    .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
    .info {
      font-size: 11px;
      color: rgba(255,255,255,0.5);
      text-align: center;
      margin-top: 12px;
      line-height: 1.5;
    }
    .loading { display: none; text-align: center; padding: 20px; }
    .loading.active { display: block; }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255,255,255,0.1);
      border-top-color: #00f5d4;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="header">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
    </svg>
    <h1>TikTok Extractor</h1>
  </div>
  <div id="main-content">
    <div class="status">
      <div class="status-label">Status</div>
      <div class="status-value" id="status-text">Verificando...</div>
    </div>
    <div class="count-box" id="count-box">
      <span class="count-number" id="video-count">0</span>
      <span class="count-label">vídeos<br>encontrados</span>
    </div>
    <button class="btn btn-primary" id="extract-btn" disabled>🔍 Extrair Vídeos</button>
    <button class="btn btn-secondary" id="copy-btn" disabled>📋 Copiar JSON</button>
    <button class="btn btn-secondary" id="scroll-btn" disabled>⬇️ Carregar Mais (Scroll)</button>
  </div>
  <div class="loading" id="loading">
    <div class="spinner"></div>
    <div>Extraindo dados...</div>
  </div>
  <p class="info">Acesse um perfil do TikTok (@usuario) e clique em "Extrair Vídeos" para obter os dados.</p>
  <script src="popup.js"></script>
</body>
</html>`;

const POPUP_JS = `let extractedData = null;

document.addEventListener('DOMContentLoaded', async () => {
  const statusText = document.getElementById('status-text');
  const videoCount = document.getElementById('video-count');
  const extractBtn = document.getElementById('extract-btn');
  const copyBtn = document.getElementById('copy-btn');
  const scrollBtn = document.getElementById('scroll-btn');
  const loading = document.getElementById('loading');
  const mainContent = document.getElementById('main-content');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const isProfile = url.includes('tiktok.com/@');
  
  if (!isProfile) {
    statusText.textContent = 'Abra um perfil do TikTok';
    statusText.className = 'status-value not-ready';
    return;
  }

  const usernameMatch = url.match(/tiktok\\.com\\/@([^\\/\\?]+)/);
  const username = usernameMatch ? usernameMatch[1] : 'desconhecido';
  
  statusText.textContent = 'Perfil: @' + username;
  statusText.className = 'status-value ready';
  extractBtn.disabled = false;
  scrollBtn.disabled = false;

  extractBtn.addEventListener('click', async () => {
    loading.classList.add('active');
    mainContent.classList.add('hidden');
    
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractVideosFromPage,
      });
      
      extractedData = results[0]?.result;
      
      if (extractedData && extractedData.videos.length > 0) {
        videoCount.textContent = extractedData.videos.length;
        copyBtn.disabled = false;
      } else {
        videoCount.textContent = '0';
        statusText.textContent = 'Nenhum vídeo encontrado';
        statusText.className = 'status-value not-ready';
      }
    } catch (err) {
      console.error('Extraction error:', err);
      statusText.textContent = 'Erro na extração';
      statusText.className = 'status-value not-ready';
    }
    
    loading.classList.remove('active');
    mainContent.classList.remove('hidden');
  });

  copyBtn.addEventListener('click', async () => {
    if (!extractedData) return;
    
    try {
      await navigator.clipboard.writeText(JSON.stringify(extractedData, null, 2));
      copyBtn.textContent = '✅ Copiado!';
      setTimeout(() => { copyBtn.textContent = '📋 Copiar JSON'; }, 2000);
    } catch (err) {
      console.error('Copy error:', err);
    }
  });

  scrollBtn.addEventListener('click', async () => {
    scrollBtn.disabled = true;
    scrollBtn.textContent = '⏳ Carregando...';
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: autoScrollPage,
      });
    } catch (err) {
      console.error('Scroll error:', err);
    }
    
    setTimeout(() => {
      scrollBtn.disabled = false;
      scrollBtn.textContent = '⬇️ Carregar Mais (Scroll)';
    }, 5000);
  });
});

function extractVideosFromPage() {
  const videos = [];
  const seenIds = new Set();
  
  const universalScript = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (universalScript) {
    try {
      const data = JSON.parse(universalScript.textContent);
      const defaultScope = data?.['__DEFAULT_SCOPE__'] || {};
      const userDetail = defaultScope['webapp.user-detail'];
      const user = userDetail?.userInfo?.user;
      const userPost = defaultScope['webapp.user-post'];
      const itemList = userPost?.itemList || [];
      
      for (const item of itemList) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        
        const stats = item.stats || {};
        videos.push({
          id: item.id,
          desc: item.desc || '',
          createTime: item.createTime,
          stats: {
            playCount: stats.playCount || 0,
            diggCount: stats.diggCount || 0,
            commentCount: stats.commentCount || 0,
            shareCount: stats.shareCount || 0,
            collectCount: stats.collectCount || 0,
          },
          video: { cover: item.video?.cover || item.video?.dynamicCover || '' },
          author: { uniqueId: user?.uniqueId || item.author?.uniqueId || '' },
        });
      }
    } catch (e) {
      console.log('Failed to parse UNIVERSAL_DATA:', e);
    }
  }
  
  const sigiScript = document.getElementById('SIGI_STATE');
  if (sigiScript && videos.length === 0) {
    try {
      const data = JSON.parse(sigiScript.textContent);
      const itemModule = data?.ItemModule || {};
      const userModule = data?.UserModule?.users || {};
      const userData = Object.values(userModule)[0];
      
      for (const item of Object.values(itemModule)) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        
        const stats = item.stats || {};
        videos.push({
          id: item.id,
          desc: item.desc || '',
          createTime: item.createTime,
          stats: {
            playCount: stats.playCount || 0,
            diggCount: stats.diggCount || 0,
            commentCount: stats.commentCount || 0,
            shareCount: stats.shareCount || 0,
            collectCount: stats.collectCount || 0,
          },
          video: { cover: item.video?.cover || item.video?.dynamicCover || '' },
          author: { uniqueId: userData?.uniqueId || item.author?.uniqueId || '' },
        });
      }
    } catch (e) {
      console.log('Failed to parse SIGI_STATE:', e);
    }
  }
  
  if (videos.length === 0) {
    const videoElements = document.querySelectorAll('[data-e2e="user-post-item"]');
    const username = window.location.pathname.replace(/^\\//, '').replace(/@/, '').split('/')[0];
    
    videoElements.forEach((el, idx) => {
      const link = el.querySelector('a');
      const href = link?.href || '';
      const idMatch = href.match(/video\\/(\\d+)/);
      const id = idMatch ? idMatch[1] : String(Date.now() + idx);
      
      if (seenIds.has(id)) return;
      seenIds.add(id);
      
      const viewText = el.querySelector('[data-e2e="video-views"]')?.textContent || '0';
      const views = parseCount(viewText);
      
      videos.push({
        id,
        desc: '',
        createTime: Math.floor(Date.now() / 1000),
        stats: { playCount: views, diggCount: 0, commentCount: 0, shareCount: 0, collectCount: 0 },
        video: { cover: '' },
        author: { uniqueId: username },
      });
    });
  }
  
  function parseCount(text) {
    if (!text) return 0;
    text = text.toLowerCase().trim();
    const num = parseFloat(text.replace(/[^0-9.]/g, ''));
    if (text.includes('k')) return Math.round(num * 1000);
    if (text.includes('m')) return Math.round(num * 1000000);
    if (text.includes('b')) return Math.round(num * 1000000000);
    return Math.round(num) || 0;
  }
  
  const urlUsername = window.location.pathname.replace(/^\\//, '').replace(/@/, '').split('/')[0];
  
  return { username: urlUsername, extractedAt: new Date().toISOString(), videos };
}

function autoScrollPage() {
  return new Promise((resolve) => {
    let scrollCount = 0;
    const maxScrolls = 10;
    
    const interval = setInterval(() => {
      window.scrollTo(0, document.body.scrollHeight);
      scrollCount++;
      
      if (scrollCount >= maxScrolls) {
        clearInterval(interval);
        window.scrollTo(0, 0);
        resolve();
      }
    }, 500);
  });
}`;

const CONTENT_JS = `console.log('[TikTok Extractor] Content script loaded');
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') sendResponse({ status: 'ok' });
  return true;
});`;

// Simple 16x16 PNG icon (base64)
const ICON_16_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADlSURBVDiNpZMxCsJAEEV/EizEwsLGwsrGM3gAr2BhYeMZPIu9hbU38AqewcZC0MJGEIuAhdhYKIiFvxG2cRNI8GFgZ2f+zM4sCsA7QAFMAXvAp8w5a8AD0AfWwLaEbwAzYBw4A5UKPAb6wCTw2gJMgF5RBHgC1sAKeLfAQ2Aa+DSwB5xl4BTYAUfAR1sN7IER4Al4twJDYAAMgHdb1RToAdfAJPDWVAPPgEvgAvhstdEH+sAd8NpWA0tgGpgBb201cA+MgCvgo9VA37gBroBv80vbgAfAMXBqq4ED4AR4tNV+AE8nfH4F8tR9AAAAAElFTkSuQmCC';

// Simple 48x48 PNG icon (base64)
const ICON_48_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAI/SURBVGiB7ZixaxRBFMZ/c5eYRCOIKBZaxEawsLCwsLCwsLCwsLCw8F8QbGy0sbDQwsLCwsLCQrCwsLCwsLDQQhAsFBQ0RoJRNJrk4mVn3ljsHru3e5d4e7Nh4YNlZ3fmzXzz5s3Mzq4oikJRqKq/gHPAB+A38BNYBNaAX8AG8BVYBH4Av4E/wCKwDiwBv4B1YBn4DfwGVoBlYA34A/wF/gHLwCrwD/gPrAArwD9gFVgD/gNrwBqwBvwH1oE1YB34D6wD68A/YANYBzaA/8AGsAFsAP+BTWAT2AT+A5vAJrAJ/Ac2gU1gE/gPbAFbwBbwH9gCtoAt4D+wDWwD28B/YBvYBraB/8AOsAPsAP+BHWAH2AH+A7vALrAL/Ad2gV1gF/gP7AF7wB7wH9gD9oA94D+wD+wD+8B/YB84AA6A/8ABcAAcAP+BQ+AQOAT+A4fAIXAI/AeOgCPgCPgPHAFHwBHwHzgGjoFj4D9wDBwDx8B/4AQ4AU6A/8AJcAKcAP+BU+AUOAX+A6fAKXAK/AfOgDPgDPgPnAFnwBnwHzgHzoFz4D9wDpwD58B/wAEO8AB/gCfAE8Bz4AlwDngCeAI8BzwHngBPAU8AzwHPASfAE8AJ8BxwAjgBnAJOAE8Ap4BT4D/gBHACeAqcAE6BE+AUcAI4AU4BJ4AT4BRwAjgBnAKeAE6AU+AEcAI4BU4AJ8Ap4ARwApwCTgAnwCngBHACnAJOACfAKeAEcAKcAk7+B/4AW+8aHrwHAAAAAElFTkSuQmCC';

// Simple 128x128 PNG icon (base64)
const ICON_128_BASE64 = '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';

interface ExtensionDownloaderProps {
  className?: string;
}

export function ExtensionDownloader({ className }: ExtensionDownloaderProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generateAndDownloadZip = async () => {
    setIsGenerating(true);
    
    try {
      const zip = new JSZip();
      
      // Add text files
      zip.file('manifest.json', MANIFEST_JSON);
      zip.file('popup.html', POPUP_HTML);
      zip.file('popup.js', POPUP_JS);
      zip.file('content.js', CONTENT_JS);
      
      // Add icon files (decode base64)
      zip.file('icon16.png', ICON_16_BASE64, { base64: true });
      zip.file('icon48.png', ICON_48_BASE64, { base64: true });
      zip.file('icon128.png', ICON_128_BASE64, { base64: true });
      
      // Generate the zip
      const content = await zip.generateAsync({ type: 'blob' });
      
      // Download it
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tiktok-extractor.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating extension zip:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      onClick={generateAndDownloadZip}
      disabled={isGenerating}
      className={className}
      size="sm"
    >
      {isGenerating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
      ) : (
        <Download className="h-3.5 w-3.5 mr-1.5" />
      )}
      Baixar Extensão
    </Button>
  );
}
