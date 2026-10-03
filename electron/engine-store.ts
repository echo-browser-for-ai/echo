/**
 * Engine Store — owns the %LOCALAPPDATA%\Echo\ folder.
 *
 * Phase 2 (now): answers "which Chromium engine should I launch?".
 * On a fresh install this is always the bundled engine. Phase 3 will
 * flip active.json to point at a downloaded newer version.
 *
 * Phase 3 (later): chromium-updater.ts downloads new versions into
 * %LOCALAPPDATA%\Echo\chromium\<ver>\ and flips active.json. This
 * module just reads the pointer — it has no opinion on how versions
 * get there.
 */

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ── Paths ──────────────────────────────────────────────────

const LOCALAPPDATA = process.env.LOCALAPPDATA ?? app.getPath("home");
const ROOT = path.join(LOCALAPPDATA, "Echo");
const VERSIONS = path.join(ROOT, "chromium");
const ACTIVE_PATH = path.join(ROOT, "active.json");

// ── Types ──────────────────────────────────────────────────

export interface ActiveEngine {
	version: string; // "bundled" | "152.0.7952.1" | …
	verified: boolean; // passed health check since install?
	installedAt: string; // ISO
	failCount: number; // consecutive launch failures (rollback trigger)
}

const DEFAULT_ACTIVE: ActiveEngine = {
	version: "bundled",
	verified: true,
	installedAt: "",
	failCount: 0,
};

// ── Public API ─────────────────────────────────────────────

/**
 * Resolve the EXE path for the active engine.
 * Falls back to the bundled engine if the active version is missing.
 */
export function getActiveChromiumPath(): string {
	const active = readActive();
	if (active.version !== "bundled") {
		const exe = path.join(VERSIONS, active.version, "EchoBrowser.exe");
		if (fs.existsSync(exe)) return exe;
		// Staged version folder exists but no EXE → fall through to bundled
	}
	return bundledExePath();
}

/**
 * Read the bundled engine's version from its own .manifest file.
 * Used to report "current engine version" in the UI.
 */
export function getBundledEngineVersion(): string {
	const base = app.isPackaged
		? path.join(process.resourcesPath, "chromium")
		: path.join(
				getDirname(),
				"..",
				"build",
				"installer",
				"resources",
				"chromium",
			);
	const entries = fs.readdirSync(base);
	const manifest = entries.find((f) => f.endsWith(".manifest"));
	return manifest?.replace(/\.manifest$/, "") ?? "unknown";
}

export function readActive(): ActiveEngine {
	try {
		const raw = fs.readFileSync(ACTIVE_PATH, "utf-8");
		return { ...DEFAULT_ACTIVE, ...JSON.parse(raw) };
	} catch {
		return { ...DEFAULT_ACTIVE };
	}
}

export function writeActive(next: ActiveEngine): void {
	ensureDir(ROOT);
	const tmp = ACTIVE_PATH + ".tmp";
	fs.writeFileSync(tmp, JSON.stringify(next), "utf-8");
	fs.renameSync(tmp, ACTIVE_PATH);
}

export function versionsDir(): string {
	return VERSIONS;
}

// ── Internals ──────────────────────────────────────────────

function bundledExePath(): string {
	const base = app.isPackaged
		? path.join(process.resourcesPath, "chromium")
		: path.join(
				getDirname(),
				"..",
				"build",
				"installer",
				"resources",
				"chromium",
			);
	return path.join(base, "EchoBrowser.exe");
}

function ensureDir(dir: string): void {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getDirname(): string {
	return path.dirname(fileURLToPath(import.meta.url));
}
