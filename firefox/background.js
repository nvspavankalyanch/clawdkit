// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('ClawdKit installed');
});

// Inject content script into already-open Claude.ai tabs when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
    tabs.forEach(tab => {
      const files = ['jszip.min.js', 'utils.js', 'content.js', 'vendor/o200k_base.js', 'counter/constants.js', 'counter/bridge-client.js', 'counter/tokens.js', 'counter/ui.js', 'counter/main.js'];
      // Inject sequentially so each file's globals are available before the next loads
      files.reduce((promise, file) => {
        return promise.then(() => new Promise(resolve => {
          chrome.tabs.executeScript(tab.id, { file }, () => {
            if (chrome.runtime.lastError) {
              console.log('Could not inject', file, 'into tab', tab.id, chrome.runtime.lastError.message);
            }
            resolve();
          });
        }));
      }, Promise.resolve());
    });
  });
});

// Handle messages from popup when content script might not be injected
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ensureContentScript') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const files = ['jszip.min.js', 'utils.js', 'content.js', 'vendor/o200k_base.js', 'counter/constants.js', 'counter/bridge-client.js', 'counter/tokens.js', 'counter/ui.js', 'counter/main.js'];
        // Inject sequentially; resolve/reject sendResponse when done or on first error
        files.reduce((promise, file) => {
          return promise.then(() => new Promise((resolve, reject) => {
            chrome.tabs.executeScript(tabs[0].id, { file }, () => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve();
              }
            });
          }));
        }, Promise.resolve())
          .then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ success: false, error: err.message }));
      } else {
        sendResponse({ success: false, error: 'No active tab' });
      }
    });
    return true;
  }
});

