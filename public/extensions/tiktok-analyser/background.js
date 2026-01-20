// Background service worker for TikTok Analyser

console.log('[TikTok Analyser] Background service worker started');

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[TikTok Analyser] Extension installed/updated:', details.reason);
  
  // Set default settings
  chrome.storage.local.set({
    settings: {
      autoLoadOnProfile: true,
      maxVideosPerLoad: 100,
      downloadConcurrency: 3
    }
  });
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[TikTok Analyser] Background received message:', request.action);
  
  switch (request.action) {
    case 'downloadVideo':
      handleVideoDownload(request.url, request.filename)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'openDashboard':
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      sendResponse({ success: true });
      break;
      
    case 'getProfileData':
      chrome.storage.local.get([`profile_${request.username}`], (result) => {
        sendResponse(result[`profile_${request.username}`] || null);
      });
      return true;
      
    case 'saveProfileData':
      chrome.storage.local.set({
        [`profile_${request.username}`]: {
          videos: request.videos,
          timestamp: Date.now()
        }
      }, () => {
        sendResponse({ success: true });
      });
      return true;
  }
});

// Handle video download
async function handleVideoDownload(url, filename) {
  try {
    const downloadId = await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false
    });
    
    return { success: true, downloadId };
  } catch (error) {
    console.error('[TikTok Analyser] Download failed:', error);
    return { success: false, error: error.message };
  }
}

// Listen for tab updates to inject content script
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('tiktok.com/@')) {
    // Content script is already declared in manifest, just log
    console.log('[TikTok Analyser] TikTok profile page loaded:', tab.url);
  }
});
