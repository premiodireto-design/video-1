// Content script for TikTok Analyser Pro
// Runs on TikTok pages to filter/sort videos directly on the page

console.log('[TikTok Analyser] Content script loaded v2');

let toolbarVisible = false;
let toolbarElement = null;
let extractedVideos = [];
let videoElementsMap = new Map(); // Map video ID -> DOM element
let isExtracting = false;
let extractionAborted = false;
let currentSort = { field: 'views', order: 'desc' };
let currentFilters = {
  search: '',
  minViews: 0,
  maxViews: Infinity,
  minLikes: 0,
  maxLikes: Infinity,
  minComments: 0,
  maxComments: Infinity
};
let selectedVideoIds = new Set();

// Stats cache (TikTok profile grid often doesn't show likes/comments; we fetch via internal API)
const tatStatsCache = new Map(); // id -> {likes, comments, shares}
const tatStatsLoading = new Set();

// Download URL cache (prefer internal CDN links like v16m-*.tiktokcdn.com)
const tatDownloadUrlCache = new Map(); // id -> downloadUrl
const tatDownloadUrlLoading = new Set();

let tatApplyScheduled = false;

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[TikTok Analyser] Message received:', request.action);
  
  switch (request.action) {
    case 'ping':
      sendResponse({ status: 'ok' });
      break;
    case 'openPanel':
      toggleToolbar();
      sendResponse({ success: true });
      break;
    case 'quickExtract':
      quickExtract().then(result => sendResponse(result));
      return true;
    case 'getVideos':
      sendResponse({ videos: extractedVideos });
      break;
  }
  return true;
});

// Quick extract without UI
async function quickExtract() {
  const videos = await extractVideosFromPage();
  return {
    username: getUsername(),
    timestamp: new Date().toISOString(),
    videos: videos
  };
}

// Get current username from URL
function getUsername() {
  const match = window.location.pathname.match(/\/@([^/?]+)/);
  return match ? match[1] : null;
}

// Parse count strings like "1.2M" to numbers
function parseCount(str) {
  if (!str) return 0;
  const cleaned = str.trim().toLowerCase().replace(/,/g, '.');
  const match = cleaned.match(/([\d.]+)\s*([kmb])?/);
  if (!match) return parseInt(str.replace(/\D/g, '')) || 0;
  
  let num = parseFloat(match[1]);
  const suffix = match[2];
  
  if (suffix === 'k') num *= 1000;
  else if (suffix === 'm') num *= 1000000;
  else if (suffix === 'b') num *= 1000000000;
  
  return Math.floor(num);
}

// Format number for display
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Extract videos and map to DOM elements
async function extractVideosFromPage() {
  const videos = [];
  const seenIds = new Set();
  videoElementsMap.clear();
  
  // Get the video grid container
  const videoContainers = document.querySelectorAll('[data-e2e="user-post-item-list"]');
  const userPostItems = document.querySelectorAll('[data-e2e="user-post-item"]');
  
  // Also try other selectors
  const allVideoCards = document.querySelectorAll('[data-e2e="user-post-item"], [class*="DivItemContainerV2"], [class*="DivItemContainer"]:not([class*="ItemContainerV2"])');
  
  console.log('[TikTok Analyser] Found video cards:', allVideoCards.length);
  
  // Try to get data from embedded JSON first
  let jsonData = {};
  try {
    const scripts = document.querySelectorAll('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent);
      const defaultScope = data?.['__DEFAULT_SCOPE__'];
      const userDetail = defaultScope?.['webapp.user-detail'];
      const itemList = userDetail?.itemList || [];
      
      for (const item of itemList) {
        const stats = item.stats || item.statsV2 || {};
        jsonData[item.id] = {
          views: parseInt(stats.playCount || stats.viewCount || 0),
          likes: parseInt(stats.diggCount || stats.likeCount || 0),
          comments: parseInt(stats.commentCount || 0),
          shares: parseInt(stats.shareCount || 0),
          description: item.desc || '',
          createTime: item.createTime ? new Date(item.createTime * 1000).toISOString() : null,
          downloadUrl: item.video?.playAddr || item.video?.downloadAddr || null,
          thumbnail: item.video?.cover || item.video?.dynamicCover || ''
        };
      }
    }
  } catch (e) {
    console.log('[TikTok Analyser] JSON extraction failed:', e);
  }
  
  // Also try SIGI_STATE
  try {
    const scripts = document.querySelectorAll('script#SIGI_STATE');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent);
      const itemModule = data?.ItemModule || {};
      
      for (const key of Object.keys(itemModule)) {
        const item = itemModule[key];
        if (item && item.id) {
          const stats = item.stats || item.statsV2 || {};
          jsonData[item.id] = {
            views: parseInt(stats.playCount || stats.viewCount || 0),
            likes: parseInt(stats.diggCount || stats.likeCount || 0),
            comments: parseInt(stats.commentCount || 0),
            shares: parseInt(stats.shareCount || 0),
            description: item.desc || '',
            createTime: item.createTime ? new Date(item.createTime * 1000).toISOString() : null,
            downloadUrl: item.video?.playAddr || null,
            thumbnail: item.video?.cover || ''
          };
        }
      }
    }
  } catch (e) {
    console.log('[TikTok Analyser] SIGI extraction failed:', e);
  }
  
  // Now process DOM elements
  for (const el of allVideoCards) {
    const link = el.querySelector('a[href*="/video/"]');
    if (!link) continue;
    
    const videoId = link.href.match(/\/video\/(\d+)/)?.[1];
    if (!videoId || seenIds.has(videoId)) continue;
    
    seenIds.add(videoId);
    videoElementsMap.set(videoId, el);
    
    // Try to get metrics from DOM
    const viewsEl = el.querySelector('[data-e2e="video-views"], [class*="video-count"], strong');
    const img = el.querySelector('img');
    
    // Get data from JSON if available, otherwise from DOM
    const jsonInfo = jsonData[videoId] || {};
    
    videos.push({
      id: videoId,
      url: link.href,
      thumbnail: jsonInfo.thumbnail || img?.src || '',
      views: typeof jsonInfo.views === 'number' ? jsonInfo.views : parseCount(viewsEl?.textContent || '0'),
      likes: typeof jsonInfo.likes === 'number' ? jsonInfo.likes : null,
      comments: typeof jsonInfo.comments === 'number' ? jsonInfo.comments : null,
      shares: typeof jsonInfo.shares === 'number' ? jsonInfo.shares : 0,
      description: jsonInfo.description || '',
      createTime: jsonInfo.createTime || null,
      downloadUrl: jsonInfo.downloadUrl || null,
      author: getUsername(),
      element: el
    });
  }
  
  console.log('[TikTok Analyser] Extracted videos:', videos.length);
  return videos;
}

// Toggle toolbar
function toggleToolbar() {
  if (toolbarVisible) {
    closeToolbar();
  } else {
    openToolbar();
  }
}

// Create toolbar HTML
function createToolbarHTML() {
  return `
    <style>
      #tiktok-analyser-toolbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #fff;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        padding: 0;
      }
      
      .tat-main {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        flex-wrap: wrap;
      }
      
      .tat-logo {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 14px;
        color: #25f4ee;
      }
      
      .tat-stats {
        display: flex;
        gap: 16px;
        font-size: 12px;
        color: rgba(255,255,255,0.7);
        margin-left: auto;
      }
      
      .tat-stat {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      
      .tat-stat-value {
        color: #25f4ee;
        font-weight: 600;
      }
      
      .tat-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 8px 16px 12px;
        border-top: 1px solid rgba(255,255,255,0.1);
        background: rgba(0,0,0,0.2);
      }
      
      .tat-group {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background: rgba(255,255,255,0.05);
        border-radius: 6px;
      }
      
      .tat-label {
        font-size: 10px;
        color: rgba(255,255,255,0.5);
        text-transform: uppercase;
        white-space: nowrap;
      }
      
      .tat-input {
        padding: 4px 8px;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px;
        background: rgba(0,0,0,0.3);
        color: #fff;
        font-size: 11px;
        width: 70px;
      }
      
      .tat-input::placeholder { color: rgba(255,255,255,0.3); }
      .tat-input:focus { outline: none; border-color: #25f4ee; }
      
      .tat-btn {
        padding: 6px 10px;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px;
        background: transparent;
        color: rgba(255,255,255,0.8);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }
      
      .tat-btn:hover { background: rgba(255,255,255,0.1); }
      
      .tat-btn.active {
        background: rgba(37, 244, 238, 0.2);
        color: #25f4ee;
        border-color: #25f4ee;
      }
      
      .tat-btn-primary {
        background: linear-gradient(135deg, #fe2c55 0%, #ff6b6b 100%);
        border: none;
        color: #fff;
        font-weight: 500;
      }
      
      .tat-btn-primary:hover { opacity: 0.9; }
      
      .tat-btn-success {
        background: linear-gradient(135deg, #22c55e 0%, #4ade80 100%);
        border: none;
        color: #fff;
      }
      
      .tat-close {
        background: none;
        border: none;
        color: rgba(255,255,255,0.6);
        font-size: 18px;
        cursor: pointer;
        padding: 4px 8px;
      }
      
      .tat-close:hover { color: #fff; }
      
      .tat-progress {
        display: none;
        padding: 8px 16px;
        background: rgba(37, 244, 238, 0.1);
      }
      
      .tat-progress.active { display: block; }
      
      .tat-progress-bar {
        height: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        overflow: hidden;
        margin-bottom: 4px;
      }
      
      .tat-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #25f4ee 0%, #fe2c55 100%);
        width: 0%;
        transition: width 0.3s;
      }
      
      .tat-progress-text {
        font-size: 11px;
        color: rgba(255,255,255,0.6);
      }
      
      /* Download Modal */
      .tat-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.85);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 9999999;
      }
      
      .tat-modal.active { display: flex; }
      
      .tat-modal-content {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        padding: 24px;
        border-radius: 12px;
        max-width: 450px;
        width: 90%;
        border: 1px solid rgba(255,255,255,0.1);
      }
      
      .tat-modal-title {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .tat-modal-progress {
        height: 8px;
        background: rgba(255,255,255,0.1);
        border-radius: 4px;
        margin-bottom: 12px;
        overflow: hidden;
      }
      
      .tat-modal-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #25f4ee 0%, #fe2c55 100%);
        width: 0%;
        transition: width 0.3s;
      }
      
      .tat-modal-text {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        margin-bottom: 8px;
      }
      
      .tat-modal-log {
        max-height: 150px;
        overflow-y: auto;
        background: rgba(0,0,0,0.3);
        padding: 10px;
        border-radius: 6px;
        font-size: 11px;
        color: rgba(255,255,255,0.5);
        margin-bottom: 16px;
        font-family: monospace;
      }
      
      .tat-modal-log-item { margin-bottom: 4px; }
      .tat-modal-log-item.success { color: #4ade80; }
      .tat-modal-log-item.error { color: #f87171; }
      
      .tat-modal-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      
      /* Body offset when toolbar is visible */
      body.tat-toolbar-active {
        margin-top: 100px !important;
        margin-right: 340px !important;
      }
      /* Video card selection overlay */
      .tat-video-selected {
        position: relative;
      }
      
      .tat-video-selected::before {
        content: '✓';
        position: absolute;
        top: 8px;
        left: 8px;
        width: 24px;
        height: 24px;
        background: #25f4ee;
        color: #000;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        z-index: 10;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      
      .tat-video-selected::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        border: 3px solid #25f4ee;
        border-radius: 8px;
        pointer-events: none;
        z-index: 9;
      }
      
      /* Hidden videos */
      .tat-video-hidden {
        display: none !important;
      }

      /* Sidebar */
      .tat-sidebar {
        position: fixed;
        top: 110px;
        right: 0;
        width: 340px;
        height: calc(100vh - 110px);
        background: linear-gradient(135deg, #111827 0%, #0b1220 100%);
        border-left: 1px solid rgba(255,255,255,0.08);
        z-index: 999998;
        display: flex;
        flex-direction: column;
      }

      .tat-side-header {
        padding: 12px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: rgba(0,0,0,0.2);
      }

      .tat-side-titlebar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .tat-side-titletext {
        font-weight: 700;
        font-size: 13px;
        color: #fff;
      }

      .tat-side-subtitle {
        font-size: 11px;
        color: rgba(255,255,255,0.65);
        margin-top: 2px;
      }

      .tat-side-hint {
        margin-top: 8px;
        font-size: 11px;
        color: rgba(255,255,255,0.55);
      }

      .tat-side-list {
        overflow: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .tat-side-row {
        display: grid;
        grid-template-columns: 24px 1fr auto;
        gap: 10px;
        align-items: center;
        padding: 10px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.04);
      }

      .tat-side-row:hover {
        background: rgba(255,255,255,0.06);
      }

      .tat-side-title {
        font-size: 11px;
        color: rgba(255,255,255,0.9);
        font-weight: 600;
        margin-bottom: 2px;
      }

      .tat-side-stats {
        font-size: 11px;
        color: rgba(255,255,255,0.65);
      }

      .tat-side-check input {
        width: 16px;
        height: 16px;
      }

      .tat-side-jump {
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.15);
        background: rgba(0,0,0,0.25);
        color: rgba(255,255,255,0.85);
        font-size: 11px;
        cursor: pointer;
      }

      .tat-side-jump:hover {
        background: rgba(255,255,255,0.08);
      }

      .tat-side-empty {
        padding: 16px;
        text-align: center;
        font-size: 12px;
        color: rgba(255,255,255,0.65);
      }

      .tat-side-footer {
        padding: 12px;
        border-top: 1px solid rgba(255,255,255,0.08);
        background: rgba(0,0,0,0.22);
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .tat-side-footer .tat-btn {
        width: 100%;
        justify-content: center;
      }

      /* Make room for sidebar */
      body.tat-toolbar-active {
        margin-top: 100px !important;
        margin-right: 340px !important;
      }
    </style>
    
    <div class="tat-main">
      <div class="tat-logo">
        📊 TikTok Analyser Pro
      </div>
      <span style="font-size: 11px; color: rgba(255,255,255,0.4)">@${getUsername() || 'unknown'}</span>
      
      <div class="tat-stats">
        <div class="tat-stat">
          🎬 <span class="tat-stat-value" id="tat-total">0</span> vídeos
        </div>
        <div class="tat-stat">
          🎯 <span class="tat-stat-value" id="tat-visible">0</span> visíveis
        </div>
        <div class="tat-stat">
          ☑️ <span class="tat-stat-value" id="tat-selected">0</span> selecionados
        </div>
      </div>
      
      <button class="tat-close" id="tat-close">✕</button>
    </div>
    
    <div class="tat-progress" id="tat-progress">
      <div class="tat-progress-bar">
        <div class="tat-progress-fill" id="tat-progress-fill"></div>
      </div>
      <div class="tat-progress-text" id="tat-progress-text">Carregando...</div>
    </div>
    
    <div class="tat-controls">
      <!-- Sort -->
      <div class="tat-group">
        <span class="tat-label">Ordenar:</span>
        <button class="tat-btn active" data-sort="views">👀 Views</button>
        <button class="tat-btn" data-sort="likes">❤️ Likes</button>
        <button class="tat-btn" data-sort="comments">💬 Coment.</button>
        <button class="tat-btn" data-sort="date">📅 Data</button>
        <button class="tat-btn" id="tat-order" title="Alternar ordem">⬇️ Maior → menor</button>
      </div>

      <!-- Filters -->
      <div class="tat-group">
        <span class="tat-label">Views:</span>
        <input type="number" class="tat-input" id="f-min-views" placeholder="Min">
        <span>-</span>
        <input type="number" class="tat-input" id="f-max-views" placeholder="Max">
      </div>

      <div class="tat-group">
        <span class="tat-label">Likes:</span>
        <input type="number" class="tat-input" id="f-min-likes" placeholder="Min">
        <span>-</span>
        <input type="number" class="tat-input" id="f-max-likes" placeholder="Max">
      </div>

      <div class="tat-group">
        <span class="tat-label">Coment.:</span>
        <input type="number" class="tat-input" id="f-min-comments" placeholder="Min">
        <span>-</span>
        <input type="number" class="tat-input" id="f-max-comments" placeholder="Max">
      </div>

      <button class="tat-btn" id="tat-apply-filter">✅ Aplicar</button>
      <button class="tat-btn" id="tat-clear-filter">❌ Limpar</button>

      <!-- Actions -->
      <div class="tat-group" style="margin-left: auto;">
        <button class="tat-btn tat-btn-success" id="tat-load-all">🔄 Carregar TODOS</button>
        <button class="tat-btn" id="tat-select-visible">☑️ Sel. Lista</button>
        <button class="tat-btn" id="tat-clear-selection">✖️ Limpar Sel.</button>
      </div>

      <div class="tat-group">
        <button class="tat-btn tat-btn-primary" id="tat-download-zip" disabled>📥 Baixar ZIP</button>
        <button class="tat-btn" id="tat-export-csv">📋 CSV</button>
      </div>
    </div>

    <!-- Sidebar list (reliable ordering) -->
    <div class="tat-sidebar" id="tat-sidebar">
      <div class="tat-side-header">
        <div class="tat-side-titlebar">
          <div>
            <div class="tat-side-titletext">Lista (ordem do filtro)</div>
            <div class="tat-side-subtitle" id="tat-sidebar-subtitle">Ordenação: Views • Maior → menor</div>
          </div>
        </div>
        <div class="tat-side-hint">Marque os itens aqui e baixe em ZIP (sem abrir abas).</div>
      </div>
      <div class="tat-side-list" id="tat-sidebar-list"></div>
      <div class="tat-side-footer">
        <button class="tat-btn tat-btn-primary" id="tat-side-download-zip" disabled>📥 Baixar ZIP</button>
        <button class="tat-btn" id="tat-side-export-csv">📋 CSV</button>
      </div>
    </div>

    <!-- Download Modal -->
    <div class="tat-modal" id="tat-modal">
      <div class="tat-modal-content">
        <div class="tat-modal-title">📥 Baixando Vídeos</div>
        <div class="tat-modal-progress">
          <div class="tat-modal-progress-fill" id="tat-dl-progress"></div>
        </div>
        <div class="tat-modal-text" id="tat-dl-text">Preparando...</div>
        <div class="tat-modal-log" id="tat-dl-log"></div>
        <div class="tat-modal-actions">
          <button class="tat-btn" id="tat-dl-cancel">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

// Open toolbar
function openToolbar() {
  if (toolbarElement) {
    toolbarElement.remove();
  }
  
  toolbarElement = document.createElement('div');
  toolbarElement.id = 'tiktok-analyser-toolbar';
  toolbarElement.innerHTML = createToolbarHTML();
  document.body.insertBefore(toolbarElement, document.body.firstChild);
  document.body.classList.add('tat-toolbar-active');
  
  setupToolbarEvents();
  toolbarVisible = true;
  
  // Start extraction
  startExtraction();
}

// Close toolbar
function closeToolbar() {
  if (toolbarElement) {
    toolbarElement.remove();
    toolbarElement = null;
  }
  document.body.classList.remove('tat-toolbar-active');
  
  // Remove selection from video cards
  document.querySelectorAll('.tat-video-selected, .tat-video-hidden').forEach(el => {
    el.classList.remove('tat-video-selected', 'tat-video-hidden');
  });
  
  toolbarVisible = false;
  extractionAborted = true;
  selectedVideoIds.clear();
}

// Setup events
function setupToolbarEvents() {
  const toolbar = toolbarElement;
  
  // Close
  toolbar.querySelector('#tat-close').addEventListener('click', closeToolbar);
  
  // Sort buttons
  toolbar.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      toolbar.querySelectorAll('[data-sort]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSort.field = btn.dataset.sort;
      applyFiltersAndSort();
    });
  });
  
  // Order toggle
  toolbar.querySelector('#tat-order').addEventListener('click', (e) => {
    currentSort.order = currentSort.order === 'desc' ? 'asc' : 'desc';
    e.target.textContent = currentSort.order === 'desc' ? '⬇️ Maior → menor' : '⬆️ Menor → maior';
    applyFiltersAndSort();
  });
  
  // Apply filter
  toolbar.querySelector('#tat-apply-filter').addEventListener('click', () => {
    readFiltersFromInputs();
    applyFiltersAndSort();
  });
  
  // Clear filter
  toolbar.querySelector('#tat-clear-filter').addEventListener('click', () => {
    currentFilters = {
      search: '',
      minViews: 0,
      maxViews: Infinity,
      minLikes: 0,
      maxLikes: Infinity,
      minComments: 0,
      maxComments: Infinity
    };
    toolbar.querySelectorAll('.tat-input').forEach(input => input.value = '');
    applyFiltersAndSort();
  });
  
  // Enter key on inputs
  toolbar.querySelectorAll('.tat-input').forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        readFiltersFromInputs();
        applyFiltersAndSort();
      }
    });
  });
  
  // Load all
  toolbar.querySelector('#tat-load-all').addEventListener('click', loadAllVideos);
  
  // Select visible
  toolbar.querySelector('#tat-select-visible').addEventListener('click', selectVisibleVideos);
  
  // Clear selection
  toolbar.querySelector('#tat-clear-selection').addEventListener('click', clearSelection);
  
  // Download ZIP
  toolbar.querySelector('#tat-download-zip').addEventListener('click', downloadVideosAsZip);
  toolbar.querySelector('#tat-side-download-zip')?.addEventListener('click', downloadVideosAsZip);
  
  // Export CSV
  toolbar.querySelector('#tat-export-csv').addEventListener('click', exportCSV);
  toolbar.querySelector('#tat-side-export-csv')?.addEventListener('click', exportCSV);
  
  // Modal cancel
  toolbar.querySelector('#tat-dl-cancel').addEventListener('click', () => {
    extractionAborted = true;
    toolbar.querySelector('#tat-modal').classList.remove('active');
  });
}

// Read filters from inputs
function readFiltersFromInputs() {
  const toolbar = toolbarElement;
  
  const minViews = toolbar.querySelector('#f-min-views').value;
  const maxViews = toolbar.querySelector('#f-max-views').value;
  const minLikes = toolbar.querySelector('#f-min-likes').value;
  const maxLikes = toolbar.querySelector('#f-max-likes').value;
  const minComments = toolbar.querySelector('#f-min-comments').value;
  const maxComments = toolbar.querySelector('#f-max-comments').value;
  
  currentFilters.minViews = minViews ? parseInt(minViews) : 0;
  currentFilters.maxViews = maxViews ? parseInt(maxViews) : Infinity;
  currentFilters.minLikes = minLikes ? parseInt(minLikes) : 0;
  currentFilters.maxLikes = maxLikes ? parseInt(maxLikes) : Infinity;
  currentFilters.minComments = minComments ? parseInt(minComments) : 0;
  currentFilters.maxComments = maxComments ? parseInt(maxComments) : Infinity;
}

// Apply filters and sort
// IMPORTANT: We no longer try to physically reorder TikTok's grid DOM (it can break / virtualize / hide items).
// Instead, we (1) hide non-matching items and (2) render a reliable ordered list in our sidebar.
function applyFiltersAndSort() {
  // If user is sorting/filtering by likes/comments, ensure we have stats (async)
  const needExtraStats =
    currentSort.field === 'likes' ||
    currentSort.field === 'comments' ||
    currentFilters.minLikes > 0 ||
    Number.isFinite(currentFilters.maxLikes) ||
    currentFilters.minComments > 0 ||
    Number.isFinite(currentFilters.maxComments);

  if (needExtraStats) {
    // Fire-and-forget; will re-run apply once stats arrive
    ensureStatsForVideos(extractedVideos);
  }

  const valueForFilter = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

  const valueForSort = (v) => {
    switch (currentSort.field) {
      case 'views':
        return valueForFilter(v.views);
      case 'likes':
        // likes can be unknown (null) until we fetch; keep them at the end instead of "0" misleading ordering
        return typeof v.likes === 'number' && Number.isFinite(v.likes) ? v.likes : -1;
      case 'comments':
        return typeof v.comments === 'number' && Number.isFinite(v.comments) ? v.comments : -1;
      case 'date':
        return v.createTime ? new Date(v.createTime).getTime() : 0;
      default:
        return 0;
    }
  };

  // Filter videos
  const filtered = extractedVideos.filter((v) => {
    const views = valueForFilter(v.views);
    const likes = valueForFilter(v.likes);
    const comments = valueForFilter(v.comments);

    if (views < currentFilters.minViews) return false;
    if (views > currentFilters.maxViews) return false;
    if (likes < currentFilters.minLikes) return false;
    if (likes > currentFilters.maxLikes) return false;
    if (comments < currentFilters.minComments) return false;
    if (comments > currentFilters.maxComments) return false;
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    const valA = valueForSort(a);
    const valB = valueForSort(b);
    return currentSort.order === 'desc' ? valB - valA : valA - valB;
  });

  // Update visibility + selection classes in TikTok grid (no reordering)
  const filteredIds = new Set(filtered.map((v) => v.id));
  extractedVideos.forEach((v) => {
    const el = videoElementsMap.get(v.id);
    if (!el) return;

    el.classList.toggle('tat-video-hidden', !filteredIds.has(v.id));

    if (selectedVideoIds.has(v.id)) el.classList.add('tat-video-selected');
    else el.classList.remove('tat-video-selected');
  });

  // Setup click handlers for grid selection (optional)
  extractedVideos.forEach((video) => {
    const el = videoElementsMap.get(video.id);
    if (el && !el.hasAttribute('data-tat-click')) {
      el.setAttribute('data-tat-click', 'true');
      el.style.cursor = 'pointer';
      el.style.position = 'relative';

      el.addEventListener('click', (e) => {
        // Don't interfere with links
        if (e.target.tagName === 'A' || e.target.closest('a')) return;

        e.preventDefault();
        e.stopPropagation();

        if (selectedVideoIds.has(video.id)) {
          selectedVideoIds.delete(video.id);
          el.classList.remove('tat-video-selected');
        } else {
          selectedVideoIds.add(video.id);
          el.classList.add('tat-video-selected');
        }

        updateStats();
        renderSidebarList(filtered);
      });
    }
  });

  // Store filtered for export / download ordering
  window._tatFilteredVideos = filtered;

  updateStats();

  // Render sidebar in the correct order (this is the "truth" of ordering)
  renderSidebarList(filtered);
}

function sortLabel() {
  const fieldLabel =
    currentSort.field === 'views'
      ? 'Views'
      : currentSort.field === 'likes'
        ? 'Likes'
        : currentSort.field === 'comments'
          ? 'Comentários'
          : 'Data';
  const orderLabel = currentSort.order === 'desc' ? 'Maior → menor' : 'Menor → maior';
  return `${fieldLabel} • ${orderLabel}`;
}

function renderSidebarList(videosInOrder) {
  if (!toolbarElement) return;

  const sidebar = toolbarElement.querySelector('#tat-sidebar');
  const list = toolbarElement.querySelector('#tat-sidebar-list');
  const subtitle = toolbarElement.querySelector('#tat-sidebar-subtitle');

  if (!sidebar || !list || !subtitle) return;

  subtitle.textContent = `Ordenação: ${sortLabel()}`;

  const rows = videosInOrder
    .slice(0, 5000) // safety
    .map((v, idx) => {
      const views = typeof v.views === 'number' ? v.views : 0;
      const likesRaw = v.likes;
      const commentsRaw = v.comments;
      const likes = typeof likesRaw === 'number' ? formatNumber(likesRaw) : '…';
      const comments = typeof commentsRaw === 'number' ? formatNumber(commentsRaw) : '…';
      const isChecked = selectedVideoIds.has(v.id);

      return `
        <div class="tat-side-row" data-id="${v.id}">
          <label class="tat-side-check">
            <input type="checkbox" class="tat-side-cb" data-id="${v.id}" ${isChecked ? 'checked' : ''} />
          </label>
          <div class="tat-side-meta">
            <div class="tat-side-title">#${idx + 1} • ${v.id}</div>
            <div class="tat-side-stats">👀 ${formatNumber(views)}  ❤️ ${likes}  💬 ${comments}</div>
          </div>
          <button class="tat-side-jump" data-id="${v.id}">Ir</button>
        </div>
      `;
    })
    .join('');

  list.innerHTML = rows || `<div class="tat-side-empty">Nada encontrado com esses filtros.</div>`;

  // Event delegation (bind once)
  if (!sidebar.hasAttribute('data-tat-bound')) {
    sidebar.setAttribute('data-tat-bound', 'true');

    sidebar.addEventListener('click', (e) => {
      const target = e.target;
      const id = target?.getAttribute?.('data-id') || target?.closest?.('[data-id]')?.getAttribute?.('data-id');
      if (!id) return;

      // Jump button
      if (target.classList?.contains('tat-side-jump')) {
        const el = videoElementsMap.get(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('tat-video-selected');
          setTimeout(() => el.classList.remove('tat-video-selected'), 800);
        }
      }
    });

    sidebar.addEventListener('change', (e) => {
      const target = e.target;
      if (!target.classList?.contains('tat-side-cb')) return;

      const id = target.getAttribute('data-id');
      if (!id) return;

      if (target.checked) selectedVideoIds.add(id);
      else selectedVideoIds.delete(id);

      const el = videoElementsMap.get(id);
      if (el) el.classList.toggle('tat-video-selected', target.checked);

      updateStats();
    });
  }
}

function scheduleApplyFiltersAndSort() {
  if (tatApplyScheduled) return;
  tatApplyScheduled = true;
  setTimeout(() => {
    tatApplyScheduled = false;
    applyFiltersAndSort();
  }, 250);
}

async function fetchTikTokItemStats(videoId) {
  if (!videoId) return null;
  if (tatStatsCache.has(videoId)) return tatStatsCache.get(videoId);
  if (tatStatsLoading.has(videoId)) return null;

  tatStatsLoading.add(videoId);

  try {
    const url = `https://www.tiktok.com/api/item/detail/?aid=1988&itemId=${encodeURIComponent(videoId)}`;
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const item = data?.itemInfo?.itemStruct;
    const stats = item?.stats || item?.statsV2;

    if (!stats) return null;

    const result = {
      likes: parseInt(stats.diggCount || stats.likeCount || 0),
      comments: parseInt(stats.commentCount || 0),
      shares: parseInt(stats.shareCount || 0),
    };

    // Also opportunistically cache the internal CDN download url if present
    const playAddr = item?.video?.playAddr || item?.video?.downloadAddr || null;
    if (typeof playAddr === 'string' && playAddr.includes('tiktokcdn.com')) {
      tatDownloadUrlCache.set(videoId, playAddr);
    }

    tatStatsCache.set(videoId, result);
    return result;
  } catch (e) {
    // Ignore (blocked / rate-limited)
    return null;
  } finally {
    tatStatsLoading.delete(videoId);
  }
}

async function fetchTikTokItemDownloadUrl(videoId) {
  if (!videoId) return null;
  if (tatDownloadUrlCache.has(videoId)) return tatDownloadUrlCache.get(videoId);
  if (tatDownloadUrlLoading.has(videoId)) return null;

  tatDownloadUrlLoading.add(videoId);

  try {
    const url = `https://www.tiktok.com/api/item/detail/?aid=1988&itemId=${encodeURIComponent(videoId)}`;
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const item = data?.itemInfo?.itemStruct;
    const playAddr = item?.video?.playAddr || item?.video?.downloadAddr || null;

    if (typeof playAddr === 'string' && playAddr.includes('tiktokcdn.com')) {
      tatDownloadUrlCache.set(videoId, playAddr);
      return playAddr;
    }

    return null;
  } catch (e) {
    return null;
  } finally {
    tatDownloadUrlLoading.delete(videoId);
  }
}

async function ensureDownloadUrlsForVideos(videos) {
  // Fill missing CDN URLs in a controlled way
  const missing = (videos || [])
    .filter((v) => v && v.id && (!v.downloadUrl || !String(v.downloadUrl).includes('tiktokcdn.com')))
    .slice(0, 120);

  if (missing.length === 0) return;

  const concurrency = 4;
  let idx = 0;

  const worker = async () => {
    while (idx < missing.length) {
      const i = idx++;
      const v = missing[i];
      const dl = await fetchTikTokItemDownloadUrl(v.id);
      if (dl) v.downloadUrl = dl;
      await sleep(120);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function ensureStatsForVideos(videos) {
  // Fetch missing stats for videos that matter.
  // We treat likes/comments as "unknown" when null/undefined.
  const missing = videos
    .filter((v) => v && v.id && (!tatStatsCache.has(v.id)) && (v.likes == null || v.comments == null))
    .slice(0, 200); // slightly higher cap to make sorting actually respond

  if (missing.length === 0) return;

  // Concurrency = 6 (a bit faster, still polite)
  const concurrency = 6;
  let idx = 0;

  const worker = async () => {
    while (idx < missing.length) {
      const i = idx++;
      const v = missing[i];
      const stats = await fetchTikTokItemStats(v.id);
      if (stats) {
        v.likes = stats.likes;
        v.comments = stats.comments;
        v.shares = stats.shares;
      } else {
        // Keep likes/comments as "unknown" (null) when blocked; this avoids fake "0" ordering.
        // We'll retry later when the user applies again.
      }
      await sleep(80);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  scheduleApplyFiltersAndSort();
}

// Update stats
function updateStats() {
  if (!toolbarElement) return;
  
  const visibleCount = window._tatFilteredVideos?.length || 0;
  
  toolbarElement.querySelector('#tat-total').textContent = extractedVideos.length;
  toolbarElement.querySelector('#tat-visible').textContent = visibleCount;
  toolbarElement.querySelector('#tat-selected').textContent = selectedVideoIds.size;
  
  const downloadBtn = toolbarElement.querySelector('#tat-download-zip');
  const sideDownloadBtn = toolbarElement.querySelector('#tat-side-download-zip');

  const disabled = selectedVideoIds.size === 0;
  const label = selectedVideoIds.size > 0 ? `📥 Baixar ${selectedVideoIds.size} ZIP` : '📥 Baixar ZIP';

  if (downloadBtn) {
    downloadBtn.disabled = disabled;
    downloadBtn.textContent = label;
  }

  if (sideDownloadBtn) {
    sideDownloadBtn.disabled = disabled;
    sideDownloadBtn.textContent = label;
  }
}

// Start extraction
async function startExtraction() {
  isExtracting = true;
  extractionAborted = false;
  
  showProgress(true);
  updateProgress(20, 'Extraindo vídeos da página...');
  
  extractedVideos = await extractVideosFromPage();
  
  updateProgress(60, `${extractedVideos.length} vídeos encontrados. Scroll inicial...`);
  
  // Initial scroll to load more
  await autoScroll(3);
  
  // Re-extract after scroll
  const moreVideos = await extractVideosFromPage();
  const existingIds = new Set(extractedVideos.map(v => v.id));
  for (const video of moreVideos) {
    if (!existingIds.has(video.id)) {
      extractedVideos.push(video);
    }
  }
  
  // Rebuild map
  for (const v of extractedVideos) {
    if (!videoElementsMap.has(v.id) && v.element) {
      videoElementsMap.set(v.id, v.element);
    }
  }
  
  updateProgress(100, `${extractedVideos.length} vídeos carregados!`);
  await sleep(500);
  showProgress(false);
  
  isExtracting = false;
  applyFiltersAndSort();
}

// Load ALL videos
async function loadAllVideos() {
  if (isExtracting) return;

  isExtracting = true;
  extractionAborted = false;
  showProgress(true);

  const btn = toolbarElement.querySelector('#tat-load-all');
  btn.disabled = true;
  btn.textContent = '⏳ Carregando...';

  let noNewVideosCount = 0;
  let scrollCount = 0;
  const maxNoNewVideos = 5;

  // IMPORTANT: during auto-scroll we DO NOT reorder/hide elements;
  // TikTok's infinite grid can glitch if we mess with DOM while loading.
  while (noNewVideosCount < maxNoNewVideos && !extractionAborted) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(1800);

    const newVideos = await extractVideosFromPage();
    const existingIds = new Set(extractedVideos.map(v => v.id));
    let addedCount = 0;

    for (const video of newVideos) {
      if (!existingIds.has(video.id)) {
        extractedVideos.push(video);
        if (video.element) {
          videoElementsMap.set(video.id, video.element);
        }
        addedCount++;
      }
    }

    scrollCount++;

    if (addedCount === 0) noNewVideosCount++;
    else noNewVideosCount = 0;

    updateProgress(
      Math.min(95, 10 + scrollCount * 4),
      `${extractedVideos.length} vídeos (scroll ${scrollCount})...`
    );
  }

  // Back to top for user convenience
  window.scrollTo(0, 0);

  showProgress(false);
  isExtracting = false;

  btn.disabled = false;
  btn.textContent = '🔄 Carregar TODOS';

  // Now safely apply filters/sort
  applyFiltersAndSort();

  alert(`✅ Carregamento completo!\n${extractedVideos.length} vídeos encontrados.`);
}

// Select visible videos
function selectVisibleVideos() {
  const filtered = window._tatFilteredVideos || [];
  filtered.forEach(v => {
    selectedVideoIds.add(v.id);
    const el = videoElementsMap.get(v.id);
    if (el) el.classList.add('tat-video-selected');
  });
  updateStats();
}

// Clear selection
function clearSelection() {
  selectedVideoIds.clear();
  document.querySelectorAll('.tat-video-selected').forEach(el => {
    el.classList.remove('tat-video-selected');
  });
  updateStats();
}

// Download videos as ZIP
async function downloadVideosAsZip() {
  const selectedVideos = extractedVideos.filter((v) => selectedVideoIds.has(v.id));
  if (selectedVideos.length === 0) return;

  // Load JSZip dynamically if not available
  if (typeof JSZip === 'undefined') {
    const loaded = await loadJSZip();
    if (!loaded) {
      alert('❌ Não foi possível carregar JSZip. Tente novamente.');
      return;
    }
  }

  // Sort by current filter order
  const orderedVideos = (window._tatFilteredVideos || []).filter((v) => selectedVideoIds.has(v.id));

  // Ensure we have internal CDN links (v16m-*.tiktokcdn.com) to download and to keep the exact order
  await ensureDownloadUrlsForVideos(orderedVideos);

  const modal = toolbarElement.querySelector('#tat-modal');
  const progressFill = toolbarElement.querySelector('#tat-dl-progress');
  const progressText = toolbarElement.querySelector('#tat-dl-text');
  const logContainer = toolbarElement.querySelector('#tat-dl-log');

  modal.classList.add('active');
  logContainer.innerHTML = '';
  extractionAborted = false;

  const addLog = (text, type = '') => {
    const item = document.createElement('div');
    item.className = 'tat-modal-log-item ' + type;
    item.textContent = text;
    logContainer.appendChild(item);
    logContainer.scrollTop = logContainer.scrollHeight;
  };

  addLog(`Iniciando download de ${orderedVideos.length} vídeos...`);

  // Create ZIP using JSZip
  const zip = new JSZip();
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < orderedVideos.length; i++) {
    if (extractionAborted) {
      addLog('Download cancelado pelo usuário.', 'error');
      break;
    }

    const video = orderedVideos[i];
    const progress = ((i + 1) / orderedVideos.length) * 100;

    progressFill.style.width = `${progress}%`;
    progressText.textContent = `Baixando ${i + 1} de ${orderedVideos.length}...`;

    try {
      addLog(`[${i + 1}/${orderedVideos.length}] Baixando ${video.id}...`);

      // Prefer internal CDN url (tiktokcdn). Fallback only if necessary.
      const cdnUrl = (video.downloadUrl && String(video.downloadUrl).includes('tiktokcdn.com'))
        ? video.downloadUrl
        : (tatDownloadUrlCache.get(video.id) || null);

      const downloadUrls = [
        cdnUrl,
        video.downloadUrl,
        `https://tikwm.com/video/media/hdplay/${video.id}.mp4`,
        `https://www.tikwm.com/video/media/play/${video.id}.mp4`,
      ].filter(Boolean);

      let blob = null;

      for (const url of downloadUrls) {
        if (extractionAborted) break;

        try {
          const response = await fetch(url, {
            mode: 'cors',
            credentials: url.includes('tiktok.com') ? 'include' : 'omit',
            headers: {
              Accept: 'video/mp4,video/*,*/*',
            },
          });

          if (response.ok) {
            blob = await response.blob();
            if (blob.size > 10000) {
              addLog(`  ✓ Sucesso via ${new URL(url).hostname}`, 'success');
              break;
            }
          }
        } catch (e) {
          console.log('Download attempt failed:', url, e);
        }
      }

      if (blob && blob.size > 10000) {
        // Keep exact sequence from filter ordering
        const filename = `${String(i + 1).padStart(3, '0')}_${video.id}.mp4`;
        zip.file(filename, blob);
        successCount++;
      } else {
        addLog(`  ✗ Falhou - tentando proxy...`, 'error');

        // Try with a CORS proxy as last resort
        try {
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(
            cdnUrl || `https://tikwm.com/video/media/hdplay/${video.id}.mp4`
          )}`;
          const response = await fetch(proxyUrl);
          if (response.ok) {
            blob = await response.blob();
            if (blob.size > 10000) {
              const filename = `${String(i + 1).padStart(3, '0')}_${video.id}.mp4`;
              zip.file(filename, blob);
              successCount++;
              addLog(`  ✓ Sucesso via proxy`, 'success');
            } else {
              failCount++;
            }
          } else {
            failCount++;
          }
        } catch (e) {
          failCount++;
          addLog(`  ✗ Não foi possível baixar`, 'error');
        }
      }
    } catch (e) {
      console.error('Download failed for video:', video.id, e);
      addLog(`  ✗ Erro: ${e.message}`, 'error');
      failCount++;
    }

    // Small delay between downloads
    await sleep(500);
  }

  if (extractionAborted) {
    modal.classList.remove('active');
    return;
  }

  if (successCount > 0) {
    progressText.textContent = 'Gerando arquivo ZIP...';
    addLog(`Compactando ${successCount} vídeos...`);

    try {
      const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        progressFill.style.width = `${metadata.percent}%`;
      });

      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tiktok_${getUsername()}_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addLog(`✅ Download concluído! ${successCount} vídeos no ZIP.`, 'success');
      progressText.textContent = `✅ ${successCount} vídeos baixados!`;
    } catch (e) {
      addLog(`Erro ao gerar ZIP: ${e.message}`, 'error');
    }
  } else {
    progressText.textContent = '❌ Nenhum vídeo baixado';
    addLog('Nenhum vídeo conseguiu ser baixado.', 'error');
    addLog('Pode ser bloqueio temporário do TikTok para downloads.', 'error');
    addLog('Tente novamente após alguns minutos.', 'error');
  }

  if (failCount > 0) {
    addLog(`⚠️ ${failCount} vídeos falharam.`, 'error');
  }
}

// Export CSV
async function exportCSV() {
  const videos = window._tatFilteredVideos || extractedVideos;

  // Ensure CDN links are present for the CSV, in the SAME order as the filter
  await ensureDownloadUrlsForVideos(videos);

  const headers = ['Posição', 'ID', 'URL TikTok', 'Link Interno (CDN)', 'Descrição', 'Views', 'Likes', 'Comentários', 'Data'];

  const rows = videos.map((v, idx) => {
    const cdn = (v.downloadUrl && String(v.downloadUrl).includes('tiktokcdn.com'))
      ? v.downloadUrl
      : (tatDownloadUrlCache.get(v.id) || v.downloadUrl || '');

    return [
      idx + 1,
      v.id,
      v.url,
      cdn,
      `"${(v.description || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      v.views,
      v.likes,
      v.comments,
      v.createTime ? new Date(v.createTime).toLocaleDateString('pt-BR') : '',
    ];
  });

  const csv = '\ufeff' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
  downloadFile(csv, `tiktok_${getUsername()}_${Date.now()}.csv`, 'text/csv;charset=utf-8');
}

// Download file helper
function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Show/hide progress
function showProgress(show) {
  const progress = toolbarElement?.querySelector('#tat-progress');
  if (progress) progress.classList.toggle('active', show);
}

// Update progress
function updateProgress(percent, text) {
  if (!toolbarElement) return;
  toolbarElement.querySelector('#tat-progress-fill').style.width = `${percent}%`;
  toolbarElement.querySelector('#tat-progress-text').textContent = text;
}

// Auto scroll
async function autoScroll(maxScrolls = 5) {
  let scrollCount = 0;
  let lastHeight = document.documentElement.scrollHeight;
  
  while (scrollCount < maxScrolls && !extractionAborted) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(1500);
    
    const newHeight = document.documentElement.scrollHeight;
    if (newHeight === lastHeight) break;
    
    lastHeight = newHeight;
    scrollCount++;
  }
  
  window.scrollTo(0, 0);
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Add floating button
function addFloatingButton() {
  if (document.getElementById('tiktok-analyser-fab')) return;
  
  const fab = document.createElement('button');
  fab.id = 'tiktok-analyser-fab';
  fab.innerHTML = '📊';
  fab.title = 'Abrir TikTok Analyser Pro';
  fab.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 56px;
    height: 56px;
    border-radius: 28px;
    background: linear-gradient(135deg, #fe2c55 0%, #25f4ee 100%);
    border: none;
    cursor: pointer;
    z-index: 999998;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    box-shadow: 0 4px 20px rgba(254, 44, 85, 0.4);
    transition: all 0.3s;
  `;
  
  fab.addEventListener('mouseenter', () => {
    fab.style.transform = 'scale(1.1)';
  });
  
  fab.addEventListener('mouseleave', () => {
    fab.style.transform = 'scale(1)';
  });
  
  fab.addEventListener('click', toggleToolbar);
  document.body.appendChild(fab);
}

// Check if on profile page and add FAB
function checkAndInit() {
  if (window.location.pathname.match(/\/@[^/]+\/?$/)) {
    setTimeout(addFloatingButton, 1000);
  }
}

// Init on load
checkAndInit();

// Watch for navigation
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    checkAndInit();
  }
}).observe(document, { subtree: true, childList: true });

// Load JSZip with LOCAL file first (avoids TikTok CSP + blocked CDNs)
async function loadJSZip() {
  if (typeof JSZip !== 'undefined') return true;

  // 1) Try local packaged JSZip (best, no CSP)
  try {
    const localUrl = chrome.runtime.getURL('vendor/jszip.min.js');
    const res = await fetch(localUrl);
    if (res.ok) {
      const code = await res.text();
      new Function(code)();
      if (typeof JSZip !== 'undefined') return true;
    }
  } catch (e) {
    console.warn('[TikTok Analyser] Failed to load local JSZip', e);
  }

  // 2) Fallback CDNs (may be blocked)
  const cdnUrls = [
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
  ];

  for (const url of cdnUrls) {
    try {
      console.log('[TikTok Analyser] Loading JSZip from:', url);
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) continue;

      const code = await response.text();
      new Function(code)();

      if (typeof JSZip !== 'undefined') {
        console.log('[TikTok Analyser] JSZip loaded successfully');
        return true;
      }
    } catch (e) {
      console.warn('[TikTok Analyser] Failed to load JSZip from:', url, e);
    }
  }

  console.error('[TikTok Analyser] Failed to load JSZip');
  return false;
}

console.log('[TikTok Analyser] Content script initialized v2.1');
