// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('ClawdKit installed');
});

// Inject content script into already-open Claude.ai tabs when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['jszip.min.js', 'utils.js', 'content.js', 'vendor/o200k_base.js', 'counter/constants.js', 'counter/bridge-client.js', 'counter/tokens.js', 'counter/ui.js', 'counter/main.js']
      }).catch(err => console.log('Could not inject into tab', tab.id, err));
      chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css', 'counter/styles.css']
      }).catch(err => console.log('Could not inject CSS into tab', tab.id, err));
    });
  });
});

// Handle messages from popup when content script might not be injected
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ensureContentScript') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['jszip.min.js', 'utils.js', 'content.js', 'vendor/o200k_base.js', 'counter/constants.js', 'counter/bridge-client.js', 'counter/tokens.js', 'counter/ui.js', 'counter/main.js']
        }, () => {
          sendResponse({ success: true });
        });
      }
    });
    return true;
  }
});