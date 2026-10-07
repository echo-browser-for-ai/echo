/**
 * Chrome Manager — launches bundled Chromium (EchoBrowser.exe) with CDP enabled,
 * health-checks it, watches for crashes, and kills it on Echo exit.
 *
 * The bundled Chromium is a renamed chrome.exe with an isolated user-data-dir.
 * It's kept in resources/chromium/ (production) or build/installer/resources/chromium/ (dev).
 */

import { spawn, ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { log } from "./log.js";
import { writeLockfile } from "./lockfile.js";
import { getConfigDir } from "./settings-store.js";
import { getActiveChromiumPath } from "./engine-store.js";
import { markEngineVerified, maybeRollbackEngine } from "./chromium-updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let chromeChild: ChildProcess | null = null;
let cdpPort: number = 0;
let forceQuit = false;
let windowHidden = false;

/**
 * Find the active Chromium engine executable.
 * Delegates to engine-store.ts, which checks active.json first
 * (Phase 3 downloads will live in %LOCALAPPDATA%\Echo\chromium\)
 * and falls back to the bundled engine.
 */
export function findChromiumPath(): string {
	return getActiveChromiumPath();
}

/**
 * Get a free TCP port — avoids conflicts with other processes.
 */
function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createNetServer();
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as { port: number }).port;
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}

/**
 * Path to the bundled native window hide/show helper. Avoids PowerShell, which
 * is crippled on this machine (its Security module won't load).
 */
function echowinExePath(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, "echowin.exe")
		: path.join(
				__dirname,
				"..",
				"build",
				"installer",
				"resources",
				"echowin.exe",
			);
}

/**
 * Run echowin.exe to hide (SW_HIDE) or show all top-level windows owned by the
 * Chromium process. SW_HIDE fully removes the window from screen AND the
 * taskbar (CDP minimize only minimizes to the taskbar). "show" also brings the
 * window to the FRONT: showing without activating left it behind whatever the
 * user was looking at, so tray Show looked like it did nothing until they
 * clicked the taskbar icon. Returns true if echowin acted on >=1 window.
 */
function runWinHelper(pid: number, action: "hide" | "show"): Promise<boolean> {
	const code = action === "hide" ? "0" : "5";
	return new Promise<boolean>((resolve) => {
		let attempts = 0;
		const maxAttempts = 10;

		const tryOnce = () => {
			const child = spawn(echowinExePath(), [String(pid), code], {
				windowsHide: true,
			});
			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf-8");
			});
			child.on("close", (exitCode) => {
				const ok = exitCode === 0;
				if (!ok && exitCode === 1 && attempts < maxAttempts) {
					// Window not found yet (exit 1 = no windows for this PID).
					// Chromium's window may take a moment to appear after CDP
					// responds — retry every 500ms up to 5 seconds total.
					attempts++;
					setTimeout(tryOnce, 500);
					return;
				}
				log(
					"chrome",
					ok ? "info" : "warn",
					`echowin ${action} ${ok ? "ok" : "no-windows/failed"}`,
					{ pid, exitCode, stderr: stderr.slice(0, 200), attempts },
				);
				resolve(ok);
			});
			child.on("error", (err) => {
				log("chrome", "error", `echowin ${action} spawn error`, {
					err: String(err),
				});
				resolve(false);
			});
		};

		tryOnce();
	});
}

/** Hide all Chromium windows via SW_HIDE (fully gone — no screen, no taskbar). */
export async function hideChromeWindow(pid: number): Promise<boolean> {
	const ok = await runWinHelper(pid, "hide");
	if (ok) windowHidden = true;
	return ok;
}

/** Show Chromium's window and bring it to the front (un-hides if hidden). */
export async function showChromeWindow(pid: number): Promise<boolean> {
	const ok = await runWinHelper(pid, "show");
	if (ok) windowHidden = false;
	return ok;
}

/** True if the Chromium window was hidden via hideChromeWindow(). */
export function isChromeWindowHidden(): boolean {
	return windowHidden;
}

/** The Chromium process ID, or 0 if not running. */
export function getChromePid(): number {
	return chromeChild?.pid ?? 0;
}

/**
 * Launch bundled Chromium with CDP enabled.
 * Uses an isolated user-data-dir so it doesn't conflict with the user's real Chrome.
 * Returns the CDP port number.
 */
export async function launchChrome(opts?: {
	hidden?: boolean;
}): Promise<number> {
	// Check if already running
	if (chromeChild && !chromeChild.killed && chromeChild.exitCode === null) {
		log("chrome", "info", "Chromium already running", {
			pid: chromeChild.pid,
			cdpPort,
		});
		return cdpPort;
	}

	const hidden = opts?.hidden === true;
	forceQuit = false;

	const chromePath = findChromiumPath();
	if (!existsSync(chromePath)) {
		log("chrome", "error", "Chromium not found", { path: chromePath });
		throw new Error(`Chromium not found at ${chromePath}`);
	}

	cdpPort = await getFreePort();
	const userDataDir = path.join(app.getPath("userData"), "chrome-profile");

	// Load the Echo new-tab extension UNPACKED. This is the reliable way to
	// override the new-tab page — the .crx external-extension approach failed
	// silently in the installed app. Tradeoff: Chromium shows a small
	// "developer mode extensions" banner (acceptable; the only fully-clean fix
	// is compile-time Chromium branding, deferred).
	const extDir = !app.isPackaged
		? path.join(
				__dirname,
				"..",
				"build",
				"installer",
				"resources",
				"echo-extension",
			)
		: path.join(process.resourcesPath, "echo-extension");

	// First-run detection: only restore-last-session when the profile has been
	// initialized before. A fresh install or post-wipe launch starts clean.
	const markerPath = path.join(getConfigDir(), ".profile-initialized");
	const firstRun = !existsSync(markerPath);

	log("chrome", "info", "launching Chromium", {
		chromePath,
		cdpPort,
		userDataDir,
	});

	const flags: string[] = [
		`--remote-debugging-port=${cdpPort}`,
		`--user-data-dir=${userDataDir}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-networking",
		"--disable-component-update",
		"--disable-sync",
		"--disable-features=Translate,TranslateUI",
		"--window-name=Echo",
		hidden ? "--start-minimized" : "--start-maximized",
		`--load-extension=${extDir}`,
		"--whitelisted-extension-id=hbeodjhlegljggmgdgeppeegecgfimai",
	];

	// Only restore session when this is NOT the first launch (avoids
	// stale-tab-restore annoyance on fresh install / post-wipe).
	if (!firstRun) flags.push("--restore-last-session");

	chromeChild = spawn(chromePath, flags, {
		detached: false,
		stdio: "ignore",
		windowsHide: false,
	});

	// Watchdog: respawn if Chromium crashes
	let rapidExitCount = 0;
	chromeChild.on("exit", (code, signal) => {
		log("chrome", "warn", "Chromium exited", { code, signal });

		// Mark the port dead immediately so the MCP launcher self-heals.
		chromeChild = null;
		cdpPort = 0;
		windowHidden = false;
		writeLockfile(0, process.pid, app.getVersion()).catch(() => {});

		if (forceQuit) {
			log("chrome", "info", "Echo is quitting — not respawning");
			return;
		}

		// Exit code 0 = the user closed the window (X). Restart Chromium and HIDE
		// it via echowin.exe (SW_HIDE) so it disappears to tray while staying
		// alive → MCP/CDP never drop. (The tray "Hide Browser" action hides
		// without exiting, so it hits no restart; this branch only fires on an
		// actual X-close.)
		if (code === 0 && !signal) {
			log(
				"chrome",
				"info",
				"Chromium window closed — restarting hidden for MCP",
			);
			launchChrome({ hidden: true })
				.then(async () => {
					const newPid = chromeChild?.pid;
					if (newPid && newPid > 0) {
						const hidden = await hideChromeWindow(newPid);
						log(
							"chrome",
							hidden ? "info" : "warn",
							hidden
								? "Chromium restarted hidden — MCP alive"
								: "Chromium restarted but hide failed (visible)",
							{ newPid },
						);
					}
				})
				.catch((err) => {
					log(
						"chrome",
						"error",
						"failed to restart Chromium after window close",
						{ err: String(err) },
					);
				});
			return;
		}

		// Crash (non-zero exit / signal) → respawn, with crash-loop protection.
		rapidExitCount++;
		if (rapidExitCount > 3) {
			// Before giving up, try rolling back to the bundled engine if
			// a staged version is the one that's crashing.
			const rolledBack = maybeRollbackEngine();
			log(
				"chrome",
				"error",
				"Chromium crash loop detected — stopping respawn",
				{ rapidExitCount, rolledBack },
			);
			chromeChild = null;
			cdpPort = 0;
			writeLockfile(0, process.pid, app.getVersion()).catch(() => {});

			if (rolledBack) {
				// Re-launch once from the rolled-back (bundled) engine.
				setTimeout(() => {
					launchChrome().catch((err) => {
						log("chrome", "error", "post-rollback launch failed", {
							err: String(err),
						});
					});
				}, 2000);
			}
			return;
		}

		const delay = rapidExitCount > 1 ? 5000 * rapidExitCount : 1000;
		log("chrome", "info", "respawning Chromium", {
			delay,
			attempt: rapidExitCount,
		});
		setTimeout(() => {
			launchChrome().catch((err) => {
				log("chrome", "error", "failed to respawn Chromium", {
					err: String(err),
				});
			});
		}, delay);
	});

	await waitForChrome(cdpPort);
	log("chrome", "info", "Chromium launched successfully", {
		cdpPort,
		pid: chromeChild.pid,
	});

	// Tell the chromium updater the engine is healthy (clears its
	// failure counter and garbage-collects old versions).
	markEngineVerified();

	// Write the first-run marker AFTER the first successful launch. Future
	// launches will include --restore-last-session, so tabs come back.
	if (firstRun) {
		try {
			writeFileSync(markerPath, "");
		} catch {
			/* best-effort */
		}
	}
	// Keep the lockfile in sync with the ACTUAL running CDP port. This runs on
	// first launch, on watchdog crash-respawn, AND on tray relaunch — so the
	// standalone MCP launcher (and every AI app) always hits the live Chromium.
	// Without this the lockfile goes stale after any relaunch → ECONNREFUSED.
	await writeLockfile(cdpPort, process.pid, app.getVersion()).catch(() => {});
	return cdpPort;
}

/**
 * Health check: poll /json/version until Chromium responds.
 */
async function waitForChrome(port: number, timeoutMs = 15000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
				signal: AbortSignal.timeout(1000),
			});
			if (resp.ok) return;
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(
		`Chromium did not respond within ${timeoutMs}ms on port ${port}`,
	);
}

/**
 * Kill Chromium cleanly. Called on Echo exit.
 */
export function killChrome(): void {
	forceQuit = true;
	windowHidden = false;
	if (chromeChild && !chromeChild.killed) {
		try {
			chromeChild.kill();
			log("chrome", "info", "Chromium killed");
		} catch (err) {
			log("chrome", "error", "failed to kill Chromium", { err: String(err) });
		}
	}
	chromeChild = null;
	cdpPort = 0;
}

/**
 * Get the current CDP port (0 if not running).
 */
export function getCdpPort(): number {
	return cdpPort;
}

/**
 * Check if Chromium is currently running.
 */
export function isChromeRunning(): boolean {
	return (
		chromeChild !== null && !chromeChild.killed && chromeChild.exitCode === null
	);
}
