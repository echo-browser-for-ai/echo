# Changelog

All notable changes to Echo are documented here. Installers are on the [Releases page](https://github.com/echo-browser-for-ai/echo/releases).

## 0.2.6 — 2026-10-07
- **No functional changes.** Verification build confirming that updating Echo no longer touches browsing data: this update was installed over 0.2.5 and the existing browser profile (logins, cookies, history, new-tab shortcuts) was left intact.

## 0.2.5 — 2026-10-07
### Fixed (important)
- **Updating Echo no longer deletes your browsing data.** The uninstaller was wiping the browser profile, and Windows runs the uninstaller when installing a new version over an old one — so every update signed you out of every site, cleared history, and removed your new-tab shortcuts. The destructive step has been removed, with a comment explaining why it must not come back. Browsing data is now only cleared when you ask for it, via **Settings → Advanced → Clear browsing data**.
- Note for anyone already on 0.2.3/0.2.4: the next update runs the *currently installed* uninstaller, so that one update will still clear your data. From 0.2.5 onwards it is fixed permanently.

### Also
- Browsing data is kept when Echo is uninstalled (matching the existing `deleteAppDataOnUninstall: false` intent).

## 0.2.4 — 2026-10-07
- Fixed: if an AI app started before Echo was running, the connection failed with `process exited with code 1` and stayed broken until the AI app itself was restarted. Echo now starts itself and waits for the browser to come up.
- Cleanup: removed an unused background service worker and the `tabs` permission from the bundled new-tab extension.
- Docs: README rewritten with accurate build instructions, supported apps, and support details.

## 0.2.3 — 2026-10-04
- New Tab: the default Echo shortcut now points at the public repository; shortcuts saved with the old link are repaired automatically on launch.

## 0.2.2 — 2026-10-04
- Fixed: closing the window after applying/resetting the browser engine could silently quit Echo instead of staying in the tray.
- New: tray notification when an update has been downloaded.
- About: shows the real installed version (was hardcoded).

## 0.2.1 — 2026-10-04
- First public release (Windows): tray-first Chromium browser with one-click MCP registration into 14 AI apps, app + engine auto-updates, and a bundled new-tab page.
