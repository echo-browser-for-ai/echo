# Changelog

All notable changes to Echo are documented here. Installers are on the [Releases page](https://github.com/echo-browser-for-ai/echo/releases).

## 0.2.8 — 2026-10-07
### Fixed
- **Show/Hide no longer does the opposite of what you asked.** Echo used to ask Chromium whether the window was visible — but Chromium cannot see a window that has been hidden, so it always answered "visible". Combined with a state flag that reset whenever the browser restarted, the toggle could hide a window you were trying to show. Echo now asks the native helper, which reads the real window state from Windows.
- **The tray menu is now two explicit items — "Show Browser" and "Hide Browser"** — instead of one ambiguous toggle. Each does exactly what it says, and clicking the wrong one is harmless.
- **The flash when closing to tray is gone.** Chromium was relaunched and left visible (taskbar entry and all) for roughly 700ms before being hidden. It now starts hiding the moment it launches.

## 0.2.7 — 2026-10-07
### Fixed
- **Tray → Show (and double-clicking the tray icon) now brings the window to the front.** It was being restored but left behind whatever you were looking at, so it seemed like nothing happened until you clicked the taskbar icon. The window is now un-minimised only when it is genuinely minimised — so a maximised window stays maximised — and is then properly activated.
- **Update notes are readable again.** Release notes were displayed as raw HTML (`<h3>`, `<p>`, and so on) because they come from GitHub's release feed. They are now shown as plain text.

### Improved
- **The Updates panel now says what is actually happening.** Each card shows the version you have installed and a plain status line — "Checking…", "Downloading 0.2.8 — 42%", "downloaded and ready to install" — so it is clear whether an update is in progress.

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
