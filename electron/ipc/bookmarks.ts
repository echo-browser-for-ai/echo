import { ipcMain } from 'electron'
import {
  loadBookmarks,
  addBookmark,
  removeBookmark,
  updateBookmark,
  isBookmarked,
  getFullTree,
  addFolder,
  moveNode,
  removeNode,
  updateNode,
  searchBookmarks,
  type BookmarkNode,
  type Bookmark,
} from '../bookmarks.js'
import { getMainWindow } from './context.js'

export function registerBookmarksIpc(): void {
  // ── Flat bookmark API ──
  ipcMain.handle('bookmarks:list', async () => loadBookmarks())

  ipcMain.handle('bookmarks:add', async (_event, title: string, url: string, parentId?: string) => {
    return addBookmark(title, url, parentId)
  })

  ipcMain.handle('bookmarks:remove', async (_event, id: string) => {
    removeBookmark(id)
  })

  ipcMain.handle('bookmarks:update', async (_event, id: string, updates: Partial<Pick<Bookmark, 'title' | 'url' | 'order'>>) => {
    return updateBookmark(id, updates)
  })

  ipcMain.handle('bookmarks:check', async (_event, url: string) => isBookmarked(url))

  // ── Tree bookmark API ──
  ipcMain.handle('bookmarks:getTree', async () => getFullTree())

  ipcMain.handle('bookmarks:addFolder', async (_event, title: string, parentId: string) => {
    return addFolder(title, parentId)
  })

  ipcMain.handle('bookmarks:moveNode', async (_event, nodeId: string, newParentId: string, newOrder?: number) => {
    return moveNode(nodeId, newParentId, newOrder)
  })

  ipcMain.handle('bookmarks:removeNode', async (_event, id: string) => {
    return removeNode(id)
  })

  ipcMain.handle('bookmarks:updateNode', async (_event, id: string, updates: Partial<Pick<BookmarkNode, 'title' | 'url' | 'order'>>) => {
    return updateNode(id, updates)
  })

  ipcMain.handle('bookmarks:search', async (_event, query: string) => searchBookmarks(query))

  // ── Navigate to bookmark URL (sends event to renderer, which forwards to Chromium via CDP) ──
  ipcMain.handle('bookmarks:navigate', async (_event, url: string) => {
    const win = getMainWindow()
    win?.webContents.send('bookmarks:navigate-to', url)
  })
}
