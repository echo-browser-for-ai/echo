import { BrowserWindow } from 'electron'

let _win: BrowserWindow | null = null
let _forceQuit = false

export function setMainWindow(win: BrowserWindow | null): void {
  _win = win
}

export function getMainWindow(): BrowserWindow | null {
  return _win
}

export function setForceQuit(value: boolean): void {
  _forceQuit = value
}

export function shouldForceQuit(): boolean {
  return _forceQuit
}
