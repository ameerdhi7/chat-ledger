const open = () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
chrome.action.onClicked.addListener(open);
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === 'install') open(); });
