import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('__submitPrompt', (value) => {
  ipcRenderer.send('prompt-result', value)
})

contextBridge.exposeInMainWorld('__submitStarDialog', (value) => {
  ipcRenderer.send('star-dialog-submit', value)
})

contextBridge.exposeInMainWorld('__submitBookmarkAction', (data) => {
  ipcRenderer.send('bookmark-action', data)
})
