import { ipcMain, BrowserWindow, app, screen } from "electron";
import { log } from "../log.js";
import { getMainWindow, setForceQuit } from "./context.js";

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function findBookmarkParentId(tree: any, nodeId: string): string {
	function walk(nodes: any[], parentId: string): string | null {
		for (const n of nodes) {
			if (n.id === nodeId) return parentId;
			if (n.children) {
				const f = walk(n.children, n.id);
				if (f) return f;
			}
		}
		return null;
	}
	return (
		walk(
			[tree.roots.bookmarkBar, tree.roots.other],
			tree.roots.bookmarkBar.id,
		) || tree.roots.bookmarkBar.id
	);
}

export function registerWindowIpc(promptPreloadPath: string): void {
	// ── Quit ──
	ipcMain.handle("app:quit", () => {
		setForceQuit(true);
		app.quit();
	});

	// ── Replacement for prompt() (removed in Electron 43) ──
	ipcMain.handle(
		"dialog:prompt",
		async (_event, message: string, defaultValue?: string) => {
			return new Promise<string | null>((resolve) => {
				let resolved = false;
				const onResult = (_e: unknown, value: string | null) => {
					if (resolved) return;
					resolved = true;
					resolve(value);
					if (promptWin && !promptWin.isDestroyed()) promptWin.close();
				};
				ipcMain.once("prompt-result", onResult);

				const promptWin = new BrowserWindow({
					width: 400,
					height: 170,
					resizable: false,
					parent: getMainWindow()!,
					modal: true,
					frame: true,
					backgroundColor: "#0f0f0f",
					webPreferences: {
						preload: promptPreloadPath,
						sandbox: false,
						contextIsolation: true,
						nodeIntegration: false,
					},
				});

				const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin:0; padding:0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #202124;
  color: #e0e0e0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  height: 100vh;
}
label { font-size: 13px; margin-bottom: 8px; color: #bbb; }
input {
  flex: 1;
  padding: 8px 12px;
  font-size: 14px;
  border: 1px solid #444;
  border-radius: 6px;
  background: #2a2a2a;
  color: #e0e0e0;
  outline: none;
  margin-bottom: 12px;
}
input:focus { border-color: #3B82F6; }
.buttons { display: flex; gap: 8px; justify-content: flex-end; }
button {
  padding: 6px 16px;
  font-size: 13px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
}
button.ok { background: #3B82F6; color: #fff; }
button.ok:hover { background: #2563eb; }
button.cancel { background: #333; color: #ccc; }
button.cancel:hover { background: #444; }
</style>
</head>
<body>
<label>${escapeHtml(message)}</label>
<input id="input" type="text" value="${escapeHtml(defaultValue || "")}" autofocus>
<div class="buttons">
  <button class="cancel" id="cancel">Cancel</button>
  <button class="ok" id="ok">OK</button>
</div>
<script>
  var input = document.getElementById('input')
  document.getElementById('ok').onclick = function() {
    window.__submitPrompt(input.value)
  }
  document.getElementById('cancel').onclick = function() {
    window.__submitPrompt(null)
  }
  input.onkeydown = function(e) {
    if (e.key === 'Enter') window.__submitPrompt(input.value)
    if (e.key === 'Escape') window.__submitPrompt(null)
  }
  input.select()
</script>
</body>
</html>`;

				promptWin.loadURL(
					"data:text/html;charset=utf-8," + encodeURIComponent(html),
				);

				promptWin.on("closed", () => {
					ipcMain.removeListener("prompt-result", onResult);
					if (!resolved) {
						resolved = true;
						resolve(null);
					}
				});
			});
		},
	);

	// ── Bookmark star dialog (child BrowserWindow, floats above page) ──
	ipcMain.handle(
		"bookmarks:show-star-dialog",
		async (_event, url: string, pageTitle: string) => {
			const { getFullTree } = await import("../bookmarks.js");

			const existing = getFullTree();
			const flat = (function flatten(nodes: any[]): any[] {
				const result: any[] = [];
				for (const n of nodes) {
					result.push(n);
					if (n.children) result.push(...flatten(n.children));
				}
				return result;
			})([existing.roots.bookmarkBar, existing.roots.other]);
			const bookmark = flat.find((n: any) => n.url === url);

			// Build folder options
			const folders: { id: string; label: string }[] = [];
			function walkFolders(node: any, depth: number) {
				if (node.children) {
					const indent = depth > 0 ? "  ".repeat(depth) + "› " : "";
					folders.push({ id: node.id, label: indent + node.title });
					node.children.forEach((c: any) => {
						if (c.children) walkFolders(c, depth + 1);
					});
				}
			}
			walkFolders(existing.roots.bookmarkBar, 0);
			walkFolders(existing.roots.other, 0);

			// Determine default folder
			const defaultFolder = existing.roots.bookmarkBar.id;

			return new Promise<{
				action: "done" | "remove" | "cancel";
				title: string;
				folderId: string;
				newFolderName?: string;
			}>((resolve) => {
				let resolved = false;
				const onResult = async (_e: unknown, result: string) => {
					log("star-dialog", "info", "onResult fired", { result });
					if (resolved) return;
					resolved = true;
					try {
						const parsed = JSON.parse(result);

						if (parsed.action === "delete-folder" && parsed.folderId) {
							const { removeNode } = await import("../bookmarks.js");
							removeNode(parsed.folderId);
							resolve({ action: "cancel", title: "", folderId: "" });
							if (starWin && !starWin.isDestroyed()) starWin.close();
							return;
						}

						if (
							parsed.action === "done" &&
							parsed.folderId === "__new_folder__" &&
							parsed.newFolderName
						) {
							const { addFolder } = await import("../bookmarks.js");
							const newFolder = addFolder(
								parsed.newFolderName,
								existing.roots.bookmarkBar.id,
							);
							if (newFolder) parsed.folderId = newFolder.id;
						}

						resolve(parsed);
					} catch {
						resolve({ action: "cancel", title: "", folderId: "" });
					}
					if (starWin && !starWin.isDestroyed()) starWin.close();
				};
				ipcMain.once("star-dialog-submit", onResult);

				const cursor = screen.getCursorScreenPoint();
				const starWin = new BrowserWindow({
					width: 340,
					height: 280,
					x: Math.min(
						cursor.x - 280,
						screen.getPrimaryDisplay().workAreaSize.width - 360,
					),
					y: cursor.y + 10,
					resizable: false,
					parent: getMainWindow()!,
					frame: false,
					backgroundColor: "#0d1117",
					webPreferences: {
						preload: promptPreloadPath,
						sandbox: false,
						contextIsolation: true,
						nodeIntegration: false,
					},
				});

				const title = bookmark?.title || pageTitle || url;
				const currentFolder = bookmark
					? findBookmarkParentId(existing, bookmark.id)
					: defaultFolder;
				const isBm = !!bookmark;

				const folderOptionsHtml =
					folders
						.map(
							(f) =>
								`<option value="${f.id}"${f.id === currentFolder ? " selected" : ""}>${escapeHtml(f.label)}</option>`,
						)
						.join("") +
					'<option value="__new_folder__">+ Create new folder...</option>';

				const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#c9d1d9;padding:16px;display:flex;flex-direction:column;height:100vh}
label{font-size:12px;color:#8b949e;margin-bottom:4px;display:block}
input,select{width:100%;padding:8px 10px;font-size:13px;border:1px solid #30363d;border-radius:6px;background:#161b22;color:#c9d1d9;outline:none;margin-bottom:12px}
input:focus,select:focus{border-color:#58a6ff}
.buttons{display:flex;gap:8px;justify-content:flex-end;margin-top:auto}
button{padding:6px 16px;font-size:13px;border-radius:6px;border:none;cursor:pointer}
.btn-done{background:#58a6ff;color:#0d1117}
.btn-done:hover{background:#79b8ff}
.btn-remove{background:rgba(248,81,73,0.15);color:#f85149;border:1px solid rgba(248,81,73,0.4)}
.btn-remove:hover{background:rgba(248,81,73,0.25)}
.btn-cancel{background:transparent;color:#8b949e}
.btn-cancel:hover{color:#c9d1d9}
.title{font-size:13px;font-weight:600;margin-bottom:12px;color:#c9d1d9}
</style>
</head>
<body>
<div class="title">${isBm ? "Edit bookmark" : "Add bookmark"}</div>
<label>Name</label>
<input id="title" type="text" value="${escapeHtml(title)}" autofocus>
<label>Folder</label>
<select id="folder">${folderOptionsHtml}</select>
<input id="new-folder-name" type="text" placeholder="New folder name..." style="display:none; margin-bottom:12px;">
<div style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
  <button id="delete-folder-btn" type="button" style="display:none; padding:4px 10px; font-size:12px; border-radius:6px; border:1px solid rgba(248,81,73,0.4); background:rgba(248,81,73,0.1); color:#f85149; cursor:pointer;">Delete folder</button>
</div>
<div class="buttons">
  <button class="btn-cancel" id="cancel">Cancel</button>
  ${
		isBm
			? '<button class="btn-remove" id="remove">Remove</button>'
			: '<button class="btn-done" id="done">Done</button>'
	}
</div>
<script>
var ROOT_IDS=['${existing.roots.bookmarkBar.id}','${existing.roots.other.id}'];
var titleEl=document.getElementById('title');
var folderEl=document.getElementById('folder');
var newFolderInput=document.getElementById('new-folder-name');
var deleteBtn=document.getElementById('delete-folder-btn');
var deleteConfirming=false;
var deleteTimer=null;
function send(r){window.__submitStarDialog(JSON.stringify(r))}
function updateDeleteBtn(){var v=folderEl.value;var isR=ROOT_IDS.indexOf(v)!==-1;var isN=v==='__new_folder__';deleteBtn.style.display=(!isR&&!isN)?'inline-block':'none';}
folderEl.addEventListener('change',function(){newFolderInput.style.display=(folderEl.value==='__new_folder__')?'block':'none';updateDeleteBtn();});
updateDeleteBtn();
document.getElementById('done')&&document.getElementById('done').onclick=function(){var nf=(folderEl.value==='__new_folder__')?newFolderInput.value.trim():'';send({action:'done',title:titleEl.value,folderId:folderEl.value,newFolderName:nf})};
document.getElementById('remove')&&document.getElementById('remove').onclick=function(){if(folderEl.value==='__new_folder__'){document.getElementById('cancel').click();return}send({action:'remove',title:titleEl.value,folderId:folderEl.value})};
document.getElementById('cancel').onclick=function(){send({action:'cancel',title:'',folderId:''})};
titleEl.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();var b=document.getElementById('done')||document.getElementById('remove');b&&b.click()}if(e.key==='Escape')document.getElementById('cancel').click()};
folderEl.onkeydown=function(e){if(e.key==='Escape')document.getElementById('cancel').click()};
newFolderInput.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();var b=document.getElementById('done')||document.getElementById('remove');b&&b.click()}if(e.key==='Escape')document.getElementById('cancel').click()};
deleteBtn.onclick=function(){if(!deleteConfirming){deleteConfirming=true;deleteBtn.textContent='Confirm delete?';deleteBtn.style.background='rgba(248,81,73,0.25)';deleteTimer=setTimeout(function(){deleteConfirming=false;deleteBtn.textContent='Delete folder';deleteBtn.style.background='rgba(248,81,73,0.1)'},3000);return}clearTimeout(deleteTimer);send({action:'delete-folder',title:'',folderId:folderEl.value,newFolderName:''})};
titleEl.select();
</script></body></html>`;

				starWin.loadURL(
					"data:text/html;charset=utf-8," + encodeURIComponent(html),
				);

				let blurEnabled = false;
				starWin.webContents.once("did-finish-load", () => {
					blurEnabled = true;
				});
				starWin.on("blur", () => {
					if (!blurEnabled || resolved) return;
					resolved = true;
					resolve({ action: "cancel", title: "", folderId: "" });
					ipcMain.removeListener("star-dialog-submit", onResult);
					if (starWin && !starWin.isDestroyed()) starWin.close();
				});

				starWin.on("closed", () => {
					ipcMain.removeListener("star-dialog-submit", onResult);
					if (!resolved) {
						resolved = true;
						resolve({ action: "cancel", title: "", folderId: "" });
					}
				});
			});
		},
	);
}
