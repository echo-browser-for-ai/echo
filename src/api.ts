/**
 * API compatibility layer — replaces Electron's window.api with fetch() calls.
 *
 * The settings page now runs inside Chromium, not Electron. This module
 * provides the same API surface using HTTP requests to the Echo settings server
 * and native browser APIs instead of IPC.
 */

const API_BASE = `http://127.0.0.1:${location.port}`;

async function apiGet<T>(path: string): Promise<T> {
	const resp = await fetch(`${API_BASE}${path}`);
	return resp.json();
}

async function apiPost<T>(path: string, body?: any): Promise<T> {
	const resp = await fetch(`${API_BASE}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	return resp.json();
}

// Event emitter for theme/settings changes (using CustomEvent)
const listeners: Record<string, Array<(...args: any[]) => void>> = {};

function emit(event: string, ...args: any[]) {
	(listeners[event] || []).forEach((fn) => fn(...args));
}

function on(event: string, fn: (...args: any[]) => void): () => void {
	if (!listeners[event]) listeners[event] = [];
	listeners[event].push(fn);
	return () => {
		listeners[event] = listeners[event].filter((f) => f !== fn);
	};
}

// Poll settings every 2s for cross-tab sync (lightweight — just checks for changes)
let lastSettings: any = null;
setInterval(async () => {
	try {
		const s = await apiGet<any>("/api/settings");
		if (lastSettings && lastSettings.theme !== s.theme) {
			emit("theme:changed", s.theme);
			emit("settings:changed", { key: "theme", value: s.theme });
		}
		lastSettings = s;
	} catch {}
}, 2000);

const api = {
	showPrompt: (
		message: string,
		defaultValue?: string,
	): Promise<string | null> =>
		Promise.resolve(window.prompt(message, defaultValue || "")),

	navigate: (url: string): void => {
		window.open(url, "_self");
	},

	settings: {
		get: (): Promise<any> => apiGet("/api/settings"),
		set: async (key: string, value: any): Promise<any> => {
			const result = await apiPost("/api/settings", { key, value });
			// Emit events immediately so local components can react
			if (key === "theme") {
				emit("theme:changed", value);
				emit("settings:changed", { key: "theme", value });
			} else {
				emit("settings:changed", { key, value });
			}
			// Sync poll cache so next poll doesn't re-emit the same change
			if (lastSettings) lastSettings[key] = value;
			return result;
		},
		reset: (): Promise<any> => apiPost("/api/settings", { key: "__reset__" }),
		onThemeChanged: (callback: (theme: string) => void): (() => void) =>
			on("theme:changed", callback),
		onSettingsChanged: (
			callback: (data: { key: string; value: any }) => void,
		): (() => void) => on("settings:changed", callback),
	},

	app: {
		quit: (): void => {
			/* no-op in browser context */
		},
	},

	mcp: {
		register: (): Promise<any> => apiPost("/api/mcp/register"),
		unregister: (): Promise<any> => apiPost("/api/mcp/unregister"),
		status: (): Promise<any> => apiGet("/api/mcp/status"),
	},

	browser: {
		resetData: (): Promise<any> => apiPost("/api/browser/reset"),
	},

	updates: {
		getStatus: (): Promise<any> => apiGet("/api/updates/status"),
		checkApp: (): Promise<any> => apiPost("/api/updates/app/check"),
		installApp: (): Promise<any> => apiPost("/api/updates/app/install"),
		checkChromium: (): Promise<any> => apiPost("/api/updates/chromium/check"),
		applyChromium: (): Promise<any> => apiPost("/api/updates/chromium/install"),
	},

	shell: {
		open: (url: string): Window | null => window.open(url, "_blank"),
	},

	bookmarks: {
		list: (): Promise<any[]> => apiGet("/api/bookmarks"),
		add: (title: string, url: string, parentId?: string): Promise<any> =>
			apiPost("/api/bookmarks", { action: "add", title, url, parentId }),
		remove: (id: string): Promise<void> =>
			apiPost("/api/bookmarks", { action: "remove", id }),
		update: (id: string, updates: any): Promise<any> =>
			apiPost("/api/bookmarks", { action: "update", id, updates }),
		check: (url: string): Promise<any> =>
			apiGet(`/api/bookmarks/check?url=${encodeURIComponent(url)}`),
		getTree: (): Promise<any> => apiGet("/api/bookmarks/tree"),
		addFolder: (title: string, parentId: string): Promise<any> =>
			apiPost("/api/bookmarks", { action: "addFolder", title, parentId }),
		moveNode: (
			nodeId: string,
			newParentId: string,
			newOrder?: number,
		): Promise<boolean> =>
			apiPost("/api/bookmarks", {
				action: "move",
				nodeId,
				newParentId,
				newOrder,
			}),
		removeNode: (id: string): Promise<boolean> =>
			apiPost("/api/bookmarks", { action: "removeNode", id }),
		updateNode: (id: string, updates: any): Promise<any> =>
			apiPost("/api/bookmarks", { action: "updateNode", id, updates }),
		search: (query: string): Promise<any[]> =>
			apiGet(`/api/bookmarks/search?q=${encodeURIComponent(query)}`),
	},

	shortcuts: {
		list: (): Promise<any[]> => apiGet("/api/shortcuts"),
		add: (title: string, url: string): Promise<any> =>
			apiPost("/api/shortcuts", { action: "add", title, url }),
		update: (id: string, updates: any): Promise<any> =>
			apiPost("/api/shortcuts", { action: "update", id, updates }),
		remove: (id: string): Promise<boolean> =>
			apiPost("/api/shortcuts", { action: "remove", id }),
	},
};

// Make available globally (same interface as preload)
(window as any).api = api;

export default api;
