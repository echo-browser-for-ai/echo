/**
 * Echo — Tray-only settings server + Chromium launcher.
 *
 * Architecture:
 *   1. Sits in the system tray (no separate window)
 *   2. Serves the React settings UI via HTTP on a local port
 *   3. Launches bundled Chromium (EchoBrowser.exe) with CDP
 *   4. Chromium loads settings at http://127.0.0.1:{settingsPort}/
 *   5. Settings tab opens automatically on launch
 */

import { app, Tray, Menu, nativeImage, Notification } from "electron";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
	launchChrome,
	killChrome,
	getCdpPort,
	getChromePid,
	isChromeWindowHidden,
	hideChromeWindow,
	showChromeWindow,
} from "./chrome.js";
import { writeLockfile, deleteLockfile } from "./lockfile.js";
import { log } from "./log.js";
import {
	loadSettings,
	saveSettings,
	DEFAULT_SETTINGS,
	getConfigDir,
} from "./settings-store.js";
import {
	registerMcpConfigs,
	unregisterMcpConfigs,
	getMcpStatus,
	shouldAutoRegister,
} from "./mcp-registration.js";
import { registerIpc } from "./ipc/index.js";
import {
	openTab,
	hideChromiumWindow,
	showChromiumWindowNormal,
	isChromiumWindowVisible,
} from "./cdp-client.js";
import { applyStealth } from "./stealth.js";
import {
	initAppUpdater,
	checkForAppUpdates,
	getAppUpdateStatus,
	installAppUpdate,
} from "./updater.js";
import {
	checkForChromiumUpdate,
	getChromiumUpdateStatus,
	applyStagedChromium,
} from "./chromium-updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");

let appTray: Tray | null = null;
let settingsPort: number = 0;

// ── MIME types for static file serving ─────────────────────
const MIME: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".png": "image/png",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
	".json": "application/json",
	".woff2": "font/woff2",
};

// ── Settings API handlers ──────────────────────────────────
async function handleSettingsGet(_req: IncomingMessage, res: ServerResponse) {
	try {
		const settings = loadSettings();
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(settings));
	} catch (err) {
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: String(err) }));
	}
}

async function handleSettingsSet(req: IncomingMessage, res: ServerResponse) {
	try {
		const body = await readBody(req);
		const { key, value } = JSON.parse(body);
		const settings = loadSettings();

		// Handle reset
		if (key === "__reset__") {
			saveSettings({ ...DEFAULT_SETTINGS });
			log("api", "info", "settings reset to defaults");
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ...DEFAULT_SETTINGS }));
			return;
		}

		(settings as unknown as Record<string, unknown>)[key] = value;
		saveSettings(settings);
		log("api", "info", "setting changed", { key });

		// Apply theme
		if (key === "theme") {
			try {
				appTray?.setImage(getTrayIcon(value as string));
			} catch (e) {
				log("api", "warn", "failed to update tray icon", { err: String(e) });
			}
		}
		if (key === "openAtLogin") {
			// Skip in dev
			if (!process.env.VITE_DEV_SERVER_URL) {
				app.setLoginItemSettings(
					value
						? { openAtLogin: true, path: process.execPath, args: ["--hidden"] }
						: { openAtLogin: false },
				);
			}
		}

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(settings));
	} catch (err) {
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: String(err) }));
	}
}

async function handleMcpAction(action: string, res: ServerResponse) {
	try {
		let result: { success: boolean; output: string; exitCode: number | null };
		switch (action) {
			case "register":
				result = await registerMcpConfigs();
				break;
			case "unregister":
				result = await unregisterMcpConfigs();
				break;
			case "status":
				result = await getMcpStatus();
				break;
			default:
				result = { success: false, output: "Unknown action", exitCode: 1 };
		}
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(result));
	} catch (err) {
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({ success: false, output: String(err), exitCode: 1 }),
		);
	}
}

// ── Browser reset handler — wipes profile + relaunches ─────
async function handleBrowserReset(_req: IncomingMessage, res: ServerResponse) {
	// Respond FIRST so the settings tab gets the response before Chromium dies.
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ status: "resetting" }));
	// Then wipe + relaunch asynchronously.
	setTimeout(async () => {
		try {
			killChrome();
			const profileDir = join(app.getPath("userData"), "chrome-profile");

			// Safety guard: refuse to wipe unless the path looks like Echo's.
			// Real Chrome lives in %LOCALAPPDATA%\Google\Chrome, NOT %APPDATA%\Echo.
			if (!/[\\/]Echo[\\/]/i.test(profileDir)) {
				log(
					"api",
					"error",
					"REFUSING to wipe — profile path does not look like Echo's",
					{ profileDir },
				);
				notify(
					"Echo - Safety Stop",
					"Refused to clear data: profile path unexpected.",
				);
				return;
			}

			await rm(profileDir, { recursive: true, force: true });
			log("api", "info", "browsing data wiped", { profileDir });

			// Reset the first-run marker so the post-wipe launch behaves like a
			// fresh install (no session-restore of a now-deleted session).
			try {
				const markerPath = join(getConfigDir(), ".profile-initialized");
				await rm(markerPath, { force: true });
			} catch {
				/* best-effort */
			}

			const cdpPort = await launchChrome();
			await writeLockfile(cdpPort, process.pid, app.getVersion());
			await openTabInChrome(cdpPort, `http://127.0.0.1:${settingsPort}/`);
			log("api", "info", "browser restarted after wipe", { cdpPort });
		} catch (err) {
			log("api", "error", "browser reset failed", { err: String(err) });
		}
	}, 250);
}

// ── Static file serving (React SPA) ────────────────────────
const RENDERER_DIST = join(process.env.APP_ROOT!, "dist");

// New-tab page assets (served at /newtab). The extension overrides the new-tab
// page to point here, so users can open it directly if they bookmark it.
const NEWTAB_DIR = app.isPackaged
	? join(process.resourcesPath, "echo-extension")
	: join(
			process.env.APP_ROOT!,
			"build",
			"installer",
			"resources",
			"echo-extension",
		);

function serveStatic(req: IncomingMessage, res: ServerResponse) {
	let urlPath = (req.url || "/").split("?")[0];
	if (urlPath === "/") urlPath = "/index.html";

	const filePath = join(RENDERER_DIST, urlPath);
	const ext = extname(filePath).toLowerCase();

	try {
		if (existsSync(filePath)) {
			const content = readFileSync(filePath);
			res.writeHead(200, {
				"Content-Type": MIME[ext] || "application/octet-stream",
				"Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
			});
			res.end(content);
		} else {
			// SPA fallback — serve index.html for all non-file routes
			const indexPath = join(RENDERER_DIST, "index.html");
			const indexContent = readFileSync(indexPath);
			res.writeHead(200, {
				"Content-Type": "text/html",
				"Cache-Control": "no-cache",
			});
			res.end(indexContent);
		}
	} catch (err) {
		res.writeHead(500);
		res.end("Internal Server Error");
	}
}

// ── New-tab page serving ────────────────────────────────────
function serveNewtab(req: IncomingMessage, res: ServerResponse) {
	let urlPath = (req.url || "/newtab").split("?")[0];
	urlPath = urlPath.replace(/^\/newtab\/?/, "/");
	if (urlPath === "/") urlPath = "/newtab.html";
	const filePath = join(NEWTAB_DIR, urlPath);
	const ext = extname(filePath).toLowerCase();
	try {
		if (existsSync(filePath)) {
			const content = readFileSync(filePath);
			res.writeHead(200, {
				"Content-Type": MIME[ext] || "application/octet-stream",
				"Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
			});
			res.end(content);
		} else {
			res.writeHead(404);
			res.end("Not found");
		}
	} catch {
		res.writeHead(500);
		res.end("Internal Server Error");
	}
}

// ── Support page serving ────────────────────────────────────
function serveSupport(req: IncomingMessage, res: ServerResponse) {
	let urlPath = (req.url || "/support").split("?")[0];
	urlPath = urlPath.replace(/^\/support\/?/, "/");
	if (urlPath === "/") urlPath = "/support.html";
	// Map image requests to RENDERER_DIST
	if (urlPath === "/binance-bnb-qr.jpg") {
		const imgPath = join(RENDERER_DIST, "binance-bnb-qr.jpg");
		try {
			const content = readFileSync(imgPath);
			res.writeHead(200, {
				"Content-Type": "image/jpeg",
				"Cache-Control": "public, max-age=86400",
			});
			res.end(content);
			return;
		} catch {
			/* fall through */
		}
	}
	const filePath = join(RENDERER_DIST, urlPath);
	try {
		if (existsSync(filePath)) {
			const content = readFileSync(filePath);
			res.writeHead(200, {
				"Content-Type": MIME[extname(filePath).toLowerCase()] || "text/html",
				"Cache-Control": "no-cache",
			});
			res.end(content);
		} else {
			res.writeHead(404);
			res.end("Not found");
		}
	} catch {
		res.writeHead(500);
		res.end("Internal Server Error");
	}
}

// ── Body reader helper ─────────────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (chunk) => (data += chunk));
		req.on("end", () => resolve(data));
	});
}

// ── Chromium CDP helper ──────────────────────────────────────
/**
 * Open a URL in a new Chromium tab via CDP WebSocket.
 * Uses Target.createTarget — more reliable than the /json/new HTTP endpoint.
 */
async function openTabInChrome(cdpPort: number, url: string): Promise<void> {
	await openTab(cdpPort, url);
}

// ── Update route handlers ──────────────────────────────────

function handleUpdatesStatus(res: ServerResponse) {
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(
		JSON.stringify({
			app: getAppUpdateStatus(),
			chromium: getChromiumUpdateStatus(),
		}),
	);
}

function handleAppCheck(res: ServerResponse) {
	checkForAppUpdates().catch(() => {});
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ ok: true }));
}

async function handleAppInstall(res: ServerResponse) {
	try {
		await installAppUpdate(killChrome);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
	} catch (err) {
		res.writeHead(400, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: String(err) }));
	}
}

function handleChromiumCheck(res: ServerResponse) {
	checkForChromiumUpdate().catch(() => {});
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ ok: true }));
}

async function handleChromiumApply(res: ServerResponse) {
	try {
		await applyStagedChromium(async () => {
			killChrome();
			// Wait briefly for kill, then relaunch from new engine path
			await new Promise((r) => setTimeout(r, 2000));
			await launchChrome();
		});
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
	} catch (err) {
		res.writeHead(400, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: String(err) }));
	}
}

// ── HTTP Server (settings + API) ───────────────────────────
async function startSettingsServer(): Promise<number> {
	return new Promise((resolve) => {
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			// CORS — allow Chromium to access settings API
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type");

			if (req.method === "OPTIONS") {
				res.writeHead(200);
				res.end();
				return;
			}

			const url = req.url || "";

			// API routes
			if (url === "/api/settings" && req.method === "GET")
				return handleSettingsGet(req, res);
			if (url === "/api/settings" && req.method === "POST")
				return handleSettingsSet(req, res);
			if (url === "/api/mcp/register") return handleMcpAction("register", res);
			if (url === "/api/mcp/unregister")
				return handleMcpAction("unregister", res);
			if (url === "/api/mcp/status") return handleMcpAction("status", res);
			if (url === "/api/browser/reset" && req.method === "POST")
				return handleBrowserReset(req, res);

			// ── App auto-update routes ────────────────────────
			if (url === "/api/updates/status") return handleUpdatesStatus(res);
			if (url === "/api/updates/app/check" && req.method === "POST")
				return handleAppCheck(res);
			if (url === "/api/updates/app/install" && req.method === "POST")
				return handleAppInstall(res);

			if (url === "/api/updates/chromium/check" && req.method === "POST")
				return handleChromiumCheck(res);
			if (url === "/api/updates/chromium/install" && req.method === "POST")
				return handleChromiumApply(res);
			if (url === "/api/health") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: "ok" }));
				return;
			}

			if (url === "/newtab" || url.startsWith("/newtab/"))
				return serveNewtab(req, res);

			// Support / donate page
			if (url === "/support" || url.startsWith("/support/"))
				return serveSupport(req, res);

			// Static files + SPA fallback
			serveStatic(req, res);
		});

		// Try ports 9334-9340 (predictable range for extension discovery)
		function tryListen(portIndex: number) {
			if (portIndex > 6) {
				// Fallback: random port
				server.listen(0, "127.0.0.1", () => {
					settingsPort = (server.address() as { port: number }).port;
					log("server", "info", "settings server started on random port", {
						port: settingsPort,
					});
					resolve(settingsPort);
				});
				return;
			}
			const port = 9334 + portIndex;
			server.listen(port, "127.0.0.1", () => {
				settingsPort = port;
				log("server", "info", "settings server started", {
					port: settingsPort,
				});
				resolve(settingsPort);
			});
			server.on("error", () => tryListen(portIndex + 1));
		}
		tryListen(0);
	});
}

// ── Tray icon helper ───────────────────────────────────────
function getTrayIcon(theme?: string) {
	const iconName = theme === "light" ? "icon-light.png" : "icon.png";
	const iconPath = join(process.env.VITE_PUBLIC || RENDERER_DIST, iconName);
	return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
}

// ── Notification helper ─────────────────────────────────────
function notify(title: string, body: string) {
	try {
		if (Notification.isSupported()) {
			new Notification({ title, body, silent: true }).show();
		}
	} catch {
		// Notification API can fail silently — not critical
	}
}

// ── Main ───────────────────────────────────────────────────
async function main() {
	await app.whenReady();

	// Start settings HTTP server
	await startSettingsServer();

	// Write the settings port into the extension directory so the new-tab page
	// knows where to fetch the theme. echo-config.js is loaded by newtab.html.
	const extDir = app.isPackaged
		? join(process.resourcesPath, "echo-extension")
		: join(
				process.env.APP_ROOT!,
				"build",
				"installer",
				"resources",
				"echo-extension",
			);
	try {
		writeFileSync(
			join(extDir, "echo-config.js"),
			`// Generated by Echo — do not edit\nwindow.__ECHO_SETTINGS_PORT__ = ${settingsPort};\n`,
			"utf-8",
		);
	} catch (err) {
		log("main", "warn", "failed to write echo-config.js", { err: String(err) });
	}

	// Init the app auto-updater (checks for new versions on startup,
	// downloads in the background, never blocks launch).
	initAppUpdater();
	checkForAppUpdates().catch(() => {});
	// Re-check every 4 hours (non-blocking).
	setInterval(() => checkForAppUpdates().catch(() => {}), 4 * 60 * 60 * 1000);

	// Init the Chromium engine updater (checks for newer engines,
	// downloads + verifies in the background, never blocks launch).
	checkForChromiumUpdate().catch(() => {});
	// Re-check every 8 hours (engine releases are rare).
	setInterval(
		() => checkForChromiumUpdate().catch(() => {}),
		8 * 60 * 60 * 1000,
	);

	// Register IPC handlers (settings, bookmarks, shortcuts, etc.)
	registerIpc();

	// Auto-register Echo's MCP into every installed AI coding app's config.
	// Prod only, at most once every 7 days (see shouldAutoRegister).
	try {
		if (await shouldAutoRegister()) {
			log("main", "info", "auto-registering MCP configs into AI apps");
			const r = await registerMcpConfigs();
			log("main", "info", "MCP auto-register done", { success: r.success });
		}
	} catch (err) {
		log("main", "warn", "MCP auto-register failed", { err: String(err) });
	}

	// System tray
	const trayIcon = getTrayIcon();
	appTray = new Tray(trayIcon);
	appTray.setToolTip("Echo");

	/**
	 * Bring the Chromium window to the front. The echowin helper's "show"
	 * un-hides (a no-op when already visible) and activates the window.
	 * Without this the window is restored but stays behind whatever the user is
	 * looking at, so tray Show and double-click looked like they did nothing
	 * until the taskbar icon was clicked.
	 */
	async function raiseBrowserWindow(): Promise<void> {
		const pid = getChromePid();
		if (pid > 0) await showChromeWindow(pid);
	}

	const trayMenu = Menu.buildFromTemplate([
		{
			label: "Show/Hide Browser",
			click: async () => {
				try {
					const port = getCdpPort();
					if (port === 0) {
						await launchChrome();
						return;
					}
					if (isChromeWindowHidden()) {
						// Hidden via SW_HIDE — unhide via echowin, then maximize via CDP.
						const pid = getChromePid();
						if (pid > 0) {
							await showChromeWindow(pid);
						}
						const ok = await showChromiumWindowNormal();
						await raiseBrowserWindow();
						if (!ok) {
							notify("Echo - Error", "Could not restore browser window");
						}
					} else {
						const visible = await isChromiumWindowVisible();
						if (visible) {
							// Visible → hide via echowin SW_HIDE (fully gone, no taskbar).
							const pid = getChromePid();
							let hidden = false;
							if (pid > 0) {
								hidden = await hideChromeWindow(pid);
							}
							if (!hidden) {
								// echowin failed — fall back to CDP minimize (taskbar entry).
								log(
									"main",
									"warn",
									"echowin hide failed, falling back to CDP minimize",
								);
								await hideChromiumWindow();
							}
						} else {
							// Minimized to taskbar — restore + maximize via CDP.
							const ok = await showChromiumWindowNormal();
							await raiseBrowserWindow();
							if (!ok) {
								notify("Echo - Error", "Could not find browser window");
							}
						}
					}
				} catch (err) {
					log("main", "error", "show/hide browser error", { err: String(err) });
					notify(
						"Echo - Error",
						`Show/Hide Browser failed: ${String(err).slice(0, 200)}`,
					);
				}
			},
		},
		{
			label: "Show Settings",
			click: async () => {
				try {
					const port = getCdpPort();
					log("main", "info", "Show Settings clicked", { port, settingsPort });
					if (port > 0) {
						await openTabInChrome(port, `http://127.0.0.1:${settingsPort}/`);
					} else {
						const cdpPort = await launchChrome();
						await openTabInChrome(cdpPort, `http://127.0.0.1:${settingsPort}/`);
					}
				} catch (err) {
					log("main", "error", "failed to show settings", { err: String(err) });
					notify(
						"Echo - Error",
						`Show Settings failed: ${String(err).slice(0, 200)}`,
					);
				}
			},
		},
		{
			label: "Donate",
			click: async () => {
				try {
					let port = getCdpPort();
					if (port === 0) {
						// Browser dead — launch it (visible + maximized by default).
						port = await launchChrome();
					} else if (isChromeWindowHidden()) {
						// Hidden via echowin SW_HIDE — un-hide, then restore via CDP.
						const pid = getChromePid();
						if (pid > 0) await showChromeWindow(pid);
						await showChromiumWindowNormal();
						await raiseBrowserWindow();
					} else {
						// May be minimized to the taskbar — restore if so.
						const visible = await isChromiumWindowVisible();
						if (!visible) await showChromiumWindowNormal();
						await raiseBrowserWindow();
					}
					await openTabInChrome(
						port,
						`http://127.0.0.1:${settingsPort}/support`,
					);
					log("main", "info", "Donate page opened in browser", { port });
				} catch (err) {
					log("main", "error", "failed to open donate page", {
						err: String(err),
					});
					notify("Echo - Error", `Donate failed: ${String(err).slice(0, 200)}`);
				}
			},
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				killChrome();
				deleteLockfile().catch(() => {});
				app.quit();
			},
		},
	]);
	appTray.setContextMenu(trayMenu);

	appTray.on("double-click", async () => {
		try {
			let port = getCdpPort();
			if (port === 0) {
				port = await launchChrome();
			}
			if (isChromeWindowHidden()) {
				const pid = getChromePid();
				if (pid > 0) {
					await showChromeWindow(pid);
				}
			}
			await showChromiumWindowNormal();
			await raiseBrowserWindow();
			log("main", "info", "double-click: showed browser", { port });
		} catch (err) {
			log("main", "error", "failed to show browser on double-click", {
				err: String(err),
			});
		}
	});

	// Launch Chromium
	try {
		// If the uninstaller left a wipe sentinel, wipe our own profile now (correct
		// user + correct path) and reset the first-run marker so this launch is fresh.
		const sentinel = join(getConfigDir(), ".wipe-on-next-launch");
		if (existsSync(sentinel)) {
			const profileDir = join(app.getPath("userData"), "chrome-profile");
			if (/[\\/]echo[\\/]/i.test(profileDir)) {
				try {
					await rm(profileDir, { recursive: true, force: true });
					await rm(join(getConfigDir(), ".profile-initialized"), {
						force: true,
					});
					log("main", "info", "wiped profile on launch (uninstall sentinel)");
				} catch (err) {
					log("main", "warn", "sentinel wipe failed", { err: String(err) });
				}
			}
			try {
				await rm(sentinel, { force: true });
			} catch {
				/* best-effort */
			}
		}

		const cdpPort = await launchChrome();
		await writeLockfile(cdpPort, process.pid, app.getVersion());

		// Hide navigator.webdriver so websites don't flag Echo as a bot.
		// Best-effort — never blocks launch.
		applyStealth(cdpPort).catch((err) =>
			log("main", "warn", "stealth injector failed", { err: String(err) }),
		);
	} catch (err) {
		log("main", "error", "failed to launch Chromium", { err: String(err) });
		try {
			await writeLockfile(0, process.pid, app.getVersion());
		} catch {
			log("main", "warn", "failed to write zero lockfile on launch failure");
		}
	}
}

// ── App lifecycle ──────────────────────────────────────────
app.on("window-all-closed", () => {
	// Don't quit — tray app stays running
});

app.on("before-quit", () => {
	killChrome();
	deleteLockfile().catch(() => {});
});

app.on("activate", () => {
	// No window to restore — tray is always there
});

// ── Single-instance lock ────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.quit();
} else {
	app.on("second-instance", async () => {
		// Already running — open settings in Chromium
		try {
			const cdpPort = getCdpPort();
			if (cdpPort > 0) {
				await openTabInChrome(cdpPort, `http://127.0.0.1:${settingsPort}/`);
			} else {
				const newPort = await launchChrome();
				await openTabInChrome(newPort, `http://127.0.0.1:${settingsPort}/`);
			}
		} catch (err) {
			log("main", "error", "failed to open settings on second instance", {
				err: String(err),
			});
		}
	});

	main().catch((err) => {
		log("main", "error", "fatal — shutting down", { err: String(err) });
		process.exit(1);
	});
}
