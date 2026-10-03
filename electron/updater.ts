// Wraps electron-updater. Keeps a small in-memory status object the HTTP API
// reads so the Updates tab can show progress without polling the updater directly.
import electronUpdater, {
	type AppUpdater,
	type UpdateInfo,
} from "electron-updater";
import { app, Notification } from "electron";

const { autoUpdater } = electronUpdater as unknown as {
	autoUpdater: AppUpdater;
};

export type AppState =
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "downloading"
	| "downloaded"
	| "error";

export interface AppUpdateStatus {
	currentVersion: string;
	latestVersion: string | null;
	state: AppState;
	progress: number; // 0..100 while downloading
	releaseNotes: string | null;
	error: string | null;
	lastCheckedAt: string | null;
}

let status: AppUpdateStatus = {
	currentVersion: app.getVersion(),
	latestVersion: null,
	state: "idle",
	progress: 0,
	releaseNotes: null,
	error: null,
	lastCheckedAt: null,
};

export function getAppUpdateStatus(): AppUpdateStatus {
	return { ...status };
}

export function initAppUpdater(): void {
	autoUpdater.autoDownload = true; // background-download as soon as an update is found
	autoUpdater.autoInstallOnAppQuit = false; // user clicks "Restart to update" explicitly

	autoUpdater.on("checking-for-update", () =>
		patch({ state: "checking", error: null }),
	);
	autoUpdater.on("update-not-available", () =>
		patch({ state: "up-to-date", lastCheckedAt: now() }),
	);
	autoUpdater.on("update-available", (info: UpdateInfo) =>
		patch({
			state: "available",
			latestVersion: info.version,
			releaseNotes: notes(info),
		}),
	);
	autoUpdater.on("download-progress", (p) =>
		patch({ state: "downloading", progress: Math.round(p.percent) }),
	);
	autoUpdater.on("update-downloaded", (info) => {
		patch({
			state: "downloaded",
			latestVersion: info.version,
			progress: 100,
			lastCheckedAt: now(),
		});
		notifyUpdateReady(info.version);
	});
	autoUpdater.on("error", (err) =>
		patch({
			state: "error",
			error: err ? String(err.message ?? err) : "Unknown update error",
		}),
	);
}

export async function checkForAppUpdates(): Promise<void> {
	await autoUpdater.checkForUpdates();
}

export async function installAppUpdate(
	killChromium: () => void,
): Promise<void> {
	if (status.state !== "downloaded")
		throw new Error("No downloaded update to install");
	killChromium();
	// isSilent=true so the NSIS updater runs WITHOUT popping the installer wizard
	// (directory-picker etc.). isForceRunAfter=true relaunches Echo after install.
	autoUpdater.quitAndInstall(true, true);
}

// ── Internals ──────────────────────────────────────────────

function patch(p: Partial<AppUpdateStatus>): void {
	status = { ...status, ...p };
}

function now(): string {
	return new Date().toISOString();
}

function notes(info: UpdateInfo): string | null {
	const n = info.releaseNotes;
	if (typeof n === "string") return n;
	if (Array.isArray(n))
		return (n as Array<{ note?: string }>).map((x) => x.note ?? "").join("\n");
	return null;
}

function notifyUpdateReady(version: string): void {
	try {
		if (Notification.isSupported()) {
			new Notification({
				title: "Echo update ready",
				body: `v${version} downloaded — open Settings → Updates to restart and apply.`,
				silent: true,
			}).show();
		}
	} catch {
		/* best-effort */
	}
}
