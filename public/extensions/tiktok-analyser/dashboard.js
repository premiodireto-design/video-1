// Dashboard script for TikTok Analyser
document.addEventListener('DOMContentLoaded', async () => {
  // State
  let allVideos = [];
  let filteredVideos = [];
  let profiles = {};
  let currentProfile = null;
  let currentSort = 'views-desc';
  let currentFilters = {
    search: '',
    minViews: 0,
    maxViews: Infinity,
    minLikes: 0,
    status: 'all'
  };
  
  // DOM Elements
  const videoGrid = document.getElementById('video-grid');
  const profilesList = document.getElementById('profiles-list');
  const searchInput = document.getElementById('search-input');
  const sortBtn = document.getElementById('sort-btn');
  const sortMenu = document.getElementById('sort-menu');
  const sortLabel = document.getElementById('sort-label');
  const filterBtn = document.getElementById('filter-btn');
  const filterPanel = document.getElementById('filter-panel');
  const downloadModal = document.getElementById('download-modal');
  
  // Stats elements
  const statTotal = document.getElementById('stat-total');
  const statSelected = document.getElementById('stat-selected');
  const statViews = document.getElementById('stat-views');
  const statLikes = document.getElementById('stat-likes');
  const statComments = document.getElementById('stat-comments');
  const videoCount = document.getElementById('video-count');
  
  // Initialize
  await loadProfiles();
  setupEventListeners();
  
  // Load saved profiles from storage
  async function loadProfiles() {
    const result = await chrome.storage.local.get(null);
    
    for (const key of Object.keys(result)) {
      if (key.startsWith('profile_')) {
        const username = key.replace('profile_', '');
        profiles[username] = result[key];
      }
    }
    
    renderProfilesList();
    
    // Auto-select first profile
    const usernames = Object.keys(profiles);
    if (usernames.length > 0) {
      selectProfile(usernames[0]);
    }
  }
  
  // Render profiles list in sidebar
  function renderProfilesList() {
    const usernames = Object.keys(profiles);
    
    if (usernames.length === 0) {
      profilesList.innerHTML = `
        <div class="empty-state">
          <p>Nenhum perfil salvo</p>
          <small>Visite um perfil TikTok e use a extensão</small>
        </div>
      `;
      return;
    }
    
    profilesList.innerHTML = usernames.map(username => {
      const profile = profiles[username];
      const videoCount = profile.videos?.length || 0;
      const initial = username.charAt(0).toUpperCase();
      
      return `
        <div class="profile-item ${currentProfile === username ? 'active' : ''}" data-username="${username}">
          <div class="profile-avatar">${initial}</div>
          <div class="profile-info">
            <div class="profile-name">@${username}</div>
            <div class="profile-count">${videoCount} vídeos</div>
          </div>
        </div>
      `;
    }).join('');
    
    // Add click handlers
    profilesList.querySelectorAll('.profile-item').forEach(item => {
      item.addEventListener('click', () => {
        selectProfile(item.dataset.username);
      });
    });
  }
  
  // Select a profile
  function selectProfile(username) {
    currentProfile = username;
    const profile = profiles[username];
    
    if (profile && profile.videos) {
      allVideos = profile.videos.map(v => ({ ...v, selected: false }));
    } else {
      allVideos = [];
    }
    
    applyFiltersAndSort();
    renderProfilesList();
    document.getElementById('page-title').textContent = `@${username}`;
  }
  
  // Apply filters and sort
  function applyFiltersAndSort() {
    let videos = [...allVideos];
    
    // Apply search filter
    if (currentFilters.search) {
      const search = currentFilters.search.toLowerCase();
      videos = videos.filter(v => 
        (v.description || '').toLowerCase().includes(search) ||
        (v.author || '').toLowerCase().includes(search)
      );
    }
    
    // Apply view filters
    videos = videos.filter(v => 
      v.views >= currentFilters.minViews && 
      v.views <= currentFilters.maxViews
    );
    
    // Apply like filter
    videos = videos.filter(v => v.likes >= currentFilters.minLikes);
    
    // Apply status filter
    if (currentFilters.status === 'selected') {
      videos = videos.filter(v => v.selected);
    } else if (currentFilters.status === 'available') {
      videos = videos.filter(v => v.status === 'available' || v.downloadUrl);
    }
    
    // Apply sort
    const [sortField, sortDir] = currentSort.split('-');
    videos.sort((a, b) => {
      let valA, valB;
      
      switch (sortField) {
        case 'views':
          valA = a.views || 0;
          valB = b.views || 0;
          break;
        case 'likes':
          valA = a.likes || 0;
          valB = b.likes || 0;
          break;
        case 'comments':
          valA = a.comments || 0;
          valB = b.comments || 0;
          break;
        case 'date':
          valA = a.createTime ? new Date(a.createTime).getTime() : 0;
          valB = b.createTime ? new Date(b.createTime).getTime() : 0;
          break;
        default:
          valA = 0;
          valB = 0;
      }
      
      return sortDir === 'desc' ? valB - valA : valA - valB;
    });
    
    filteredVideos = videos;
    renderVideos();
    updateStats();
  }
  
  // Render videos grid
  function renderVideos() {
    if (filteredVideos.length === 0) {
      videoGrid.innerHTML = `
        <div class="empty-state large">
          <div class="empty-icon">📹</div>
          <h2>${allVideos.length === 0 ? 'Nenhum vídeo carregado' : 'Nenhum vídeo encontrado'}</h2>
          <p>${allVideos.length === 0 ? 'Acesse um perfil do TikTok e use a extensão para carregar os vídeos aqui.' : 'Tente ajustar os filtros.'}</p>
        </div>
      `;
      return;
    }
    
    videoGrid.innerHTML = filteredVideos.map(video => `
      <div class="video-card ${video.selected ? 'selected' : ''}" data-id="${video.id}">
        <div class="video-checkbox">${video.selected ? '✓' : ''}</div>
        <div class="video-thumb-container">
          <img class="video-thumb" src="${video.thumbnail}" alt="" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>'">
          ${video.duration ? `<span class="video-duration">${formatDuration(video.duration)}</span>` : ''}
        </div>
        <div class="video-info">
          <div class="video-desc">${video.description || 'Sem descrição'}</div>
          <div class="video-metrics">
            <span class="video-metric">👀 ${formatNumber(video.views)}</span>
            <span class="video-metric">❤️ ${formatNumber(video.likes)}</span>
            <span class="video-metric">💬 ${formatNumber(video.comments)}</span>
          </div>
          ${video.createTime ? `<div class="video-date">${new Date(video.createTime).toLocaleDateString('pt-BR')}</div>` : ''}
        </div>
      </div>
    `).join('');
    
    // Add click handlers
    videoGrid.querySelectorAll('.video-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const video = allVideos.find(v => v.id === id);
        if (video) {
          video.selected = !video.selected;
          card.classList.toggle('selected');
          card.querySelector('.video-checkbox').textContent = video.selected ? '✓' : '';
          updateStats();
        }
      });
    });
    
    videoCount.textContent = `${filteredVideos.length} vídeos`;
  }
  
  // Update stats
  function updateStats() {
    const selected = allVideos.filter(v => v.selected);
    const totalViews = filteredVideos.reduce((sum, v) => sum + (v.views || 0), 0);
    const totalLikes = filteredVideos.reduce((sum, v) => sum + (v.likes || 0), 0);
    const totalComments = filteredVideos.reduce((sum, v) => sum + (v.comments || 0), 0);
    
    statTotal.textContent = formatNumber(filteredVideos.length);
    statSelected.textContent = formatNumber(selected.length);
    statViews.textContent = formatNumber(totalViews);
    statLikes.textContent = formatNumber(totalLikes);
    statComments.textContent = formatNumber(totalComments);
    
    // Update download button
    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.disabled = selected.length === 0;
    downloadBtn.innerHTML = `<span>📥</span><span>Baixar ${selected.length > 0 ? selected.length + ' ' : ''}Selecionados</span>`;
  }
  
  // Setup event listeners
  function setupEventListeners() {
    // Search
    searchInput.addEventListener('input', (e) => {
      currentFilters.search = e.target.value;
      applyFiltersAndSort();
    });
    
    // Sort toggle
    sortBtn.addEventListener('click', () => {
      sortMenu.classList.toggle('open');
    });
    
    // Sort options
    sortMenu.querySelectorAll('.sort-option').forEach(option => {
      option.addEventListener('click', () => {
        currentSort = option.dataset.sort;
        sortMenu.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
        option.classList.add('active');
        sortLabel.textContent = option.textContent.split(' ')[1] || option.textContent;
        sortMenu.classList.remove('open');
        applyFiltersAndSort();
      });
    });
    
    // Close sort menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.sort-dropdown')) {
        sortMenu.classList.remove('open');
      }
    });
    
    // Filter toggle
    filterBtn.addEventListener('click', () => {
      filterPanel.classList.toggle('open');
    });
    
    // Filter changes
    document.getElementById('filter-min-views').addEventListener('change', (e) => {
      currentFilters.minViews = parseInt(e.target.value);
      applyFiltersAndSort();
    });
    
    document.getElementById('filter-max-views').addEventListener('change', (e) => {
      currentFilters.maxViews = parseInt(e.target.value);
      applyFiltersAndSort();
    });
    
    document.getElementById('filter-min-likes').addEventListener('change', (e) => {
      currentFilters.minLikes = parseInt(e.target.value);
      applyFiltersAndSort();
    });
    
    document.getElementById('filter-status').addEventListener('change', (e) => {
      currentFilters.status = e.target.value;
      applyFiltersAndSort();
    });
    
    // Clear filters
    document.getElementById('filter-clear').addEventListener('click', () => {
      currentFilters = {
        search: '',
        minViews: 0,
        maxViews: Infinity,
        minLikes: 0,
        status: 'all'
      };
      searchInput.value = '';
      document.getElementById('filter-min-views').value = '0';
      document.getElementById('filter-max-views').value = '999999999999';
      document.getElementById('filter-min-likes').value = '0';
      document.getElementById('filter-status').value = 'all';
      applyFiltersAndSort();
    });
    
    // Select all
    document.getElementById('select-all-btn').addEventListener('click', () => {
      filteredVideos.forEach(v => v.selected = true);
      renderVideos();
      updateStats();
    });
    
    // Select top 50
    document.getElementById('select-top-btn').addEventListener('click', () => {
      allVideos.forEach(v => v.selected = false);
      const sorted = [...filteredVideos].sort((a, b) => b.views - a.views);
      sorted.slice(0, 50).forEach(v => v.selected = true);
      renderVideos();
      updateStats();
    });
    
    // Clear selection
    document.getElementById('clear-selection-btn').addEventListener('click', () => {
      allVideos.forEach(v => v.selected = false);
      renderVideos();
      updateStats();
    });
    
    // Download
    document.getElementById('download-btn').addEventListener('click', downloadSelected);
    
    // Export CSV
    document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
    
    // Export JSON
    document.getElementById('export-json-btn').addEventListener('click', exportJSON);
    
    // Cancel download
    document.getElementById('cancel-download-btn').addEventListener('click', () => {
      downloadModal.classList.remove('open');
    });
    
    // Nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      });
    });
  }
  
  // Download selected videos
  async function downloadSelected() {
    const selected = allVideos.filter(v => v.selected);
    if (selected.length === 0) return;
    
    // Since we can't directly download TikTok videos due to CORS,
    // we export a JSON with all the video URLs and metadata
    const downloadData = {
      username: currentProfile,
      timestamp: new Date().toISOString(),
      count: selected.length,
      videos: selected.map(v => ({
        id: v.id,
        url: v.url,
        description: v.description,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        shares: v.shares,
        createTime: v.createTime,
        thumbnail: v.thumbnail,
        downloadUrl: v.downloadUrl
      }))
    };
    
    downloadFile(
      JSON.stringify(downloadData, null, 2),
      `tiktok_${currentProfile}_selected_${Date.now()}.json`,
      'application/json'
    );
  }
  
  // Export CSV
  function exportCSV() {
    const headers = ['ID', 'URL', 'Descrição', 'Views', 'Likes', 'Comentários', 'Compartilhamentos', 'Data', 'Thumbnail'];
    const rows = filteredVideos.map(v => [
      v.id,
      v.url,
      `"${(v.description || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      v.views,
      v.likes,
      v.comments,
      v.shares || 0,
      v.createTime || '',
      v.thumbnail
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csv, `tiktok_${currentProfile}_${Date.now()}.csv`, 'text/csv;charset=utf-8');
  }
  
  // Export JSON
  function exportJSON() {
    const json = JSON.stringify({
      username: currentProfile,
      timestamp: new Date().toISOString(),
      count: filteredVideos.length,
      videos: filteredVideos
    }, null, 2);
    
    downloadFile(json, `tiktok_${currentProfile}_${Date.now()}.json`, 'application/json');
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
  
  // Format number helper
  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }
  
  // Format duration helper
  function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
});
