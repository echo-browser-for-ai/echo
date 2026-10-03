import { ipcRenderer, contextBridge } from 'electron'

const api = {
  showPrompt: (message: string, defaultValue?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:prompt', message, defaultValue),

  settings: {
    get: (): Promise<any> => ipcRenderer.invoke('settings:get'),
    set: (key: string, value: any): Promise<any> => ipcRenderer.invoke('settings:set', key, value),
    reset: (): Promise<any> => ipcRenderer.invoke('settings:reset'),
    onThemeChanged: (callback: (theme: string) => void): (() => void) => {
      const handler = (_event: any, theme: string) => callback(theme)
      ipcRenderer.on('theme:changed', handler)
      return () => { ipcRenderer.removeListener('theme:changed', handler) }
    },
    onSettingsChanged: (callback: (data: { key: string; value: any }) => void): (() => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('settings:changed', handler)
      return () => { ipcRenderer.removeListener('settings:changed', handler) }
    },
  },

  app: {
    quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  },

  shell: {
    open: (url: string): Promise<void> => ipcRenderer.invoke('shell:open', url),
  },

  shortcuts: {
    list: (): Promise<Array<{ id: string; title: string; url: string; order: number }>> =>
      ipcRenderer.invoke('shortcuts:list'),
    add: (title: string, url: string): Promise<{ id: string; title: string; url: string; order: number }> =>
      ipcRenderer.invoke('shortcuts:add', title, url),
    update: (id: string, updates: any): Promise<any> =>
      ipcRenderer.invoke('shortcuts:update', id, updates),
    remove: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('shortcuts:remove', id),
  },

  mcp: {
    register: (): Promise<{ success: boolean; output: string; exitCode: number | null }> =>
      ipcRenderer.invoke('mcp:register'),
    unregister: (): Promise<{ success: boolean; output: string; exitCode: number | null }> =>
      ipcRenderer.invoke('mcp:unregister'),
    status: (): Promise<{ success: boolean; output: string; exitCode: number | null }> =>
      ipcRenderer.invoke('mcp:status'),
  },

  bookmarks: {
    list: () => ipcRenderer.invoke('bookmarks:list'),
    add: (title: string, url: string, parentId?: string) =>
      ipcRenderer.invoke('bookmarks:add', title, url, parentId),
    remove: (id: string) => ipcRenderer.invoke('bookmarks:remove', id),
    update: (id: string, updates: any) => ipcRenderer.invoke('bookmarks:update', id, updates),
    check: (url: string) => ipcRenderer.invoke('bookmarks:check', url),
    getTree: () => ipcRenderer.invoke('bookmarks:getTree'),
    addFolder: (title: string, parentId: string) =>
      ipcRenderer.invoke('bookmarks:addFolder', title, parentId),
    moveNode: (nodeId: string, newParentId: string, newOrder?: number) =>
      ipcRenderer.invoke('bookmarks:moveNode', nodeId, newParentId, newOrder),
    removeNode: (id: string) => ipcRenderer.invoke('bookmarks:removeNode', id),
    updateNode: (id: string, updates: any) => ipcRenderer.invoke('bookmarks:updateNode', id, updates),
    search: (query: string) => ipcRenderer.invoke('bookmarks:search', query),
  },

  menu: {
    onOpenSettings: (callback: () => void): (() => void) => {
      const handler = () => callback()
      ipcRenderer.on('menu:open-settings', handler)
      return () => { ipcRenderer.removeListener('menu:open-settings', handler) }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
