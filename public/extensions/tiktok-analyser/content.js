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
      views: jsonInfo.views || parseCount(viewsEl?.textContent || '0'),
      likes: jsonInfo.likes || 0,
      comments: jsonInfo.comments || 0,
      shares: jsonInfo.shares || 0,
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
        <button class="tat-btn" id="tat-order">⬇️</button>
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
      
      <button class="tat-btn" id="tat-apply-filter">🔍 Aplicar</button>
      <button class="tat-btn" id="tat-clear-filter">❌ Limpar</button>
      
      <!-- Actions -->
      <div class="tat-group" style="margin-left: auto;">
        <button class="tat-btn tat-btn-success" id="tat-load-all">🔄 Carregar TODOS</button>
        <button class="tat-btn" id="tat-select-visible">☑️ Sel. Visíveis</button>
        <button class="tat-btn" id="tat-clear-selection">✖️ Limpar Sel.</button>
      </div>
      
      <div class="tat-group">
        <button class="tat-btn tat-btn-primary" id="tat-download-zip" disabled>📥 Baixar ZIP</button>
        <button class="tat-btn" id="tat-export-csv">📋 CSV</button>
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
    e.target.textContent = currentSort.order === 'desc' ? '⬇️' : '⬆️';
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
  
  // Export CSV
  toolbar.querySelector('#tat-export-csv').addEventListener('click', exportCSV);
  
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

// Apply filters and sort - reorders actual DOM elements
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

  // Filter videos
  const filtered = extractedVideos.filter(v => {
    if (v.views < currentFilters.minViews) return false;
    if (v.views > currentFilters.maxViews) return false;
    if (v.likes < currentFilters.minLikes) return false;
    if (v.likes > currentFilters.maxLikes) return false;
    if (v.comments < currentFilters.minComments) return false;
    if (v.comments > currentFilters.maxComments) return false;
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
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

  // Get the parent container of video cards
  const videoGrid = document.querySelector('[data-e2e="user-post-item-list"]');

  // Update visibility + selection classes
  const filteredIds = new Set(filtered.map(v => v.id));
  extractedVideos.forEach(v => {
    const el = videoElementsMap.get(v.id);
    if (!el) return;

    el.classList.toggle('tat-video-hidden', !filteredIds.has(v.id));
    if (selectedVideoIds.has(v.id)) el.classList.add('tat-video-selected');
    else el.classList.remove('tat-video-selected');

    // Ensure we don't leave old ordering artifacts around
    el.style.removeProperty('order');
  });

  // Reorder by moving DOM nodes (doesn't break TikTok's grid like forcing flexbox)
  if (videoGrid) {
    const frag = document.createDocumentFragment();

    // First: visible in correct order
    for (const v of filtered) {
      const el = videoElementsMap.get(v.id);
      if (el && el.parentElement === videoGrid) frag.appendChild(el);
    }

    // Then: hidden items (keep them in DOM so TikTok lazy-load doesn't freak out)
    for (const v of extractedVideos) {
      if (filteredIds.has(v.id)) continue;
      const el = videoElementsMap.get(v.id);
      if (el && el.parentElement === videoGrid) frag.appendChild(el);
    }

    videoGrid.appendChild(frag);
  }

  // Setup click handlers for video selection
  extractedVideos.forEach(video => {
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
      });
    }
  });

  updateStats();

  // Store filtered for export
  window._tatFilteredVideos = filtered;
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
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const stats = data?.itemInfo?.itemStruct?.stats || data?.itemInfo?.itemStruct?.statsV2;

    if (!stats) return null;

    const result = {
      likes: parseInt(stats.diggCount || stats.likeCount || 0),
      comments: parseInt(stats.commentCount || 0),
      shares: parseInt(stats.shareCount || 0)
    };

    tatStatsCache.set(videoId, result);
    return result;
  } catch (e) {
    // Ignore (blocked / rate-limited)
    return null;
  } finally {
    tatStatsLoading.delete(videoId);
  }
}

async function ensureStatsForVideos(videos) {
  // Only fetch missing stats for videos that matter
  const missing = videos
    .filter(v => v && v.id && (v.likes === 0 && v.comments === 0) && !tatStatsCache.has(v.id))
    .slice(0, 120); // cap to avoid huge bursts

  if (missing.length === 0) return;

  // Concurrency = 4
  const concurrency = 4;
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
      }
      // small pacing
      await sleep(120);
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
  downloadBtn.disabled = selectedVideoIds.size === 0;
  downloadBtn.textContent = selectedVideoIds.size > 0 
    ? `📥 Baixar ${selectedVideoIds.size} ZIP` 
    : '📥 Baixar ZIP';
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
  const selectedVideos = extractedVideos.filter(v => selectedVideoIds.has(v.id));
  if (selectedVideos.length === 0) return;

  const jszipOk = await loadJSZip();
  if (!jszipOk || typeof JSZip === 'undefined') {
    alert('❌ Não foi possível carregar o ZIP (JSZip). Reinstale a extensão (versão nova) e tente novamente.');
    return;
  }

  // Sort by current filter order
  const orderedVideos = (window._tatFilteredVideos || []).filter(v => selectedVideoIds.has(v.id));

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
      
      // Try multiple download sources
      const downloadUrls = [
        `https://tikwm.com/video/media/hdplay/${video.id}.mp4`,
        `https://www.tikwm.com/video/media/play/${video.id}.mp4`,
        video.downloadUrl
      ].filter(Boolean);
      
      let blob = null;
      
      for (const url of downloadUrls) {
        if (extractionAborted) break;
        
        try {
          const response = await fetch(url, {
            credentials: 'include',
            headers: {
              'Accept': 'video/mp4,video/*,*/*'
            }
          });
          
          if (response.ok) {
            blob = await response.blob();
            if (blob.size > 10000) { // At least 10KB
              addLog(`  ✓ Sucesso via ${new URL(url).hostname}`, 'success');
              break;
            }
          }
        } catch (e) {
          console.log('Download attempt failed:', url, e);
        }
      }
      
      if (blob && blob.size > 10000) {
        const filename = `${String(i + 1).padStart(3, '0')}_${video.id}.mp4`;
        zip.file(filename, blob);
        successCount++;
      } else {
        addLog(`  ✗ Falhou - tentando proxy...`, 'error');
        
        // Try with a CORS proxy as last resort
        try {
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(`https://tikwm.com/video/media/hdplay/${video.id}.mp4`)}`;
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
    addLog('Os links podem estar bloqueados pelo TikTok.', 'error');
    addLog('Tente exportar o CSV e usar um downloader externo.', 'error');
  }
  
  if (failCount > 0) {
    addLog(`⚠️ ${failCount} vídeos falharam.`, 'error');
  }
}

// Export CSV
function exportCSV() {
  const videos = window._tatFilteredVideos || extractedVideos;

  const headers = [
    'Posição',
    'ID',
    'URL TikTok',
    'Link Interno (CDN)',
    'Link Download (tikwm)',
    'Descrição',
    'Views',
    'Likes',
    'Comentários',
    'Data'
  ];

  const rows = videos.map((v, idx) => [
    idx + 1,
    v.id,
    v.url,
    v.downloadUrl || '',
    `https://tikwm.com/video/media/hdplay/${v.id}.mp4`,
    `"${(v.description || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
    v.views,
    v.likes,
    v.comments,
    v.createTime ? new Date(v.createTime).toLocaleDateString('pt-BR') : ''
  ]);

  const csv = '\ufeff' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
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

// Load JSZip (local, to avoid TikTok CSP blocking CDNs)
async function loadJSZip() {
  if (typeof JSZip !== 'undefined') return true;

  return await new Promise((resolve) => {
    const existing = document.querySelector('script[data-tat-jszip]');
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.setAttribute('data-tat-jszip', 'true');
    script.src = chrome.runtime.getURL('vendor/jszip.min.js');
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

console.log('[TikTok Analyser] Content script initialized v2');
