chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

/**
 * Run captureVisibleTab in the service worker. Clicks in the side panel often do not
 * activate activeTab; host_permissions (here: <all_urls>) are required.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CAPTURE_VISIBLE_TAB") {
    return;
  }

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.windowId) {
        sendResponse({ ok: false, error: "Could not get the active tab." });
        return;
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      sendResponse({ ok: true, dataUrl });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();

  return true;
});
