let extractedData = null;

document.addEventListener('DOMContentLoaded', async () => {
  const statusText = document.getElementById('status-text');
  const videoCount = document.getElementById('video-count');
  const extractBtn = document.getElementById('extract-btn');
  const copyBtn = document.getElementById('copy-btn');
  const scrollBtn = document.getElementById('scroll-btn');
  const loading = document.getElementById('loading');
  const mainContent = document.getElementById('main-content');

  // Check if we're on a TikTok profile page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const isProfile = url.includes('tiktok.com/@');
  
  if (!isProfile) {
    statusText.textContent = 'Abra um perfil do TikTok';
    statusText.className = 'status-value not-ready';
    return;
  }

  // Extract username from URL
  const usernameMatch = url.match(/tiktok\.com\/@([^\/\?]+)/);
  const username = usernameMatch ? usernameMatch[1] : 'desconhecido';
  
  statusText.textContent = `Perfil: @${username}`;
  statusText.className = 'status-value ready';
  extractBtn.disabled = false;
  scrollBtn.disabled = false;

  // Extract button click
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

  // Copy JSON button
  copyBtn.addEventListener('click', async () => {
    if (!extractedData) return;
    
    try {
      await navigator.clipboard.writeText(JSON.stringify(extractedData, null, 2));
      copyBtn.textContent = '✅ Copiado!';
      setTimeout(() => {
        copyBtn.textContent = '📋 Copiar JSON';
      }, 2000);
    } catch (err) {
      console.error('Copy error:', err);
    }
  });

  // Auto-scroll button
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

// Function to extract videos from the page (runs in content script context)
function extractVideosFromPage() {
  const videos = [];
  const seenIds = new Set();
  
  // Try to find video data in the page's state
  
  // Method 1: Look for __UNIVERSAL_DATA_FOR_REHYDRATION__
  const universalScript = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (universalScript) {
    try {
      const data = JSON.parse(universalScript.textContent);
      const defaultScope = data?.['__DEFAULT_SCOPE__'] || {};
      
      // Get user info
      const userDetail = defaultScope['webapp.user-detail'];
      const user = userDetail?.userInfo?.user;
      
      // Get posts
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
          video: {
            cover: item.video?.cover || item.video?.dynamicCover || '',
          },
          author: {
            uniqueId: user?.uniqueId || item.author?.uniqueId || '',
          },
        });
      }
    } catch (e) {
      console.log('Failed to parse UNIVERSAL_DATA:', e);
    }
  }
  
  // Method 2: Look for SIGI_STATE
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
          video: {
            cover: item.video?.cover || item.video?.dynamicCover || '',
          },
          author: {
            uniqueId: userData?.uniqueId || item.author?.uniqueId || '',
          },
        });
      }
    } catch (e) {
      console.log('Failed to parse SIGI_STATE:', e);
    }
  }
  
  // Method 3: Fallback - extract from DOM
  if (videos.length === 0) {
    const videoElements = document.querySelectorAll('[data-e2e="user-post-item"]');
    const username = window.location.pathname.replace(/^\//, '').replace(/@/, '').split('/')[0];
    
    videoElements.forEach((el, idx) => {
      const link = el.querySelector('a');
      const href = link?.href || '';
      const idMatch = href.match(/video\/(\d+)/);
      const id = idMatch ? idMatch[1] : String(Date.now() + idx);
      
      if (seenIds.has(id)) return;
      seenIds.add(id);
      
      // Try to get stats from the element
      const viewText = el.querySelector('[data-e2e="video-views"]')?.textContent || '0';
      const views = parseCount(viewText);
      
      videos.push({
        id,
        desc: '',
        createTime: Math.floor(Date.now() / 1000),
        stats: {
          playCount: views,
          diggCount: 0,
          commentCount: 0,
          shareCount: 0,
          collectCount: 0,
        },
        video: {
          cover: '',
        },
        author: {
          uniqueId: username,
        },
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
  
  // Get username from URL
  const urlUsername = window.location.pathname.replace(/^\//, '').replace(/@/, '').split('/')[0];
  
  return {
    username: urlUsername,
    extractedAt: new Date().toISOString(),
    videos,
  };
}

// Function to auto-scroll the page to load more videos
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
}
