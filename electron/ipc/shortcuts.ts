import { ipcMain } from 'electron'
import {
  listShortcuts,
  addShortcut,
  updateShortcut,
  removeShortcut,
  type Shortcut,
} from '../shortcuts.js'

export function registerShortcutsIpc(): void {
  ipcMain.handle('shortcuts:list', async () => listShortcuts())

  ipcMain.handle('shortcuts:add', async (_event, title: string, url: string) =>
    addShortcut(title, url)
  )

  ipcMain.handle('shortcuts:update', async (_event, id: string, updates: Partial<Shortcut>) =>
    updateShortcut(id, updates)
  )

  ipcMain.handle('shortcuts:remove', async (_event, id: string) => removeShortcut(id))
}
