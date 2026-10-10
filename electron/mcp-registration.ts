/**
 * MCP Config Registration — Electron wrapper.
 *
 * This is the Electron-aware face of Echo's MCP registration. The actual
 * multi-app install/uninstall/status logic lives in electron/mcp-shared.mjs
 * (Electron-free) so it can ALSO run standalone during NSIS uninstall via
 * resources/echo-mcp-cleanup.mjs. This file adds the only Electron-specific
 * bits:
 *   - getEchoEntry(): dev vs prod launcher paths (needs app.isPackaged)
 *   - settings timestamp (mcpRegisteredAt) after a successful register
 *   - shouldAutoRegister(): prod-only, every 7 days
 *
 * Three layers of defense (this module is the shared backend for 2 & 3):
 *   1. NSIS uninstall hook (hooks.nsh) → resources/echo-mcp-cleanup.mjs (standalone)
 *      [install registration is handled by layer 2, the app startup]
 *   2. Startup auto-registration — shouldAutoRegister() gate, called from main.ts
 *   3. Manual button in Settings UI — "Connect to AI apps" panel
 */

import path from "node:path";
import { app } from "electron";
import { loadSettings, saveSettings } from "./settings-store.js";
import {
	installAll,
	unregisterAll,
	getStatusAll,
	formatLines,
} from "./mcp-shared.mjs";

// Re-export shared types + EchoEntry for consumers (ipc, main, types/api.d.ts).
export type { AppStatus, AppStatusKind } from "./mcp-shared.mjs";
export interface EchoEntry {
	command: string;
	args: string[];
	/** Where echo-pdf-server.mjs lives, when it is not beside the launcher. */
	pdfServer?: string;
}

export interface RegistrationResult {
	success: boolean;
	output: string;
	exitCode: number | null;
	apps?: import("./mcp-shared.mjs").AppStatus[];
}

// ── Echo MCP entry (what we inject) ───────────────────────

const toWin = (p: string): string => p.replace(/\//g, "\\");

/** Dev-only project root. In dev the main process runs from a vite temp dir,
 *  so we can't reliably derive the repo path — hardcode (matches prior code). */
const DEV_PROJECT_ROOT = "C:/Users/uzair/Coding/Practice/July/01-Echo";

/** The canonical command + args each app should run to start Echo's MCP. */
export function getEchoEntry(): EchoEntry {
	if (!app.isPackaged) {
		// Dev: bundled node.exe + the dev launcher (finds node_modules at repo root)
		return {
			command: toWin(
				path.join(DEV_PROJECT_ROOT, "build/installer/resources/node.exe"),
			),
			args: [toWin(path.join(DEV_PROJECT_ROOT, "echo-mcp-launcher-dev.cjs"))],
			// The PDF server is staged under build/installer/resources, not at the
			// repo root where the dev launcher sits, so it is passed explicitly
			// instead of being derived from the launcher's directory.
			pdfServer: toWin(
				path.join(DEV_PROJECT_ROOT, "build/installer/resources/echo-pdf-server.mjs"),
			),
		};
	}
	// Production (installed) — use the REAL resources path. process.resourcesPath
	// resolves to <install>/resources, which is correct for BOTH per-user
	// (%LOCALAPPDATA%\Programs\Echo\resources) and per-machine installs.
	// Hardcoding "C:\Program Files\Echo" broke after the per-user move (ENOENT).
	return {
		command: toWin(path.join(process.resourcesPath, "node.exe")),
		args: [toWin(path.join(process.resourcesPath, "echo-mcp-launcher.js"))],
	};
}

// ── Public API (delegates to shared, Electron-free logic) ─

export async function registerMcpConfigs(): Promise<RegistrationResult> {
	const apps = await installAll(getEchoEntry());
	const success = apps.some((a) => a.status === "registered");
	if (success) {
		const settings = loadSettings();
		settings.mcpRegisteredAt = Date.now();
		saveSettings(settings);
	}
	return {
		success,
		output: formatLines(apps),
		exitCode: success ? 0 : 1,
		apps,
	};
}

export async function unregisterMcpConfigs(): Promise<RegistrationResult> {
	const apps = await unregisterAll();
	const success = apps.some(
		(a) =>
			a.status === "absent" ||
			a.status === "not-installed" ||
			a.status === "unsupported",
	);
	return {
		success,
		output: formatLines(apps),
		exitCode: success ? 0 : 1,
		apps,
	};
}

export async function getMcpStatus(): Promise<RegistrationResult> {
	const apps = await getStatusAll();
	return { success: true, output: formatLines(apps), exitCode: 0, apps };
}

/** Whether startup auto-registration should run. Prod only. Re-registers when
 *  the 7-day refresh timer expired OR when echo is unexpectedly missing/stale in
 *  any installed app — e.g. after an uninstall removed the entries, or a config
 *  was hand-edited. The earlier 7-day-only gate meant a reinstall wouldn't
 *  re-add echo for up to 7 days after an uninstall; this closes that gap. */
export async function shouldAutoRegister(): Promise<boolean> {
	if (!app.isPackaged) return false;
	const settings = loadSettings();
	const sevenDays = 7 * 24 * 60 * 60 * 1000;
	if (
		!settings.mcpRegisteredAt ||
		Date.now() - settings.mcpRegisteredAt > sevenDays
	)
		return true;
	// Timer hasn't expired — still re-register if echo is gone/stale anywhere it
	// should be (apps that simply aren't installed are reported 'not-installed'
	// and correctly ignored here).
	const apps = await getStatusAll();
	return apps.some((a) => a.status === "absent" || a.status === "stale");
}
