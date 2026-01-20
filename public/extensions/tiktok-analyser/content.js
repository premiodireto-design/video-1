// Content script for TikTok Analyser Pro
// Runs on TikTok pages to extract video data and inject UI

console.log('[TikTok Analyser] Content script loaded');

let panelVisible = false;
let panelElement = null;
let extractedVideos = [];
let filteredVideos = [];
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

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[TikTok Analyser] Message received:', request.action);
  
  switch (request.action) {
    case 'ping':
      sendResponse({ status: 'ok' });
      break;
    case 'openPanel':
      togglePanel();
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

// Extract videos from the page
async function extractVideosFromPage() {
  const videos = [];
  const seenIds = new Set();
  
  // Method 1: Try __UNIVERSAL_DATA_FOR_REHYDRATION__
  try {
    const scripts = document.querySelectorAll('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent);
      const defaultScope = data?.['__DEFAULT_SCOPE__'];
      const userDetail = defaultScope?.['webapp.user-detail'];
      const itemList = userDetail?.itemList || [];
      
      for (const item of itemList) {
        const video = parseVideoItem(item);
        if (video.id && !seenIds.has(video.id)) {
          seenIds.add(video.id);
          videos.push(video);
        }
      }
    }
  } catch (e) {
    console.log('[TikTok Analyser] Method 1 failed:', e);
  }
  
  // Method 2: Try SIGI_STATE
  if (videos.length === 0) {
    try {
      const scripts = document.querySelectorAll('script#SIGI_STATE');
      for (const script of scripts) {
        const data = JSON.parse(script.textContent);
        const itemModule = data?.ItemModule || {};
        
        for (const key of Object.keys(itemModule)) {
          const item = itemModule[key];
          if (item && item.id && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            videos.push(parseVideoItem(item));
          }
        }
      }
    } catch (e) {
      console.log('[TikTok Analyser] Method 2 failed:', e);
    }
  }
  
  // Method 3: DOM fallback
  if (videos.length === 0) {
    const videoElements = document.querySelectorAll('[data-e2e="user-post-item"], [class*="DivItemContainer"]');
    for (const el of videoElements) {
      const link = el.querySelector('a[href*="/video/"]');
      const img = el.querySelector('img');
      const viewsEl = el.querySelector('[data-e2e="video-views"]');
      
      if (link) {
        const videoId = link.href.match(/\/video\/(\d+)/)?.[1];
        if (videoId && !seenIds.has(videoId)) {
          seenIds.add(videoId);
          videos.push({
            id: videoId,
            url: link.href,
            thumbnail: img?.src || '',
            views: parseCount(viewsEl?.textContent || '0'),
            likes: 0,
            comments: 0,
            shares: 0,
            description: '',
            createTime: null,
            downloadUrl: null,
            status: 'unknown'
          });
        }
      }
    }
  }
  
  return videos;
}

// Parse a video item from TikTok's data
function parseVideoItem(item) {
  const stats = item.stats || item.statsV2 || {};
  const videoId = item.id || item.video?.id;
  const author = item.author?.uniqueId || getUsername();
  
  return {
    id: videoId,
    url: `https://www.tiktok.com/@${author}/video/${videoId}`,
    thumbnail: item.video?.cover || item.video?.dynamicCover || item.video?.originCover || '',
    views: parseInt(stats.playCount || stats.viewCount || 0),
    likes: parseInt(stats.diggCount || stats.likeCount || 0),
    comments: parseInt(stats.commentCount || 0),
    shares: parseInt(stats.shareCount || 0),
    description: item.desc || '',
    createTime: item.createTime ? new Date(item.createTime * 1000).toISOString() : null,
    duration: item.video?.duration || 0,
    downloadUrl: item.video?.playAddr || item.video?.downloadAddr || null,
    author: author,
    status: 'available'
  };
}

// Parse count strings like "1.2M" to numbers
function parseCount(str) {
  if (!str) return 0;
  const cleaned = str.trim().toLowerCase();
  const match = cleaned.match(/([\d.]+)([kmb])?/);
  if (!match) return 0;
  
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

// Toggle the floating panel
function togglePanel() {
  if (panelVisible) {
    closePanel();
  } else {
    openPanel();
  }
}

// Open the floating panel
function openPanel() {
  if (panelElement) {
    panelElement.remove();
  }
  
  panelElement = document.createElement('div');
  panelElement.id = 'tiktok-analyser-panel';
  panelElement.innerHTML = createPanelHTML();
  document.body.appendChild(panelElement);
  
  setupPanelEvents();
  panelVisible = true;
  
  // Auto-start extraction
  startExtraction();
}

// Close the panel
function closePanel() {
  if (panelElement) {
    panelElement.remove();
    panelElement = null;
  }
  panelVisible = false;
  extractionAborted = true;
}

// Create panel HTML with advanced filters
function createPanelHTML() {
  return `
    <style>
      #tiktok-analyser-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: 480px;
        height: 100vh;
        background: #0f0f23;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #fff;
        display: flex;
        flex-direction: column;
        box-shadow: -4px 0 20px rgba(0,0,0,0.5);
      }
      
      .tap-header {
        padding: 16px;
        background: linear-gradient(135deg, #1a1a3e 0%, #0f0f23 100%);
        border-bottom: 1px solid rgba(255,255,255,0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      
      .tap-header-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .tap-logo { font-size: 24px; }
      .tap-title { font-size: 16px; font-weight: 600; }
      .tap-username { font-size: 12px; color: #25f4ee; }
      
      .tap-close {
        background: rgba(255,255,255,0.1);
        border: none;
        color: #fff;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 18px;
      }
      
      .tap-close:hover { background: rgba(255,255,255,0.2); }
      
      .tap-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        padding: 12px 16px;
        background: rgba(255,255,255,0.02);
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      
      .tap-stat { text-align: center; }
      
      .tap-stat-value {
        font-size: 18px;
        font-weight: 700;
        background: linear-gradient(135deg, #25f4ee 0%, #fe2c55 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      
      .tap-stat-label {
        font-size: 10px;
        color: rgba(255,255,255,0.5);
        text-transform: uppercase;
      }
      
      .tap-progress {
        padding: 8px 16px;
        background: rgba(37, 244, 238, 0.1);
        border-bottom: 1px solid rgba(255,255,255,0.1);
        display: none;
      }
      
      .tap-progress.active { display: block; }
      
      .tap-progress-bar {
        height: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        overflow: hidden;
        margin-bottom: 4px;
      }
      
      .tap-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #25f4ee 0%, #fe2c55 100%);
        width: 0%;
        transition: width 0.3s;
      }
      
      .tap-progress-text {
        font-size: 11px;
        color: rgba(255,255,255,0.6);
      }
      
      /* Filter Section */
      .tap-filters-section {
        padding: 12px 16px;
        background: rgba(255,255,255,0.02);
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      
      .tap-filters-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      
      .tap-filters-title {
        font-size: 12px;
        font-weight: 600;
        color: rgba(255,255,255,0.8);
      }
      
      .tap-filters-toggle {
        font-size: 11px;
        color: #25f4ee;
        background: none;
        border: none;
        cursor: pointer;
      }
      
      .tap-filters-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      
      .tap-filter-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      
      .tap-filter-label {
        font-size: 10px;
        color: rgba(255,255,255,0.5);
        text-transform: uppercase;
      }
      
      .tap-filter-input {
        padding: 6px 10px;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px;
        background: rgba(255,255,255,0.05);
        color: #fff;
        font-size: 12px;
        width: 100%;
      }
      
      .tap-filter-input::placeholder { color: rgba(255,255,255,0.3); }
      
      .tap-filter-input:focus {
        outline: none;
        border-color: #25f4ee;
      }
      
      /* Sort Section */
      .tap-sort-section {
        padding: 10px 16px;
        display: flex;
        gap: 8px;
        align-items: center;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        flex-wrap: wrap;
      }
      
      .tap-sort-label {
        font-size: 11px;
        color: rgba(255,255,255,0.5);
        margin-right: 4px;
      }
      
      .tap-sort-btn {
        padding: 5px 10px;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px;
        background: transparent;
        color: rgba(255,255,255,0.6);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .tap-sort-btn:hover {
        background: rgba(255,255,255,0.1);
      }
      
      .tap-sort-btn.active {
        background: rgba(37, 244, 238, 0.2);
        color: #25f4ee;
        border-color: #25f4ee;
      }
      
      .tap-order-btn {
        padding: 5px 8px;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px;
        background: transparent;
        color: rgba(255,255,255,0.6);
        font-size: 11px;
        cursor: pointer;
        margin-left: auto;
      }
      
      .tap-order-btn:hover { background: rgba(255,255,255,0.1); }
      
      /* Controls */
      .tap-controls {
        padding: 10px 16px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      
      .tap-btn {
        padding: 7px 12px;
        border: none;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      
      .tap-btn-primary {
        background: linear-gradient(135deg, #fe2c55 0%, #ff6b6b 100%);
        color: #fff;
      }
      
      .tap-btn-secondary {
        background: rgba(255,255,255,0.1);
        color: #fff;
      }
      
      .tap-btn-success {
        background: linear-gradient(135deg, #22c55e 0%, #4ade80 100%);
        color: #fff;
      }
      
      .tap-btn:hover { transform: translateY(-1px); }
      .tap-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
      
      /* Search */
      .tap-search-box {
        padding: 8px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      
      .tap-search {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        background: rgba(255,255,255,0.05);
        color: #fff;
        font-size: 12px;
      }
      
      .tap-search::placeholder { color: rgba(255,255,255,0.4); }
      
      /* Videos List */
      .tap-videos {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }
      
      .tap-video-item {
        display: flex;
        gap: 10px;
        padding: 10px;
        background: rgba(255,255,255,0.03);
        border-radius: 8px;
        margin-bottom: 6px;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
      }
      
      .tap-video-item:hover { background: rgba(255,255,255,0.08); }
      
      .tap-video-item.selected {
        background: rgba(37, 244, 238, 0.15);
        border: 1px solid rgba(37, 244, 238, 0.3);
      }
      
      .tap-video-checkbox {
        position: absolute;
        top: 6px;
        left: 6px;
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 3px;
        background: rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        z-index: 1;
      }
      
      .tap-video-item.selected .tap-video-checkbox {
        background: #25f4ee;
        border-color: #25f4ee;
      }
      
      .tap-video-thumb {
        width: 55px;
        height: 75px;
        border-radius: 6px;
        object-fit: cover;
        background: rgba(255,255,255,0.1);
      }
      
      .tap-video-info { flex: 1; min-width: 0; }
      
      .tap-video-desc {
        font-size: 11px;
        color: rgba(255,255,255,0.9);
        margin-bottom: 6px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      
      .tap-video-metrics {
        display: flex;
        gap: 10px;
        font-size: 10px;
        color: rgba(255,255,255,0.5);
      }
      
      .tap-video-link {
        font-size: 9px;
        color: #25f4ee;
        margin-top: 4px;
        word-break: break-all;
      }
      
      .tap-video-link a {
        color: #25f4ee;
        text-decoration: none;
      }
      
      .tap-video-link a:hover { text-decoration: underline; }
      
      .tap-empty {
        text-align: center;
        padding: 40px;
        color: rgba(255,255,255,0.4);
      }
      
      /* Footer */
      .tap-footer {
        padding: 12px 16px;
        background: rgba(255,255,255,0.02);
        border-top: 1px solid rgba(255,255,255,0.1);
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      
      .tap-footer .tap-btn { flex: 1; justify-content: center; min-width: 100px; }
      
      /* Download Modal */
      .tap-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 9999999;
      }
      
      .tap-modal.active { display: flex; }
      
      .tap-modal-content {
        background: #1a1a3e;
        padding: 24px;
        border-radius: 12px;
        max-width: 400px;
        width: 90%;
      }
      
      .tap-modal-title {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 16px;
      }
      
      .tap-modal-progress {
        height: 6px;
        background: rgba(255,255,255,0.1);
        border-radius: 3px;
        margin-bottom: 12px;
        overflow: hidden;
      }
      
      .tap-modal-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #25f4ee 0%, #fe2c55 100%);
        width: 0%;
        transition: width 0.3s;
      }
      
      .tap-modal-text {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        margin-bottom: 16px;
      }
      
      .tap-modal-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
    </style>
    
    <div class="tap-header">
      <div class="tap-header-left">
        <span class="tap-logo">📊</span>
        <div>
          <div class="tap-title">TikTok Analyser Pro</div>
          <div class="tap-username">@${getUsername() || 'unknown'}</div>
        </div>
      </div>
      <button class="tap-close" id="tap-close">✕</button>
    </div>
    
    <div class="tap-stats">
      <div class="tap-stat">
        <div class="tap-stat-value" id="tap-total-videos">0</div>
        <div class="tap-stat-label">Vídeos</div>
      </div>
      <div class="tap-stat">
        <div class="tap-stat-value" id="tap-filtered-count">0</div>
        <div class="tap-stat-label">Filtrados</div>
      </div>
      <div class="tap-stat">
        <div class="tap-stat-value" id="tap-selected-count">0</div>
        <div class="tap-stat-label">Selecionados</div>
      </div>
      <div class="tap-stat">
        <div class="tap-stat-value" id="tap-total-views">0</div>
        <div class="tap-stat-label">Views</div>
      </div>
    </div>
    
    <div class="tap-progress" id="tap-progress">
      <div class="tap-progress-bar">
        <div class="tap-progress-fill" id="tap-progress-fill"></div>
      </div>
      <div class="tap-progress-text" id="tap-progress-text">Carregando vídeos...</div>
    </div>
    
    <!-- Filters Section -->
    <div class="tap-filters-section">
      <div class="tap-filters-header">
        <span class="tap-filters-title">🎚️ Filtros</span>
        <button class="tap-filters-toggle" id="tap-clear-filters">Limpar</button>
      </div>
      <div class="tap-filters-grid">
        <div class="tap-filter-item">
          <label class="tap-filter-label">Min Views</label>
          <input type="number" class="tap-filter-input" id="filter-min-views" placeholder="0">
        </div>
        <div class="tap-filter-item">
          <label class="tap-filter-label">Max Views</label>
          <input type="number" class="tap-filter-input" id="filter-max-views" placeholder="∞">
        </div>
        <div class="tap-filter-item">
          <label class="tap-filter-label">Min Likes</label>
          <input type="number" class="tap-filter-input" id="filter-min-likes" placeholder="0">
        </div>
        <div class="tap-filter-item">
          <label class="tap-filter-label">Max Likes</label>
          <input type="number" class="tap-filter-input" id="filter-max-likes" placeholder="∞">
        </div>
        <div class="tap-filter-item">
          <label class="tap-filter-label">Min Comentários</label>
          <input type="number" class="tap-filter-input" id="filter-min-comments" placeholder="0">
        </div>
        <div class="tap-filter-item">
          <label class="tap-filter-label">Max Comentários</label>
          <input type="number" class="tap-filter-input" id="filter-max-comments" placeholder="∞">
        </div>
      </div>
    </div>
    
    <!-- Sort Section -->
    <div class="tap-sort-section">
      <span class="tap-sort-label">Ordenar:</span>
      <button class="tap-sort-btn active" data-sort="views">👀 Views</button>
      <button class="tap-sort-btn" data-sort="likes">❤️ Likes</button>
      <button class="tap-sort-btn" data-sort="comments">💬 Comentários</button>
      <button class="tap-sort-btn" data-sort="date">📅 Data</button>
      <button class="tap-order-btn" id="tap-order-toggle">⬇️ Maior → Menor</button>
    </div>
    
    <!-- Controls -->
    <div class="tap-controls">
      <button class="tap-btn tap-btn-success" id="tap-load-all">
        🔄 Carregar TODOS
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-select-all">
        ☑️ Selecionar Todos
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-select-filtered">
        🎯 Selecionar Filtrados
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-clear-selection">
        ✖️ Limpar
      </button>
    </div>
    
    <!-- Search -->
    <div class="tap-search-box">
      <input type="text" class="tap-search" id="tap-search" placeholder="🔍 Buscar por descrição...">
    </div>
    
    <!-- Videos List -->
    <div class="tap-videos" id="tap-videos">
      <div class="tap-empty">
        <p>Carregando vídeos do perfil...</p>
      </div>
    </div>
    
    <!-- Footer -->
    <div class="tap-footer">
      <button class="tap-btn tap-btn-primary" id="tap-download-videos" disabled>
        📥 Baixar Vídeos
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-export-csv">
        📋 Exportar CSV
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-export-json">
        📄 JSON
      </button>
    </div>
    
    <!-- Download Modal -->
    <div class="tap-modal" id="tap-download-modal">
      <div class="tap-modal-content">
        <div class="tap-modal-title">📥 Baixando Vídeos</div>
        <div class="tap-modal-progress">
          <div class="tap-modal-progress-fill" id="tap-dl-progress"></div>
        </div>
        <div class="tap-modal-text" id="tap-dl-text">Preparando...</div>
        <div class="tap-modal-actions">
          <button class="tap-btn tap-btn-secondary" id="tap-dl-cancel">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

// Setup panel event listeners
function setupPanelEvents() {
  const panel = panelElement;
  
  // Close
  panel.querySelector('#tap-close').addEventListener('click', closePanel);
  
  // Load all videos
  panel.querySelector('#tap-load-all').addEventListener('click', loadAllVideos);
  
  // Select all (from original list)
  panel.querySelector('#tap-select-all').addEventListener('click', () => {
    extractedVideos.forEach(v => v.selected = true);
    applyFiltersAndSort();
  });
  
  // Select filtered only
  panel.querySelector('#tap-select-filtered').addEventListener('click', () => {
    extractedVideos.forEach(v => v.selected = false);
    filteredVideos.forEach(v => v.selected = true);
    applyFiltersAndSort();
  });
  
  // Clear selection
  panel.querySelector('#tap-clear-selection').addEventListener('click', () => {
    extractedVideos.forEach(v => v.selected = false);
    applyFiltersAndSort();
  });
  
  // Search
  panel.querySelector('#tap-search').addEventListener('input', (e) => {
    currentFilters.search = e.target.value;
    applyFiltersAndSort();
  });
  
  // Filter inputs
  const filterInputs = [
    { id: 'filter-min-views', key: 'minViews', default: 0 },
    { id: 'filter-max-views', key: 'maxViews', default: Infinity },
    { id: 'filter-min-likes', key: 'minLikes', default: 0 },
    { id: 'filter-max-likes', key: 'maxLikes', default: Infinity },
    { id: 'filter-min-comments', key: 'minComments', default: 0 },
    { id: 'filter-max-comments', key: 'maxComments', default: Infinity }
  ];
  
  filterInputs.forEach(({ id, key, default: def }) => {
    panel.querySelector(`#${id}`).addEventListener('input', (e) => {
      const val = e.target.value.trim();
      currentFilters[key] = val === '' ? def : parseInt(val) || def;
      applyFiltersAndSort();
    });
  });
  
  // Clear filters
  panel.querySelector('#tap-clear-filters').addEventListener('click', () => {
    currentFilters = {
      search: '',
      minViews: 0,
      maxViews: Infinity,
      minLikes: 0,
      maxLikes: Infinity,
      minComments: 0,
      maxComments: Infinity
    };
    panel.querySelector('#tap-search').value = '';
    filterInputs.forEach(({ id }) => {
      panel.querySelector(`#${id}`).value = '';
    });
    applyFiltersAndSort();
  });
  
  // Sort buttons
  panel.querySelectorAll('.tap-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.tap-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSort.field = btn.dataset.sort;
      applyFiltersAndSort();
    });
  });
  
  // Order toggle
  panel.querySelector('#tap-order-toggle').addEventListener('click', (e) => {
    currentSort.order = currentSort.order === 'desc' ? 'asc' : 'desc';
    e.target.textContent = currentSort.order === 'desc' ? '⬇️ Maior → Menor' : '⬆️ Menor → Maior';
    applyFiltersAndSort();
  });
  
  // Download videos
  panel.querySelector('#tap-download-videos').addEventListener('click', downloadVideos);
  
  // Export CSV
  panel.querySelector('#tap-export-csv').addEventListener('click', exportCSV);
  
  // Export JSON
  panel.querySelector('#tap-export-json').addEventListener('click', exportJSON);
  
  // Download modal cancel
  panel.querySelector('#tap-dl-cancel').addEventListener('click', () => {
    panel.querySelector('#tap-download-modal').classList.remove('active');
  });
}

// Apply filters and sort
function applyFiltersAndSort() {
  // Filter
  filteredVideos = extractedVideos.filter(v => {
    if (currentFilters.search) {
      const search = currentFilters.search.toLowerCase();
      if (!v.description.toLowerCase().includes(search)) return false;
    }
    if (v.views < currentFilters.minViews) return false;
    if (v.views > currentFilters.maxViews) return false;
    if (v.likes < currentFilters.minLikes) return false;
    if (v.likes > currentFilters.maxLikes) return false;
    if (v.comments < currentFilters.minComments) return false;
    if (v.comments > currentFilters.maxComments) return false;
    return true;
  });
  
  // Sort
  filteredVideos.sort((a, b) => {
    let valA, valB;
    switch (currentSort.field) {
      case 'views':
        valA = a.views; valB = b.views; break;
      case 'likes':
        valA = a.likes; valB = b.likes; break;
      case 'comments':
        valA = a.comments; valB = b.comments; break;
      case 'date':
        valA = a.createTime ? new Date(a.createTime).getTime() : 0;
        valB = b.createTime ? new Date(b.createTime).getTime() : 0;
        break;
      default:
        valA = 0; valB = 0;
    }
    return currentSort.order === 'desc' ? valB - valA : valA - valB;
  });
  
  renderVideos();
  updateStats();
}

// Start extraction
async function startExtraction() {
  isExtracting = true;
  extractionAborted = false;
  extractedVideos = [];
  
  showProgress(true);
  updateProgress(0, 'Iniciando extração...');
  
  const initialVideos = await extractVideosFromPage();
  extractedVideos = initialVideos.map(v => ({ ...v, selected: false }));
  
  updateProgress(50, `${extractedVideos.length} vídeos encontrados`);
  
  // Initial scroll to load more
  await autoScroll(3);
  
  // Re-extract after scroll
  const moreVideos = await extractVideosFromPage();
  const existingIds = new Set(extractedVideos.map(v => v.id));
  for (const video of moreVideos) {
    if (!existingIds.has(video.id)) {
      extractedVideos.push({ ...video, selected: false });
    }
  }
  
  showProgress(false);
  isExtracting = false;
  
  applyFiltersAndSort();
  
  // Cache results
  const username = getUsername();
  if (username) {
    chrome.storage.local.set({
      [`profile_${username}`]: {
        videos: extractedVideos,
        timestamp: Date.now()
      }
    });
  }
}

// Load ALL videos by continuous scrolling
async function loadAllVideos() {
  if (isExtracting) return;
  
  isExtracting = true;
  showProgress(true);
  updateProgress(0, 'Carregando TODOS os vídeos...');
  
  const btn = panelElement.querySelector('#tap-load-all');
  btn.disabled = true;
  btn.textContent = '⏳ Carregando...';
  
  let previousCount = extractedVideos.length;
  let noNewVideosCount = 0;
  let scrollCount = 0;
  const maxNoNewVideos = 3; // Stop after 3 scrolls with no new videos
  
  while (noNewVideosCount < maxNoNewVideos && !extractionAborted) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(2000);
    
    const newVideos = await extractVideosFromPage();
    const existingIds = new Set(extractedVideos.map(v => v.id));
    let addedCount = 0;
    
    for (const video of newVideos) {
      if (!existingIds.has(video.id)) {
        extractedVideos.push({ ...video, selected: false });
        addedCount++;
      }
    }
    
    scrollCount++;
    
    if (addedCount === 0) {
      noNewVideosCount++;
    } else {
      noNewVideosCount = 0;
    }
    
    updateProgress(
      Math.min(95, 20 + scrollCount * 5),
      `${extractedVideos.length} vídeos carregados (scroll ${scrollCount})...`
    );
    
    // Update UI periodically
    if (scrollCount % 5 === 0) {
      applyFiltersAndSort();
    }
  }
  
  window.scrollTo(0, 0);
  showProgress(false);
  isExtracting = false;
  
  btn.disabled = false;
  btn.textContent = '🔄 Carregar TODOS';
  
  applyFiltersAndSort();
  
  // Update cache
  const username = getUsername();
  if (username) {
    chrome.storage.local.set({
      [`profile_${username}`]: {
        videos: extractedVideos,
        timestamp: Date.now()
      }
    });
  }
  
  alert(`✅ Carregamento completo!\n${extractedVideos.length} vídeos encontrados.`);
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
    
    updateProgress(
      Math.min(90, 50 + scrollCount * 8),
      `Scroll ${scrollCount}/${maxScrolls}...`
    );
  }
  
  window.scrollTo(0, 0);
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Render videos list
function renderVideos() {
  const container = panelElement.querySelector('#tap-videos');
  
  if (filteredVideos.length === 0) {
    container.innerHTML = `
      <div class="tap-empty">
        <p>${extractedVideos.length === 0 ? 'Nenhum vídeo encontrado' : 'Nenhum resultado para os filtros'}</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = filteredVideos.map((video, index) => `
    <div class="tap-video-item ${video.selected ? 'selected' : ''}" data-id="${video.id}">
      <div class="tap-video-checkbox">${video.selected ? '✓' : ''}</div>
      <img class="tap-video-thumb" src="${video.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="tap-video-info">
        <div class="tap-video-desc">${video.description || 'Sem descrição'}</div>
        <div class="tap-video-metrics">
          <span>👀 ${formatNumber(video.views)}</span>
          <span>❤️ ${formatNumber(video.likes)}</span>
          <span>💬 ${formatNumber(video.comments)}</span>
        </div>
        <div class="tap-video-link">
          <a href="${video.url}" target="_blank" onclick="event.stopPropagation()">${video.url}</a>
        </div>
      </div>
    </div>
  `).join('');
  
  // Add click handlers for selection
  container.querySelectorAll('.tap-video-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      const id = item.dataset.id;
      const video = extractedVideos.find(v => v.id === id);
      if (video) {
        video.selected = !video.selected;
        item.classList.toggle('selected');
        item.querySelector('.tap-video-checkbox').textContent = video.selected ? '✓' : '';
        updateStats();
      }
    });
  });
}

// Update stats display
function updateStats() {
  const selectedVideos = extractedVideos.filter(v => v.selected);
  const totalViews = filteredVideos.reduce((sum, v) => sum + v.views, 0);
  
  panelElement.querySelector('#tap-total-videos').textContent = extractedVideos.length;
  panelElement.querySelector('#tap-filtered-count').textContent = filteredVideos.length;
  panelElement.querySelector('#tap-selected-count').textContent = selectedVideos.length;
  panelElement.querySelector('#tap-total-views').textContent = formatNumber(totalViews);
  
  const downloadBtn = panelElement.querySelector('#tap-download-videos');
  downloadBtn.disabled = selectedVideos.length === 0;
  downloadBtn.innerHTML = selectedVideos.length > 0 
    ? `📥 Baixar ${selectedVideos.length} Vídeos` 
    : '📥 Baixar Vídeos';
}

// Show/hide progress
function showProgress(show) {
  const progress = panelElement.querySelector('#tap-progress');
  progress.classList.toggle('active', show);
}

// Update progress
function updateProgress(percent, text) {
  panelElement.querySelector('#tap-progress-fill').style.width = `${percent}%`;
  panelElement.querySelector('#tap-progress-text').textContent = text;
}

// Download videos
async function downloadVideos() {
  const selected = extractedVideos.filter(v => v.selected);
  if (selected.length === 0) return;
  
  // Sort selected by current filter order
  const orderedSelected = filteredVideos.filter(v => v.selected);
  const modal = panelElement.querySelector('#tap-download-modal');
  const progressFill = panelElement.querySelector('#tap-dl-progress');
  const progressText = panelElement.querySelector('#tap-dl-text');
  
  modal.classList.add('active');
  
  // Since we can't download directly due to CORS, we'll use TikTok's no-watermark API
  // For each video, we open the download link
  for (let i = 0; i < orderedSelected.length; i++) {
    const video = orderedSelected[i];
    const progress = ((i + 1) / orderedSelected.length) * 100;
    
    progressFill.style.width = `${progress}%`;
    progressText.textContent = `Baixando ${i + 1} de ${orderedSelected.length}...`;
    
    // Try to download the video
    try {
      // Use ssstik.io API or tikcdn
      const downloadUrl = `https://www.tikwm.com/video/media/hdplay/${video.id}.mp4`;
      
      // Create download link
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `tiktok_${video.id}.mp4`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Wait between downloads to avoid overwhelming
      await sleep(1500);
    } catch (e) {
      console.error('Download failed for video:', video.id, e);
    }
  }
  
  progressText.textContent = `✅ ${orderedSelected.length} vídeos processados!`;
  
  setTimeout(() => {
    modal.classList.remove('active');
  }, 2000);
}

// Export CSV with links in filter order
function exportCSV() {
  const headers = ['Posição', 'ID', 'URL do Vídeo', 'Link Download', 'Descrição', 'Views', 'Likes', 'Comentários', 'Compartilhamentos', 'Data'];
  const rows = filteredVideos.map((v, idx) => [
    idx + 1,
    v.id,
    v.url,
    `https://www.tikwm.com/video/media/hdplay/${v.id}.mp4`,
    `"${(v.description || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
    v.views,
    v.likes,
    v.comments,
    v.shares || 0,
    v.createTime ? new Date(v.createTime).toLocaleDateString('pt-BR') : ''
  ]);
  
  const csv = '\ufeff' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  downloadFile(csv, `tiktok_${getUsername()}_${Date.now()}.csv`, 'text/csv;charset=utf-8');
}

// Export JSON
function exportJSON() {
  const json = JSON.stringify({
    username: getUsername(),
    timestamp: new Date().toISOString(),
    sortBy: currentSort.field,
    sortOrder: currentSort.order,
    filters: currentFilters,
    totalVideos: extractedVideos.length,
    filteredCount: filteredVideos.length,
    videos: filteredVideos.map((v, idx) => ({
      position: idx + 1,
      ...v,
      downloadUrl: `https://www.tikwm.com/video/media/hdplay/${v.id}.mp4`
    }))
  }, null, 2);
  
  downloadFile(json, `tiktok_${getUsername()}_${Date.now()}.json`, 'application/json');
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
