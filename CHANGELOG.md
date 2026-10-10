# Changelog

All notable changes to Echo are documented here. Installers are on the [Releases page](https://github.com/echo-browser-for-ai/echo/releases).

## 0.2.10 — 2026-10-10
### New
- **The AI can now read PDFs.** Chrome shows PDFs on screen but exposes none of their text, so this used to be impossible. The new `read_pdf` tool extracts a PDF's text directly — including PDFs behind a login (the AI downloads the file with its browser tools first, then reads it).
- **The AI's browser toolkit grew from 23 tools to 63.** New capabilities include cookies and local/session storage, console and network inspection, saving pages as PDF, file uploads and drag-and-drop, coordinate-based clicking, and built-in verification helpers.

### Fixed
- **Huge page results can no longer flood the conversation.** Long `evaluate` output is cut off with a clear notice (the full result is still saved to a file when one is requested), and small page snapshots return directly instead of always being written to a `.yml` file the AI has to go open.
- **The AI now waits for pages to finish loading.** Navigation settles on network-idle (up to 5 seconds) after the page loads, instead of reading it the moment the basic structure appears — so the AI sees finished pages, not half-loaded ones.
- **Debug files stay in Echo's folder.** Snapshots and console logs now go to `~/.echo/output` instead of piling up in whatever folder your AI app was launched from.

## 0.2.9 — 2026-10-07
### Fixed
- **Show / Hide now actually works — properly this time.** Four separate faults were stacked on top of each other, which is why earlier attempts kept looking fixed while the window still misbehaved:
  - Windows silently overrides a helper program's *first* "show window" call with the state it was launched with, so **"Show" was really hiding the window** — while still reporting success. The helper is now built so that cannot happen.
  - Chromium's "Restore pages?" popup shares its window type with the real browser window. It was visible while the browser was hidden, so Echo believed the window was already on screen — and the popup stole the focus. It is now ignored, and suppressed at the source.
  - Closing to the tray starts a hide that keeps retrying for up to five seconds. If you clicked Show during that time, the retry could hide the window you had just brought up. Retries now abandon themselves.
  - Restoring the window pinned it to its small saved size, so Echo reported the window as maximised while you were looking at a half-size one.
- **The window now comes back maximised**, in front of everything else, and stays there.

### Improved
- The tray menu is now two clear items — **Show Browser** and **Hide Browser** — instead of one ambiguous toggle.
- Tray actions record *why* they ran, so any future problem is diagnosable from the log instead of guessed at.

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
