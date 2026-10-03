<p align="center">
  <img src="assets/icon.png" width="110" alt="Echo logo" />
</p>

<h1 align="center">Echo — Browser for AI</h1>

<p align="center">
  A local Chromium browser your AI agents can drive.<br/>
  One-click MCP connection. Tray-first. Zero config.
</p>

<p align="center">
  <a href="releases/latest"><img src="https://img.shields.io/github/v/release/echo-browser-for-ai/echo?label=download&style=flat-square" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" alt="Platform: Windows" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License: MIT" />
  <img src="https://img.shields.io/badge/price-free-8957e5?style=flat-square" alt="Free" />
</p>

---

Echo is a desktop browser built for AI agents. It's Chromium under the hood with a native DevTools (CDP) connection — your AI tools plug in through Playwright's MCP and drive a real browser with real sessions. No cloud, no sandboxes, no per-hour fees.

Launch it once. It lives in your system tray, keeps its debugging connection alive, and registers itself into every supported AI app it finds. From then on, your agent can browse, click, fill forms, and read pages — while you watch.

## Why Echo

- **One-click connection** — auto-registers into 14 AI apps on first launch: Claude Code & Desktop, Cursor, Codex, Gemini CLI, VS Code, Windsurf, Cline, Roo Code, OpenCode, Qwen, Continue, Antigravity, and pi. No JSON editing.
- **Local-first** — everything runs on your machine. No accounts, no telemetry, no cloud browser fees.
- **Survives everything** — close the window and Echo keeps running in the tray; the AI connection never drops.
- **Real browser, real sessions** — full Chromium with tabs, logins, downloads, PDFs, and extensions.
- **Always current** — built-in auto-update for both the app and the Chromium engine.
- **Not treated as a bot** — the usual automation tells are handled so sites don't shut out your agent.

## How it works

```
AI app  ──MCP──▶  Echo MCP launcher  ──CDP──▶  bundled Chromium
                  (the tray app keeps the browser and the connection alive)
```

Echo runs a small local settings server and writes a lockfile with the browser's live debugging port — if the port changes, the launcher self-heals. Your AI app never has to care.

## Getting started

1. **Download** the latest installer from [Releases](releases/latest).
2. **Run it** — per-user install, no admin needed. Echo starts in your tray.
3. **Use your AI app** — Echo registers itself on launch. If your AI app was already open, restart it once and the browser tools appear.

Echo opens its own new-tab page with search, shortcuts, and a Support button.

## Supported AI apps

pi · Claude Code · Claude Desktop · Cursor · OpenCode · Codex · Gemini CLI · Antigravity 2.0 · Qwen Code · Cline · Roo Code · VS Code (Copilot) · Windsurf · Continue

## FAQ

**Is it free?**
Yes. Echo is free to use. If it earns a place in your workflow, you can [support development on Patreon](https://www.patreon.com/cw/xiar_drp).

**Does it use my own Chrome?**
No — Echo ships its own Chromium and keeps its own isolated profile. It never reads or modifies your personal browser data.

**Which platforms?**
Windows first. macOS and Linux are possible later.

**Is my data sent anywhere?**
No. Settings and browsing data stay on your machine. The only network calls Echo makes are update checks against this repository.

**How do I uninstall it?**
Windows Settings → Apps → Echo → Uninstall. It automatically removes itself from every AI app's configuration.

## Open source

Echo is open source under the [MIT license](LICENSE) — the installer in [Releases](releases/latest) is built from this repository. Issues and pull requests are welcome.

The bundled extension's signing key is not published (it fixes the extension ID), and the vendored runtime (Node, Chromium) is fetched by the build scripts rather than committed — everything else is readable, buildable, and forkable.

### Run from source

Requires Node.js 20+ and Windows.

```bash
npm install
npm run dev
```

Building the Windows installer: `npm run build:win` (needs Git Bash; downloads the vendored Node/Chromium runtime — multi-GB).

## Security & privacy

- **Local-only.** Everything runs on your machine — no accounts, no telemetry. The only network calls Echo makes are update checks against this repository.
- **Your profile stays yours.** Echo keeps its own Chromium profile and never reads or modifies your personal browser data.
- **Config writes are the feature — and they're careful.** On launch, Echo adds a single `echo` entry to the MCP config of the AI apps you have installed. Writes are atomic, an existing config that fails to parse is never overwritten, and app folders that don't exist are left alone. Uninstalling Echo removes the `echo` entry from every config automatically.
- **Unsigned installer.** The Windows installer is not code-signed yet, so SmartScreen may warn on first run — click **More info → Run anyway**, or build from source.

## Notes

- Bundled Chromium © The Chromium Authors, used under the BSD-3-Clause license.
