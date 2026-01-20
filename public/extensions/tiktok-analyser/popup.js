// Popup script for TikTok Analyser
document.addEventListener('DOMContentLoaded', async () => {
  const pageStatus = document.getElementById('page-status');
  const profileName = document.getElementById('profile-name');
  const statsGrid = document.getElementById('stats-grid');
  const openPanelBtn = document.getElementById('open-panel-btn');
  const quickExtractBtn = document.getElementById('quick-extract-btn');
  const openDashboardBtn = document.getElementById('open-dashboard-btn');

  // Check current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const isTikTok = url.includes('tiktok.com');
  const profileMatch = url.match(/tiktok\.com\/@([^/?]+)/);

  if (!isTikTok) {
    pageStatus.textContent = 'Não é TikTok';
    pageStatus.className = 'status-value not-ready';
    return;
  }

  if (!profileMatch) {
    pageStatus.textContent = 'Não é um perfil';
    pageStatus.className = 'status-value warning';
    profileName.textContent = 'Navegue para @usuario';
    return;
  }

  // We're on a profile page
  const username = profileMatch[1];
  pageStatus.textContent = 'Perfil detectado';
  pageStatus.className = 'status-value ready';
  profileName.textContent = `@${username}`;
  
  openPanelBtn.disabled = false;
  quickExtractBtn.disabled = false;

  // Load cached stats if available
  try {
    const result = await chrome.storage.local.get([`profile_${username}`]);
    const cached = result[`profile_${username}`];
    if (cached && cached.videos) {
      statsGrid.style.display = 'grid';
      document.getElementById('videos-loaded').textContent = cached.videos.length;
      document.getElementById('videos-selected').textContent = cached.selectedCount || 0;
      const totalViews = cached.videos.reduce((sum, v) => sum + (v.views || 0), 0);
      document.getElementById('total-views').textContent = formatNumber(totalViews);
    }
  } catch (e) {
    console.log('No cached data');
  }

  // Open floating panel on the page
  openPanelBtn.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'openPanel' });
      window.close();
    } catch (e) {
      // Content script not loaded, inject it
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { action: 'openPanel' });
        window.close();
      }, 500);
    }
  });

  // Quick extract
  quickExtractBtn.addEventListener('click', async () => {
    quickExtractBtn.disabled = true;
    quickExtractBtn.innerHTML = '<span>⏳</span><span>Extraindo...</span>';
    
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { action: 'quickExtract' });
      if (result && result.videos) {
        const json = JSON.stringify(result, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        await chrome.downloads.download({
          url: url,
          filename: `tiktok_${username}_${Date.now()}.json`,
          saveAs: true
        });
      }
    } catch (e) {
      console.error('Quick extract failed:', e);
    }
    
    quickExtractBtn.disabled = false;
    quickExtractBtn.innerHTML = '<span>⚡</span><span>Extração Rápida (JSON)</span>';
  });

  // Open full dashboard
  openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    window.close();
  });
});

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}
