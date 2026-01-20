// Content script for TikTok Analyser
// Runs on TikTok pages to extract video data and inject UI

console.log('[TikTok Analyser] Content script loaded');

let panelVisible = false;
let panelElement = null;
let extractedVideos = [];
let isExtracting = false;
let extractionAborted = false;

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
      return true; // Keep channel open for async
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
  
  // Method 1: Try __UNIVERSAL_DATA_FOR_REHYDRATION__
  try {
    const scripts = document.querySelectorAll('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent);
      const defaultScope = data?.['__DEFAULT_SCOPE__'];
      const userDetail = defaultScope?.['webapp.user-detail'];
      const userModule = userDetail?.userInfo?.user;
      const itemList = userDetail?.itemList || [];
      
      if (itemList.length > 0) {
        for (const item of itemList) {
          videos.push(parseVideoItem(item));
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
          if (item && item.id) {
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
        videos.push({
          id: videoId || Date.now().toString(),
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
  
  return videos;
}

// Parse a video item from TikTok's data
function parseVideoItem(item) {
  const stats = item.stats || item.statsV2 || {};
  return {
    id: item.id || item.video?.id,
    url: `https://www.tiktok.com/@${item.author?.uniqueId || getUsername()}/video/${item.id}`,
    thumbnail: item.video?.cover || item.video?.dynamicCover || item.video?.originCover || '',
    views: parseInt(stats.playCount || stats.viewCount || 0),
    likes: parseInt(stats.diggCount || stats.likeCount || 0),
    comments: parseInt(stats.commentCount || 0),
    shares: parseInt(stats.shareCount || 0),
    description: item.desc || '',
    createTime: item.createTime ? new Date(item.createTime * 1000).toISOString() : null,
    duration: item.video?.duration || 0,
    downloadUrl: item.video?.playAddr || item.video?.downloadAddr || null,
    author: item.author?.uniqueId || getUsername(),
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

// Create panel HTML
function createPanelHTML() {
  return `
    <style>
      #tiktok-analyser-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: 420px;
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
      
      .tap-logo {
        font-size: 24px;
      }
      
      .tap-title {
        font-size: 16px;
        font-weight: 600;
      }
      
      .tap-username {
        font-size: 12px;
        color: #25f4ee;
      }
      
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
      
      .tap-close:hover {
        background: rgba(255,255,255,0.2);
      }
      
      .tap-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        padding: 12px 16px;
        background: rgba(255,255,255,0.02);
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      
      .tap-stat {
        text-align: center;
      }
      
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
      
      .tap-controls {
        padding: 12px 16px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      
      .tap-btn {
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      
      .tap-btn-primary {
        background: linear-gradient(135deg, #fe2c55 0%, #ff6b6b 100%);
        color: #fff;
      }
      
      .tap-btn-secondary {
        background: rgba(255,255,255,0.1);
        color: #fff;
      }
      
      .tap-btn:hover {
        transform: translateY(-1px);
      }
      
      .tap-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      
      .tap-filters {
        padding: 12px 16px;
        display: flex;
        gap: 8px;
        align-items: center;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      
      .tap-search {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        background: rgba(255,255,255,0.05);
        color: #fff;
        font-size: 12px;
      }
      
      .tap-search::placeholder {
        color: rgba(255,255,255,0.4);
      }
      
      .tap-sort-btn {
        padding: 6px 10px;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        background: transparent;
        color: rgba(255,255,255,0.7);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .tap-sort-btn:hover, .tap-sort-btn.active {
        background: rgba(255,255,255,0.1);
        color: #25f4ee;
        border-color: #25f4ee;
      }
      
      .tap-progress {
        padding: 8px 16px;
        background: rgba(37, 244, 238, 0.1);
        border-bottom: 1px solid rgba(255,255,255,0.1);
        display: none;
      }
      
      .tap-progress.active {
        display: block;
      }
      
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
      
      .tap-videos {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }
      
      .tap-video-item {
        display: flex;
        gap: 12px;
        padding: 10px;
        background: rgba(255,255,255,0.03);
        border-radius: 8px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
      }
      
      .tap-video-item:hover {
        background: rgba(255,255,255,0.08);
      }
      
      .tap-video-item.selected {
        background: rgba(37, 244, 238, 0.15);
        border: 1px solid rgba(37, 244, 238, 0.3);
      }
      
      .tap-video-checkbox {
        position: absolute;
        top: 8px;
        left: 8px;
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 4px;
        background: rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        z-index: 1;
      }
      
      .tap-video-item.selected .tap-video-checkbox {
        background: #25f4ee;
        border-color: #25f4ee;
      }
      
      .tap-video-thumb {
        width: 60px;
        height: 80px;
        border-radius: 6px;
        object-fit: cover;
        background: rgba(255,255,255,0.1);
      }
      
      .tap-video-info {
        flex: 1;
        min-width: 0;
      }
      
      .tap-video-desc {
        font-size: 12px;
        color: rgba(255,255,255,0.9);
        margin-bottom: 6px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      
      .tap-video-metrics {
        display: flex;
        gap: 12px;
        font-size: 11px;
        color: rgba(255,255,255,0.5);
      }
      
      .tap-video-metric {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      
      .tap-video-date {
        font-size: 10px;
        color: rgba(255,255,255,0.3);
        margin-top: 4px;
      }
      
      .tap-empty {
        text-align: center;
        padding: 40px;
        color: rgba(255,255,255,0.4);
      }
      
      .tap-footer {
        padding: 12px 16px;
        background: rgba(255,255,255,0.02);
        border-top: 1px solid rgba(255,255,255,0.1);
        display: flex;
        gap: 8px;
      }
      
      .tap-footer .tap-btn {
        flex: 1;
        justify-content: center;
      }
    </style>
    
    <div class="tap-header">
      <div class="tap-header-left">
        <span class="tap-logo">📊</span>
        <div>
          <div class="tap-title">TikTok Analyser</div>
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
        <div class="tap-stat-value" id="tap-selected-count">0</div>
        <div class="tap-stat-label">Selecionados</div>
      </div>
      <div class="tap-stat">
        <div class="tap-stat-value" id="tap-total-views">0</div>
        <div class="tap-stat-label">Views Total</div>
      </div>
      <div class="tap-stat">
        <div class="tap-stat-value" id="tap-total-likes">0</div>
        <div class="tap-stat-label">Likes Total</div>
      </div>
    </div>
    
    <div class="tap-progress" id="tap-progress">
      <div class="tap-progress-bar">
        <div class="tap-progress-fill" id="tap-progress-fill"></div>
      </div>
      <div class="tap-progress-text" id="tap-progress-text">Carregando vídeos...</div>
    </div>
    
    <div class="tap-controls">
      <button class="tap-btn tap-btn-primary" id="tap-load-more">
        ⬇️ Carregar Mais
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-select-all">
        ☑️ Selecionar Todos
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-select-top">
        🏆 Top 50
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-clear-selection">
        ✖️ Limpar
      </button>
    </div>
    
    <div class="tap-filters">
      <input type="text" class="tap-search" id="tap-search" placeholder="🔍 Buscar por descrição...">
      <button class="tap-sort-btn active" data-sort="views">👀 Views</button>
      <button class="tap-sort-btn" data-sort="likes">❤️ Likes</button>
      <button class="tap-sort-btn" data-sort="date">📅 Data</button>
    </div>
    
    <div class="tap-videos" id="tap-videos">
      <div class="tap-empty">
        <p>Carregando vídeos do perfil...</p>
      </div>
    </div>
    
    <div class="tap-footer">
      <button class="tap-btn tap-btn-primary" id="tap-download-selected" disabled>
        📥 Baixar Selecionados
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-export-csv">
        📋 Exportar CSV
      </button>
      <button class="tap-btn tap-btn-secondary" id="tap-export-json">
        📄 JSON
      </button>
    </div>
  `;
}

// Setup panel event listeners
function setupPanelEvents() {
  const panel = panelElement;
  
  // Close button
  panel.querySelector('#tap-close').addEventListener('click', closePanel);
  
  // Load more
  panel.querySelector('#tap-load-more').addEventListener('click', loadMoreVideos);
  
  // Select all
  panel.querySelector('#tap-select-all').addEventListener('click', () => {
    extractedVideos.forEach(v => v.selected = true);
    renderVideos();
    updateStats();
  });
  
  // Select top 50
  panel.querySelector('#tap-select-top').addEventListener('click', () => {
    extractedVideos.forEach(v => v.selected = false);
    const sorted = [...extractedVideos].sort((a, b) => b.views - a.views);
    sorted.slice(0, 50).forEach(v => v.selected = true);
    renderVideos();
    updateStats();
  });
  
  // Clear selection
  panel.querySelector('#tap-clear-selection').addEventListener('click', () => {
    extractedVideos.forEach(v => v.selected = false);
    renderVideos();
    updateStats();
  });
  
  // Search
  panel.querySelector('#tap-search').addEventListener('input', (e) => {
    renderVideos(e.target.value);
  });
  
  // Sort buttons
  panel.querySelectorAll('.tap-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.tap-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sortVideos(btn.dataset.sort);
      renderVideos();
    });
  });
  
  // Download selected
  panel.querySelector('#tap-download-selected').addEventListener('click', downloadSelected);
  
  // Export CSV
  panel.querySelector('#tap-export-csv').addEventListener('click', exportCSV);
  
  // Export JSON
  panel.querySelector('#tap-export-json').addEventListener('click', exportJSON);
}

// Start extraction
async function startExtraction() {
  isExtracting = true;
  extractionAborted = false;
  extractedVideos = [];
  
  showProgress(true);
  updateProgress(0, 'Iniciando extração...');
  
  // Initial extraction
  const initialVideos = await extractVideosFromPage();
  extractedVideos = initialVideos.map(v => ({ ...v, selected: false }));
  
  updateProgress(50, `${extractedVideos.length} vídeos encontrados`);
  renderVideos();
  updateStats();
  
  // Try to load more by scrolling
  await autoScroll();
  
  showProgress(false);
  isExtracting = false;
  
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

// Load more videos by scrolling
async function loadMoreVideos() {
  if (isExtracting) return;
  
  isExtracting = true;
  showProgress(true);
  updateProgress(0, 'Carregando mais vídeos...');
  
  await autoScroll(10);
  
  // Re-extract after scroll
  const newVideos = await extractVideosFromPage();
  const existingIds = new Set(extractedVideos.map(v => v.id));
  
  for (const video of newVideos) {
    if (!existingIds.has(video.id)) {
      extractedVideos.push({ ...video, selected: false });
    }
  }
  
  showProgress(false);
  isExtracting = false;
  renderVideos();
  updateStats();
}

// Auto scroll to load more content
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
  
  // Scroll back to top
  window.scrollTo(0, 0);
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Sort videos
function sortVideos(sortBy) {
  switch (sortBy) {
    case 'views':
      extractedVideos.sort((a, b) => b.views - a.views);
      break;
    case 'likes':
      extractedVideos.sort((a, b) => b.likes - a.likes);
      break;
    case 'date':
      extractedVideos.sort((a, b) => {
        const dateA = a.createTime ? new Date(a.createTime) : new Date(0);
        const dateB = b.createTime ? new Date(b.createTime) : new Date(0);
        return dateB - dateA;
      });
      break;
  }
}

// Render videos list
function renderVideos(searchTerm = '') {
  const container = panelElement.querySelector('#tap-videos');
  const search = searchTerm.toLowerCase();
  
  const filtered = extractedVideos.filter(v => {
    if (!search) return true;
    return v.description.toLowerCase().includes(search);
  });
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="tap-empty">
        <p>${extractedVideos.length === 0 ? 'Nenhum vídeo encontrado' : 'Nenhum resultado para a busca'}</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = filtered.map((video, index) => `
    <div class="tap-video-item ${video.selected ? 'selected' : ''}" data-id="${video.id}">
      <div class="tap-video-checkbox">${video.selected ? '✓' : ''}</div>
      <img class="tap-video-thumb" src="${video.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="tap-video-info">
        <div class="tap-video-desc">${video.description || 'Sem descrição'}</div>
        <div class="tap-video-metrics">
          <span class="tap-video-metric">👀 ${formatNumber(video.views)}</span>
          <span class="tap-video-metric">❤️ ${formatNumber(video.likes)}</span>
          <span class="tap-video-metric">💬 ${formatNumber(video.comments)}</span>
        </div>
        ${video.createTime ? `<div class="tap-video-date">${new Date(video.createTime).toLocaleDateString('pt-BR')}</div>` : ''}
      </div>
    </div>
  `).join('');
  
  // Add click handlers for selection
  container.querySelectorAll('.tap-video-item').forEach(item => {
    item.addEventListener('click', () => {
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
  const selectedCount = extractedVideos.filter(v => v.selected).length;
  const totalViews = extractedVideos.reduce((sum, v) => sum + v.views, 0);
  const totalLikes = extractedVideos.reduce((sum, v) => sum + v.likes, 0);
  
  panelElement.querySelector('#tap-total-videos').textContent = extractedVideos.length;
  panelElement.querySelector('#tap-selected-count').textContent = selectedCount;
  panelElement.querySelector('#tap-total-views').textContent = formatNumber(totalViews);
  panelElement.querySelector('#tap-total-likes').textContent = formatNumber(totalLikes);
  
  const downloadBtn = panelElement.querySelector('#tap-download-selected');
  downloadBtn.disabled = selectedCount === 0;
  downloadBtn.textContent = selectedCount > 0 ? `📥 Baixar ${selectedCount} Selecionados` : '📥 Baixar Selecionados';
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

// Download selected videos
async function downloadSelected() {
  const selected = extractedVideos.filter(v => v.selected);
  if (selected.length === 0) return;
  
  const btn = panelElement.querySelector('#tap-download-selected');
  btn.disabled = true;
  btn.textContent = '⏳ Preparando...';
  
  // For now, generate a JSON with video URLs for external download
  // Direct download would require backend proxy due to CORS
  const downloadData = selected.map(v => ({
    id: v.id,
    url: v.url,
    description: v.description,
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    thumbnail: v.thumbnail
  }));
  
  const json = JSON.stringify({
    username: getUsername(),
    timestamp: new Date().toISOString(),
    count: selected.length,
    videos: downloadData
  }, null, 2);
  
  downloadFile(json, `tiktok_${getUsername()}_selected_${Date.now()}.json`, 'application/json');
  
  btn.disabled = false;
  updateStats();
}

// Export CSV
function exportCSV() {
  const headers = ['ID', 'URL', 'Descrição', 'Views', 'Likes', 'Comentários', 'Data'];
  const rows = extractedVideos.map(v => [
    v.id,
    v.url,
    `"${(v.description || '').replace(/"/g, '""')}"`,
    v.views,
    v.likes,
    v.comments,
    v.createTime || ''
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadFile(csv, `tiktok_${getUsername()}_${Date.now()}.csv`, 'text/csv');
}

// Export JSON
function exportJSON() {
  const json = JSON.stringify({
    username: getUsername(),
    timestamp: new Date().toISOString(),
    count: extractedVideos.length,
    videos: extractedVideos
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
