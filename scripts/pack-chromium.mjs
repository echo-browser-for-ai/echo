/**
 * pack-chromium.mjs — turn a Chromium snapshot into a publishable engine zip.
 *
 * Usage:
 *   node scripts/pack-chromium.mjs              # latest revision
 *   node scripts/pack-chromium.mjs 1664410       # a specific revision
 *
 * Steps:
 *   1. Resolve revision → download chrome-win.zip from GCS
 *   2. Extract → read version from chrome.dll
 *   3. Rename chrome.exe → EchoBrowser.exe, keep all other files
 *   4. Stamp Echo icon on EchoBrowser.exe, chrome.dll, chrome_elf.dll
 *   5. Copy initial_preferences next to EXE
 *   6. Re-zip (EchoBrowser.exe at zip root)
 *   7. Compute sha256 + write chromium-latest.json
 *
 * No compilation. No toolchain. Run on the build machine.
 */

import { createHash } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STAGING = path.join(ROOT, "release", ".engine-staging");
const OUTPUT = path.join(ROOT, "release");

// ── GCS URLs (chromium-browser-snapshots, BSD-3) ──────────────────
const LAST_CHANGE_URL =
	"https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Win_x64%2FLAST_CHANGE?alt=media";
const ZIP_URL = (rev) =>
	`https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Win_x64%2F${rev}%2Fchrome-win.zip?alt=media`;

// ── Tools ────────────────────────────────────────────────────────
const RCEDIT = path.join(
	ROOT,
	"node_modules",
	"rcedit",
	"bin",
	"rcedit-x64.exe",
);
const ICON = path.join(ROOT, "public", "icon.ico");
const INITIAL_PREFS = path.join(ROOT, "installer", "initial_preferences");

// ──────────────────────────────────────────────────────────────────

async function main() {
	const rev =
		process.argv[2] ??
		(await fetch(LAST_CHANGE_URL).then((r) => r.text())).trim();

	console.log(`Revision: ${rev}`);

	fs.mkdirSync(STAGING, { recursive: true });

	const zipPath = path.join(STAGING, `chrome-win-${rev}.zip`);
	const extractDir = path.join(STAGING, "chrome-win");

	// 1. Download
	console.log("Downloading chrome-win.zip (this may take a minute)…");
	const resp = await fetch(ZIP_URL(rev));
	if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
	const buf = Buffer.from(await resp.arrayBuffer());
	fs.writeFileSync(zipPath, buf);
	console.log(`Downloaded ${(buf.length / 1024 / 1024).toFixed(0)} MB`);

	// 2. Extract
	fs.rmSync(extractDir, { recursive: true, force: true });
	fs.mkdirSync(extractDir, { recursive: true });
	execSync(`tar -xf "${zipPath}" -C "${extractDir}"`, {
		stdio: "inherit",
		timeout: 120_000,
	});
	fs.rmSync(zipPath, { force: true });

	const chromeDir = path.join(extractDir, "chrome-win");
	if (!fs.existsSync(chromeDir))
		throw new Error(
			"Unexpected zip structure — expected chrome-win/ folder inside",
		);

	// 3. Read version from chrome.dll
	const chromeDll = path.join(chromeDir, "chrome.dll");
	let version = "0.0.0.0";
	try {
		const psOut = execSync(
			`powershell -NoProfile -Command "(Get-Item '${chromeDll}').VersionInfo.FileVersion"`,
			{ encoding: "utf-8", timeout: 10_000 },
		).trim();
		if (psOut) version = psOut;
	} catch {
		console.warn("Could not read version from chrome.dll — using fallback");
	}
	console.log(`Engine version: ${version}`);

	// 4. Rename chrome.exe → EchoBrowser.exe
	const oldExe = path.join(chromeDir, "chrome.exe");
	const newExe = path.join(chromeDir, "EchoBrowser.exe");
	if (fs.existsSync(oldExe)) {
		fs.renameSync(oldExe, newExe);
	}
	if (!fs.existsSync(newExe))
		throw new Error("EchoBrowser.exe not found after rename");

	// 5. Stamp Echo icon
	console.log("Stamping Echo icon…");
	for (const dll of ["EchoBrowser.exe", "chrome.dll", "chrome_elf.dll"]) {
		const p = path.join(chromeDir, dll);
		if (fs.existsSync(p)) execFileSync(RCEDIT, [p, "--set-icon", ICON]);
	}

	// 6. Copy initial_preferences
	if (fs.existsSync(INITIAL_PREFS)) {
		fs.copyFileSync(INITIAL_PREFS, path.join(chromeDir, "initial_preferences"));
	}

	// 7. Re-zip (contents of chromeDir, NOT the folder itself)
	const outZip = path.join(OUTPUT, `echo-chromium-${version}.zip`);
	const cwd = chromeDir;
	const entries = fs.readdirSync(cwd);
	// Use tar to create a zip from the DIRECTORY CONTENTS
	execSync(`tar -acf "${outZip}" ${entries.join(" ")}`, {
		cwd,
		stdio: "inherit",
		timeout: 120_000,
	});

	const zipStat = fs.statSync(outZip);
	const size = zipStat.size;
	console.log(`Zip: ${outZip} (${(size / 1024 / 1024).toFixed(0)} MB)`);

	// 8. Compute sha256
	const sha = await sha256File(outZip);
	console.log(`SHA-256: ${sha}`);

	// 9. Write chromium-latest.json
	const manifest = {
		version,
		revision: rev,
		url: "REPLACE_WITH_ECHO_RELEASES_DOWNLOAD_URL",
		sha256: sha,
		size,
		minAppVersion: "0.2.0",
		releaseNotes: `Chromium engine update (revision ${rev}).`,
		publishedAt: new Date().toISOString(),
	};
	const manifestPath = path.join(OUTPUT, "chromium-latest.json");
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
	console.log(`Manifest: ${manifestPath}`);

	// Cleanup staging
	fs.rmSync(extractDir, { recursive: true, force: true });

	console.log("\nDone. Next steps:");
	console.log(
		"1. Upload the zip to echo-releases as a chromium-<version> release",
	);
	console.log("2. Paste the download URL into chromium-latest.json");
	console.log(
		"3. Re-upload chromium-latest.json to the chromium-latest release",
	);
}

// ── Helpers ──────────────────────────────────────────────────────

async function sha256File(filePath) {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = fs.createReadStream(filePath);
		stream.on("data", (d) => hash.update(d));
		stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
		stream.on("error", reject);
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
