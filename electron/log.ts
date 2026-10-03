import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

/**
 * Tagged logger for the Electron main process.
 *
 * Every log line identifies which module generated it. In main-process Electron,
 * process.stderr.write() outputs to the terminal where `npm run dev` is running.
 * Logs are also appended to ~/.echo/logs/echo.log for offline inspection.
 *
 * Usage:
 *   log('tabs', 'info', 'created tab', { id: 3, url: 'https://...' })
 *   log('bookmarks', 'error', 'failed to save', { err: 'ENOENT' })
 *
 * Output:
 *   [HH:MM:SS.mmm] [tabs:info] created tab id=3 url=https://…
 */

type Level = "info" | "warn" | "error" | "debug";

function formatValue(v: unknown): string {
	if (typeof v === "string") return v.length > 100 ? v.slice(0, 100) + "…" : v;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (v === null) return "null";
	if (v === undefined) return "undefined";
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}

function appendToLogFile(line: string): void {
	try {
		const configDir = path.join(homedir(), ".echo");
		const logsDir = path.join(configDir, "logs");
		const logFile = path.join(logsDir, "echo.log");

		mkdirSync(logsDir, { recursive: true });

		// Size cap: if > 5 MB, rename current to .old
		try {
			const st = statSync(logFile);
			if (st.size > 5 * 1024 * 1024) {
				renameSync(logFile, path.join(logsDir, "echo.log.old"));
			}
		} catch {
			// File doesn't exist yet or rename failed — ignore
		}

		appendFileSync(logFile, line + "\n", "utf-8");
	} catch {
		// File logging is best-effort — never throw
	}
}

export function log(
	tag: string,
	level: Level,
	message: string,
	data?: Record<string, unknown>,
): void {
	const ts = new Date().toISOString().slice(11, 23);
	let line = `[${ts}] [${tag}:${level}] ${message}`;

	if (data) {
		const parts = Object.entries(data)
			.filter(([, v]) => v !== undefined && v !== null)
			.map(([k, v]) => `${k}=${formatValue(v)}`);
		if (parts.length > 0) line += " | " + parts.join(" ");
	}

	process.stderr.write(line + "\n");

	// Best-effort file append alongside stderr
	appendToLogFile(line);
}
