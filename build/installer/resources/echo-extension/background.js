/**
 * Echo New Tab — background watchdog (MV3 service worker).
 *
 * The "Echo changed your New Tab page — Keep / Restore" dialog can appear once
 * on a fresh profile. If the user clicks "Restore", Chromium deactivates our
 * chrome_url_overrides and shows its own new-tab page. This worker watches for
 * new tabs heading to Chromium's default new-tab page and sends them to Echo's
 * newtab.html instead — so clicking "Restore" no longer loses the Echo page.
 *
 * chrome_url_overrides stays as the primary/safety mechanism (Echo's page shows
 * even if this worker is slow or asleep). This worker is the backup that covers
 * the post-"Restore" case.
 *
 * MV3 RULE: event listeners MUST be registered at the top level (synchronously)
 * so the service worker wakes for them. Do NOT wrap these addListener calls in
 * an async function or a promise.
 */

const ECHO_NTP = chrome.runtime.getURL("newtab.html");

/** Only redirect genuine new-tab-intent URLs. Never touch real navigations, our
 *  own pages, or about:blank (about:blank may be a popup about to load). */
function isChromiumNtp(url) {
  if (!url) return false;
  if (url.startsWith("chrome-extension://")) return false; // ours — prevents a loop
  return (
    url === "chrome://newtab" ||
    url === "chrome://newtab/" ||
    url.startsWith("chrome://new-tab-page")
  );
}

// Primary catch: redirect as early as possible, when the tab is created.
chrome.tabs.onCreated.addListener((tab) => {
  const url = tab.pendingUrl || tab.url || "";
  if (isChromiumNtp(url)) {
    chrome.tabs.update(tab.id, { url: ECHO_NTP }).catch(() => {
      /* tab may have closed meanwhile; ignore */
    });
  }
});

// Safety net: if the worker woke too late for onCreated, catch the actual
// navigation to Chromium's NTP via onUpdated.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && isChromiumNtp(changeInfo.url)) {
    chrome.tabs.update(tabId, { url: ECHO_NTP }).catch(() => {
      /* ignore */
    });
  }
});
