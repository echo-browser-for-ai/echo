/**
 * Chromium Updater — fetches chromium-latest.json from the public releases repo,
 * downloads a newer engine zip, verifies its sha256, extracts it, and
 * swaps active.json to point at the new version.
 *
 * Safety: automatic rollback after 3 consecutive launch failures.
 * Old versions are garbage-collected (keep active + 1 previous).
 */

import { app } from "electron";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import {
	readActive,
	writeActive,
	versionsDir,
	getBundledEngineVersion,
} from "./engine-store.js";
import { log } from "./log.js";

// ── Constants ──────────────────────────────────────────────

const MANIFEST_URL =
	"https://github.com/echo-browser-for-ai/echo/releases/download/chromium-latest/chromium-latest.json";

const LOCALAPPDATA = process.env.LOCALAPPDATA ?? app.getPath("home");
const ROOT = path.join(LOCALAPPDATA, "Echo");
const STATE_PATH = path.join(ROOT, "state.json");

// ── Types ──────────────────────────────────────────────────

export type ChromiumState =
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "downloading"
	| "downloaded"
	| "error";

export interface ChromiumUpdateStatus {
	currentVersion: string;
	latestVersion: string | null;
	state: ChromiumState;
	progress: number;
	releaseNotes: string | null;
	error: string | null;
	lastCheckedAt: string | null;
}

interface ChromiumManifest {
	version: string;
	url: string;
	sha256: string;
	size: number;
	minAppVersion: string;
	releaseNotes: string;
	publishedAt: string;
}

interface ChromiumStateFile {
	stagedVersion: string | null;
	lastCheckedAt: string | null;
}

const DEFAULT_STATE: ChromiumStateFile = {
	stagedVersion: null,
	lastCheckedAt: null,
};

let status: ChromiumUpdateStatus = {
	currentVersion: currentVersionString(),
	latestVersion: null,
	state: "idle",
	progress: 0,
	releaseNotes: null,
	error: null,
	lastCheckedAt: readStateFile().lastCheckedAt ?? null,
};

// ── Public API ─────────────────────────────────────────────

export function getChromiumUpdateStatus(): ChromiumUpdateStatus {
	return { ...status };
}

export async function checkForChromiumUpdate(): Promise<void> {
	patch({ state: "checking", error: null });

	let manifest: ChromiumManifest;
	try {
		const resp = await fetch(MANIFEST_URL);
		if (!resp.ok) {
			patch({ state: "up-to-date", lastCheckedAt: now() });
			patchState({ lastCheckedAt: now() });
			return;
		}
		manifest = (await resp.json()) as ChromiumManifest;
	} catch {
		patch({ state: "up-to-date", lastCheckedAt: now() });
		patchState({ lastCheckedAt: now() });
		return;
	}

	const current = currentVersionString();
	if (!isNewer(manifest.version, current)) {
		patch({
			state: "up-to-date",
			latestVersion: manifest.version,
			lastCheckedAt: now(),
		});
		patchState({ lastCheckedAt: now() });
		return;
	}

	if (!satisfiesMinApp(manifest.minAppVersion)) {
		patch({
			state: "error",
			error: `Engine update requires Echo ${manifest.minAppVersion}+ (you have ${app.getVersion()})`,
			lastCheckedAt: now(),
		});
		patchState({ lastCheckedAt: now() });
		return;
	}

	patch({
		state: "available",
		latestVersion: manifest.version,
		releaseNotes: manifest.releaseNotes,
	});

	// Auto-download in background
	try {
		await downloadAndStage(manifest);
	} catch (err) {
		patch({ state: "error", error: String(err) });
	}
}

export async function applyStagedChromium(
	killAndRelaunch: () => Promise<void>,
): Promise<void> {
	const state = readStateFile();
	const staged = state.stagedVersion;
	if (!staged) throw new Error("No engine update staged");

	const prev = readActive();
	writeActive({
		version: staged,
		verified: false,
		installedAt: new Date().toISOString(),
		failCount: 0,
	});

	log("chromium-updater", "info", "switched active engine", {
		from: prev.version,
		to: staged,
	});

	await killAndRelaunch();
}

export function markEngineVerified(): void {
	const a = readActive();
	if (a.verified) return;

	writeActive({ ...a, verified: true, failCount: 0 });
	gcOldVersions(a.version);
	log("chromium-updater", "info", "engine verified", { version: a.version });

	// Clear staged flag since it's now the active verified version
	patchState({ stagedVersion: null });
	patch({ state: "up-to-date" });
}

export function maybeRollbackEngine(): boolean {
	const a = readActive();
	if (a.version === "bundled") return false;

	const next = { ...a, failCount: a.failCount + 1 };
	if (next.failCount >= 3) {
		log("chromium-updater", "error", "engine rollback triggered", {
			failedVersion: a.version,
			failCount: next.failCount,
		});
		writeActive({
			version: "bundled",
			verified: true,
			installedAt: "",
			failCount: 0,
		});
		patchState({ stagedVersion: null });
		return true;
	}

	writeActive(next);
	return false;
}

// ── Internals ──────────────────────────────────────────────

async function downloadAndStage(manifest: ChromiumManifest): Promise<void> {
	patch({ state: "downloading", progress: 0 });

	const stagingDir = path.join(ROOT, ".staging");
	fs.mkdirSync(stagingDir, { recursive: true });

	const zipPath = path.join(stagingDir, `${manifest.version}.zip`);
	await downloadWithProgress(manifest.url, zipPath, manifest.size, (pct) =>
		patch({ progress: pct }),
	);

	// Verify checksum
	const actual = await sha256File(zipPath);
	if (actual !== manifest.sha256.toLowerCase()) {
		fs.rmSync(zipPath, { force: true });
		throw new Error(
			`Checksum mismatch (expected ${manifest.sha256.slice(0, 8)}…, got ${actual.slice(0, 8)}…)`,
		);
	}

	// Extract to a temp dir, then atomically rename
	const target = path.join(versionsDir(), manifest.version);
	const targetTmp = target + ".tmp";
	fs.rmSync(targetTmp, { recursive: true, force: true });

	await extractZip(zipPath, targetTmp);
	fs.rmSync(zipPath, { force: true });

	// Replace existing version if present, then rename tmp → final
	fs.rmSync(target, { recursive: true, force: true });
	fs.renameSync(targetTmp, target);

	patchState({ stagedVersion: manifest.version });
	patch({
		state: "downloaded",
		progress: 100,
		latestVersion: manifest.version,
		lastCheckedAt: now(),
	});
}

/** Stream-download a URL to disk, calling onProgress(pct 0..100). */
async function downloadWithProgress(
	url: string,
	dest: string,
	totalSize: number,
	onProgress: (pct: number) => void,
): Promise<void> {
	const resp = await fetch(url);
	if (!resp.ok || !resp.body)
		throw new Error(`Download failed (HTTP ${resp.status})`);

	const file = fs.createWriteStream(dest);
	const reader = resp.body.getReader();
	let downloaded = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			downloaded += value.byteLength;
			file.write(Buffer.from(value));
			onProgress(Math.round((downloaded / totalSize) * 100));
		}
	} finally {
		file.end();
		reader.releaseLock();
	}
}

/** SHA-256 hash of a file as a lowercase hex string. */
async function sha256File(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = fs.createReadStream(filePath);
		stream.on("data", (d) => hash.update(d));
		stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
		stream.on("error", reject);
	});
}

/** Extract a zip file using Windows 10+ built-in tar (handles zip). */
function extractZip(zipPath: string, destDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		fs.mkdirSync(destDir, { recursive: true });
		execFile(
			"tar",
			["-xf", zipPath, "-C", destDir],
			{ timeout: 120_000 },
			(err) => {
				if (err) reject(new Error(`tar extract failed: ${err.message}`));
				else resolve();
			},
		);
	});
}

/** Compare two 4-part version strings (e.g. "152.0.7952.1" > "152.0.7952.0"). */
function isNewer(a: string, b: string): boolean {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 4; i++) {
		if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
		if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
	}
	return false; // equal
}

function satisfiesMinApp(minVersion: string): boolean {
	return !isNewer(minVersion, app.getVersion());
}

function currentVersionString(): string {
	const active = readActive();
	if (active.version !== "bundled") return active.version;
	return getBundledEngineVersion();
}

/** Delete old engine versions — keep the active version + 1 previous + bundled. */
function gcOldVersions(keepVersion: string): void {
	const dir = versionsDir();
	if (!fs.existsSync(dir)) return;

	const entries = fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort((a, b) => (isNewer(b, a) ? 1 : -1)); // newest first

	// Find the previous version (second-newest, not counting `keepVersion`)
	const others = entries.filter((v) => v !== keepVersion);

	// Keep: the active version + the newest previous version
	// Delete everything else
	const keep = new Set([keepVersion]);
	if (others.length > 0) keep.add(others[0]);

	for (const entry of entries) {
		if (keep.has(entry)) continue;
		const p = path.join(dir, entry);
		fs.rmSync(p, { recursive: true, force: true });
		log("chromium-updater", "info", "gc old engine version", {
			version: entry,
		});
	}
}

// ── State file (non-atomic — low stakes, only stagedVersion + timestamp) ──

function readStateFile(): ChromiumStateFile {
	try {
		return {
			...DEFAULT_STATE,
			...JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")),
		};
	} catch {
		return { ...DEFAULT_STATE };
	}
}

function patchState(p: Partial<ChromiumStateFile>): void {
	const prev = readStateFile();
	const next = { ...prev, ...p };
	fs.mkdirSync(ROOT, { recursive: true });
	fs.writeFileSync(STATE_PATH, JSON.stringify(next), "utf-8");
}

// ── Status helpers ─────────────────────────────────────────

function patch(p: Partial<ChromiumUpdateStatus>): void {
	status = { ...status, ...p };
}

function now(): string {
	return new Date().toISOString();
}
