import { registerSettingsIpc } from './settings.js'
import { registerBookmarksIpc } from './bookmarks.js'
import { registerShortcutsIpc } from './shortcuts.js'
import { registerWindowIpc } from './window.js'

/** Register every IPC handler. Called once from main during startup. */
export function registerIpc(): void {
  registerSettingsIpc()
  registerBookmarksIpc()
  registerShortcutsIpc()
  // Dialog windows (prompt, star) require a preload path. In tray-only mode,
  // these dialogs are not used. If needed later, use registerAllIpc(preloadPath).
}

/** Full registration with preload path for dialog windows. */
export function registerAllIpc(promptPreloadPath: string): void {
  registerIpc()
  registerWindowIpc(promptPreloadPath)
}
