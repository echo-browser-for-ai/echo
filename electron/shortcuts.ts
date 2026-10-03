import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface Shortcut {
  id: string
  title: string
  url: string
  order: number
}

let _cached: Shortcut[] | null = null

function getShortcutsPath(): string {
  const dir = path.join(os.homedir(), '.echo')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'shortcuts.json')
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function loadShortcuts(): Shortcut[] {
  if (_cached) return _cached
  try {
    const raw = fs.readFileSync(getShortcutsPath(), 'utf-8')
    _cached = JSON.parse(raw) as Shortcut[]
    return _cached
  } catch {
    _cached = []
    return _cached
  }
}

export function invalidateCache(): void {
  _cached = null
}

function saveShortcuts(shortcuts: Shortcut[]): void {
  fs.writeFileSync(getShortcutsPath(), JSON.stringify(shortcuts, null, 2), 'utf-8')
  _cached = shortcuts
}

export function listShortcuts(): Shortcut[] {
  const items = loadShortcuts()
  return [...items].sort((a, b) => a.order - b.order)
}

export function addShortcut(title: string, url: string): Shortcut {
  const items = loadShortcuts()
  const maxOrder = items.reduce((max, s) => Math.max(max, s.order), -1)
  const shortcut: Shortcut = {
    id: makeId(),
    title,
    url,
    order: maxOrder + 1,
  }
  items.push(shortcut)
  saveShortcuts(items)
  return shortcut
}

export function updateShortcut(id: string, updates: Partial<Pick<Shortcut, 'title' | 'url' | 'order'>>): Shortcut | null {
  const items = loadShortcuts()
  const idx = items.findIndex(s => s.id === id)
  if (idx === -1) return null
  items[idx] = { ...items[idx], ...updates }
  saveShortcuts(items)
  return items[idx]
}

export function removeShortcut(id: string): boolean {
  const items = loadShortcuts()
  const idx = items.findIndex(s => s.id === id)
  if (idx === -1) return false
  items.splice(idx, 1)
  saveShortcuts(items)
  return true
}
