// Content script for TikTok Extractor
// This runs on TikTok pages and can access the DOM

console.log('[TikTok Extractor] Content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'ok' });
  }
  return true;
});
