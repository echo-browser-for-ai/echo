import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "./log.js";

// Only settings that are actually wired into the backend are kept here.
// The ~15 toggles from the pre-pivot browser shell (hideOnClose, blockPopups,
// showBookmarkBar, defaultSearch, defaultZoom, spoofUA, hideWebdriver, doNotTrack,
// autoShareSessions, visionEnabled, developerMode, experimentalFeatures,
// adBlockerEnabled, forceDarkWebContents, lastBookmarkFolder) were dead — used in
// 0 backend files — and were removed 2026-07-17.
export interface AppSettings {
	openAtLogin: boolean;
	theme: "dark" | "light";
	mcpRegisteredAt: number | null;
}

export const DEFAULT_SETTINGS = {
	openAtLogin: false,
	theme: "dark",
	mcpRegisteredAt: null,
} as const;

function getSettingsPath(): string {
	const dir = path.join(os.homedir(), ".echo");
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, "settings.json");
}

/** Echo's config directory (~/.echo) — shared path for markers & lockfile. */
export function getConfigDir(): string {
	const dir = path.join(os.homedir(), ".echo");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

export function loadSettings(): AppSettings {
	try {
		const raw = fs.readFileSync(getSettingsPath(), "utf-8");
		const parsed = JSON.parse(raw);
		return { ...DEFAULT_SETTINGS, ...parsed } as AppSettings;
	} catch {
		return { ...DEFAULT_SETTINGS } as AppSettings;
	}
}

export function saveSettings(settings: AppSettings): void {
	try {
		fs.writeFileSync(getSettingsPath(), JSON.stringify(settings), "utf-8");
	} catch (err) {
		log("settings", "error", "failed to save settings", { err: String(err) });
	}
}
