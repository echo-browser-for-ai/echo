export interface Settings {
	openAtLogin: boolean;
	theme: "dark" | "light";
	mcpRegisteredAt?: number;
}

export interface TabInfo {
	id: number;
	targetId: string;
	url: string;
	title: string;
	active: boolean;
	pinned?: boolean;
	loading: boolean;
	favicon?: string;
}

export interface Shortcut {
	id: string;
	title: string;
	url: string;
	order: number;
}

export interface Bookmark {
	id: string;
	title: string;
	url: string;
	order: number;
	dateAdded: number;
}

export interface BookmarkNode {
	id: string;
	title: string;
	url?: string;
	children?: BookmarkNode[];
	dateAdded: number;
	dateModified?: number;
	order: number;
}

export interface BookmarkTree {
	version: 2;
	roots: {
		bookmarkBar: BookmarkNode;
		other: BookmarkNode;
	};
}

export interface McpAppStatus {
	id: string;
	name: string;
	status:
		| "registered"
		| "stale"
		| "absent"
		| "not-installed"
		| "unsupported"
		| "error";
	path?: string;
	note?: string;
}

export interface McpResult {
	success: boolean;
	output: string;
	exitCode: number | null;
	apps?: McpAppStatus[];
}

export interface BrowserApi {
	showPrompt: (
		message: string,
		defaultValue?: string,
	) => Promise<string | null>;
	navigate: (url: string) => Promise<void>;
	back: () => Promise<void>;
	forward: () => Promise<void>;
	reload: () => Promise<void>;
	getCurrentUrl: () => Promise<string>;
	settings: {
		get: () => Promise<Settings>;
		set: (key: string, value: any) => Promise<Settings>;
		reset: () => Promise<Settings>;
		onThemeChanged: (callback: (theme: string) => void) => () => void;
		onSettingsChanged?: (
			callback: (data: { key: string; value: any }) => void,
		) => () => void;
	};
	app: {
		quit: () => Promise<void>;
	};
	shell: {
		open: (url: string) => Promise<void>;
	};
	browser: {
		setZoom: (factor: number) => Promise<void>;
		clearStorage: () => Promise<void>;
	};
	shortcuts: {
		list: () => Promise<Shortcut[]>;
		add: (title: string, url: string) => Promise<Shortcut>;
		update: (
			id: string,
			updates: Partial<Pick<Shortcut, "title" | "url" | "order">>,
		) => Promise<Shortcut | null>;
		remove: (id: string) => Promise<boolean>;
	};
	contextMenu: {
		showTabMenu: (tabId: number, isPinned: boolean) => Promise<void>;
	};
	menu: {
		showThreeDotMenu: () => Promise<void>;
		onOpenSettings: (callback: () => void) => () => void;
		onOpenBookmarkManager: (callback: () => void) => () => void;
	};
	tabs: {
		list: () => Promise<TabInfo[]>;
		create: (url?: string) => Promise<{ id: number; targetId: string }>;
		close: (id: number) => Promise<boolean>;
		select: (id: number) => Promise<boolean>;
		setBarHeight: (height: number) => Promise<void>;
		pin?: (id: number) => Promise<void>;
		unpin?: (id: number) => Promise<void>;
		reorder: (fromId: number, toId: number) => Promise<void>;
		onUpdated: (callback: (tabs: TabInfo[]) => void) => () => void;
		hideActive: () => Promise<void>;
		showActive: () => Promise<void>;
		shiftActive: (deltaY: number) => Promise<void>;
		setBookmarkBarHeight: (height: number) => Promise<void>;
		setBackgroundColor: (color: string) => Promise<void>;
	};
	mcp: {
		register: () => Promise<McpResult>;
		unregister: () => Promise<McpResult>;
		status: () => Promise<McpResult>;
	};
	bookmarks: {
		list: () => Promise<Bookmark[]>;
		add: (title: string, url: string, parentId?: string) => Promise<Bookmark>;
		remove: (id: string) => Promise<void>;
		update: (
			id: string,
			updates: Partial<Pick<Bookmark, "title" | "url" | "order">>,
		) => Promise<Bookmark | null>;
		check: (url: string) => Promise<Bookmark | null>;
		// Tree API
		getTree: () => Promise<BookmarkTree>;
		addFolder: (title: string, parentId: string) => Promise<BookmarkNode>;
		moveNode: (
			nodeId: string,
			newParentId: string,
			newOrder?: number,
		) => Promise<boolean>;
		removeNode: (id: string) => Promise<boolean>;
		updateNode: (
			id: string,
			updates: Partial<Pick<BookmarkNode, "title" | "url" | "order">>,
		) => Promise<BookmarkNode | null>;
		search: (query: string) => Promise<BookmarkNode[]>;
		showFolderMenu: (folderId: string, x?: number, y?: number) => Promise<void>;
		showContextMenu: (
			nodeId: string,
			title: string,
			url: string | null,
			isFolder?: boolean,
		) => Promise<void>;
		showBarContextMenu: (parentId: string) => Promise<void>;
		onEditNode: (
			callback: (nodeId: string, title: string, url: string | null) => void,
		) => () => void;
		onDeleteNode: (
			callback: (nodeId: string, title: string) => void,
		) => () => void;
		onAddBookmarkPrompt: (callback: (parentId: string) => void) => () => void;
		onAddFolderPrompt: (callback: (parentId: string) => void) => () => void;
		showStarDialog: (
			url: string,
			pageTitle: string,
		) => Promise<{ action: string; title: string; folderId: string }>;
	};
}

declare global {
	interface Window {
		api: BrowserApi;
	}
}

export {};
