import { ipcMain, app, nativeTheme } from 'electron'
import path from 'node:path'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type AppSettings } from '../settings-store.js'
import { getMainWindow } from './context.js'
import { registerMcpConfigs, unregisterMcpConfigs, getMcpStatus } from '../mcp-registration.js'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', async () => {
    const settings = loadSettings()
    nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark'
    return settings
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    const settings = loadSettings()
    ;(settings as unknown as Record<string, unknown>)[key] = value
    saveSettings(settings)

    // Broadcast settings change to renderer
    const win = getMainWindow()
    win?.webContents.send('settings:changed', { key, value })

    // Apply theme
    if (key === 'theme') {
      win?.webContents.send('theme:changed', value)
      nativeTheme.themeSource = value === 'light' ? 'light' : 'dark'

      // Update window icon
      const iconPath = value === 'light'
        ? path.join(process.env.VITE_PUBLIC || '', 'icon-light.png')
        : path.join(process.env.VITE_PUBLIC || '', 'icon.png')
      try { win?.setIcon(iconPath) } catch { /* icon file may not exist */ }
    }

    applyLoginSetting(value, key)
    return settings
  })

  ipcMain.handle('settings:reset', async () => {
    saveSettings({ ...DEFAULT_SETTINGS } as AppSettings)
    applyLoginSetting(DEFAULT_SETTINGS.openAtLogin, 'openAtLogin')
    return { ...DEFAULT_SETTINGS }
  })

  ipcMain.handle('mcp:register', async () => {
    const result = await registerMcpConfigs()
    return result
  })

  ipcMain.handle('mcp:unregister', async () => {
    const result = await unregisterMcpConfigs()
    return result
  })

  ipcMain.handle('mcp:status', async () => {
    const result = await getMcpStatus()
    return result
  })
}

function applyLoginSetting(value: unknown, key: string): void {
  if (key !== 'openAtLogin') return
  // Skip in dev mode — process.execPath is electron.exe without an app entry point
  if (process.env.VITE_DEV_SERVER_URL) return
  app.setLoginItemSettings(
    value
      ? { openAtLogin: true, path: process.execPath, args: ['--hidden'] }
      : { openAtLogin: false }
  )
}
