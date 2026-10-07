<p align="center">
  <img src="public/icon.png" width="110" alt="Echo logo" />
</p>

<h1 align="center">Echo — Browser for AI</h1>

<p align="center">
  A local Chromium browser your AI agents can drive.<br/>
  One-click MCP connection. Tray-first. Zero config.
</p>

<p align="center">
  <a href="https://github.com/echo-browser-for-ai/echo/releases/latest"><img src="https://img.shields.io/github/v/release/echo-browser-for-ai/echo?label=download&style=flat-square" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" alt="Platform: Windows" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License: MIT" />
  <img src="https://img.shields.io/badge/price-free-8957e5?style=flat-square" alt="Free" />
</p>

---

Echo is a desktop browser built for AI agents. It is Chromium under the hood with a native DevTools (CDP) connection — your AI tools plug in through Playwright's MCP and drive a real browser with real sessions. No cloud, no sandboxes, no per-hour fees.

Launch it once. It lives in your system tray, keeps its debugging connection alive, and registers itself into every supported AI app it finds. From then on your agent can browse, click, fill forms, and read pages — while you watch.

## Why Echo

- **One-click connection** — auto-registers into 15 AI apps on first launch: pi, Claude Code, Claude Desktop, Cursor, OpenCode, Codex, Gemini CLI, Antigravity 2.0, Qwen Code, Cline, Roo Code, VS Code (Copilot), Windsurf, Continue, and MiniMax Code. No JSON editing.
- **Local-first** — everything runs on your machine. No accounts, no telemetry, no cloud browser fees.
- **Survives everything** — close the window and Echo keeps running in the tray; the AI connection never drops.
- **Real browser, real sessions** — full Chromium with tabs, logins, downloads, PDFs, and extensions. Echo keeps its own profile, so it never touches your personal browser data.
- **Always current** — built-in auto-update for both the app and the Chromium engine. The engine download is SHA-256 verified and rolls back automatically if a new build crash-loops.
- **Built for real sites** — a normal, persistent browsing profile, so sites see a browser session rather than a throwaway automation environment.

## How it works

```
AI app  ──MCP──▶  Echo MCP launcher  ──CDP──▶  bundled Chromium
                  (the tray app keeps the browser and the connection alive)
```

Echo runs a small local settings server, and writes a lockfile holding the browser's live debugging port and process ID. If the port changes, or the browser has been closed, the launcher finds it — or cold-starts it — and re-reads the lockfile. Your AI app's config never has to change.

## Getting started

1. **Download** the latest installer from [Releases](https://github.com/echo-browser-for-ai/echo/releases/latest) — `Echo-Windows-X.Y.Z-Setup.exe`.
2. **Run it.** It is a per-user install, so no admin rights are needed. Echo starts in your system tray.
3. **Use your AI app.** Echo registers itself on launch. If your AI app was already open, restart it once and the browser tools will appear.

Echo opens its own new-tab page with search, shortcuts, and a Support button.

**Requirements:** Windows 10 or 11 (x64). The installer is roughly 365 MB because it bundles the Chromium engine.

## Supported AI apps

15 apps are detected and configured automatically:

pi · Claude Code · Claude Desktop · Cursor · OpenCode · Codex (OpenAI) · Gemini CLI · Antigravity 2.0 · Qwen Code · Cline · Roo Code · VS Code (Copilot) · Windsurf · Continue · MiniMax Code

Anything else that speaks MCP over stdio can be pointed at the launcher manually.

## FAQ

**Is it free?**
Yes. Echo is free to use. If it earns a place in your workflow, you can [support development on Patreon](https://www.patreon.com/cw/xiar_drp).

**Does it use my own Chrome?**
No — Echo ships its own Chromium and keeps its own isolated profile. It never reads or modifies your personal browser data.

**Does it need admin rights?**
No. It installs per-user and configures things inside your own user profile. The only exception is if you deliberately choose to install it for all users.

**Which platforms?**
Windows first. macOS and Linux are configured in the build but not shipped yet.

**Is my data sent anywhere?**
No. Settings and browsing data stay on your machine. The only network calls Echo makes are update checks against this repository.

**What does it write to my machine?**
A single `echo` entry in the MCP config of the AI apps you already have installed, plus its own app data. Writes are atomic, a config that fails to parse is never overwritten, and app folders that do not exist are left alone. See [Security & privacy](#security--privacy).

**How do I uninstall it?**
Windows Settings → Apps → Echo → Uninstall. It automatically removes itself from every AI app's configuration.

## Open source

Echo is open source under the [MIT license](LICENSE), and the installer in [Releases](https://github.com/echo-browser-for-ai/echo/releases/latest) is built from this repository by GitHub Actions. Issues and pull requests are welcome.

The bundled browser extension's signing key is not published, because it fixes the extension's ID; the vendored runtime (Node, Chromium) is fetched by the build scripts rather than committed. Everything else is readable, buildable, and forkable.

### Run from source

Requires Node.js 20 or newer (CI uses 22) and Windows.

```bash
npm install
npm run dev
```

### Building the installer

The Windows installer is built in CI by [`.github/workflows/release.yml`](.github/workflows/release.yml) on a `windows-latest` runner, from this exact source — no local setup required, and no repository secrets.

- **Dry run:** Actions → *Release* → *Run workflow*. The installer is downloadable from the run page.
- **Release:** push a version tag, and CI builds and publishes it.

```bash
git tag v0.2.4 && git push origin v0.2.4
```

The Chromium engine is **not** built in CI. It is published separately as the `chromium-latest` prerelease, and the workflow downloads it and verifies its SHA-256 checksum before packaging.

Building locally is possible but requires staging the runtime first (portable `node.exe`, the vendored runtime `node_modules`, and the Chromium engine) into `build/installer/resources/`. The CI workflow above is the reference for exactly what to stage:

```bash
npx tsc && npx vite build && npx electron-builder --win nsis --x64 --publish never
```

Output lands in `release/EchoSetup/`.

## Security & privacy

- **Local-only.** Everything runs on your machine — no accounts, no telemetry. The only network calls Echo makes are update checks against this repository.
- **Your profile stays yours.** Echo keeps its own Chromium profile and never reads or modifies your personal browser data.
- **Config writes are the feature, and they are careful.** On launch, Echo adds a single `echo` entry to the MCP config of the AI apps you have installed. Writes are atomic (temp file, then rename), an existing config that fails to parse is never overwritten, and app folders that do not exist are left alone. Uninstalling Echo removes the `echo` entry from every config automatically.
- **Local server only.** Echo's settings server binds to `127.0.0.1`, and the bundled extension is only permitted to talk to `http://127.0.0.1:*/*`.
- **Unsigned installer.** The Windows installer is not code-signed yet, so SmartScreen may warn on first run — click **More info → Run anyway**, or build from source. Echo auto-updates silently once installed.

## Notes

- Bundled Chromium © The Chromium Authors, used under the BSD-3-Clause license.
- Agent tooling is provided by [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp), Microsoft's official Playwright MCP server.
- Website: <https://echo-browser-for-ai.github.io/>
