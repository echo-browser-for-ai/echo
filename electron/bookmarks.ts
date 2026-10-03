import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { log } from './log.js'

/**
 * A node in the bookmark tree.
 * - Folders have `children` (array) and no `url`
 * - Bookmarks have `url` and no `children`
 */
export interface BookmarkNode {
  id: string
  title: string
  url?: string
  children?: BookmarkNode[]
  dateAdded: number
  dateModified?: number
  order: number
}

/**
 * Legacy flat bookmark type — kept for backward compat with existing code.
 */
export interface Bookmark {
  id: string
  title: string
  url: string
  order: number
  dateAdded: number
}

/** Internal structure stored on disk. */
interface BookmarkTree {
  version: 2
  roots: {
    bookmarkBar: BookmarkNode  // shown on the bookmark bar
    other: BookmarkNode        // "Other Bookmarks"
  }
}

let _cached: BookmarkTree | null = null

// ── Private helpers ──────────────────────────────────────────

function getBookmarksPath(): string {
  const dir = path.join(os.homedir(), '.echo')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'bookmarks.json')
}

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyFolder(title: string, order: number): BookmarkNode {
  return {
    id: `folder_${makeId()}`,
    title,
    children: [],
    dateAdded: Date.now(),
    order,
  }
}

/** Migrate the old flat array format (version 1) to tree format (version 2). */
function migrateV1ToV2(raw: unknown): BookmarkTree {
  const flat = Array.isArray(raw) ? raw as Bookmark[] : []
  const tree: BookmarkTree = {
    version: 2,
    roots: {
      bookmarkBar: createEmptyFolder('Bookmarks bar', 0),
      other: createEmptyFolder('Other bookmarks', 1),
    },
  }
  if (flat.length > 0) {
    // Put all existing flat bookmarks into "Other bookmarks"
    tree.roots.other.children = flat.map(b => ({
      ...b,
      dateModified: undefined,
    })).sort((a, b) => a.order - b.order)
  }
  return tree
}

function readFromDisk(): BookmarkTree {
  try {
    const raw = fs.readFileSync(getBookmarksPath(), 'utf-8')
    const parsed = JSON.parse(raw)

    // Version 1 (flat array) → version 2 (tree)
    if (Array.isArray(parsed)) {
      const migrated = migrateV1ToV2(parsed)
      writeToDisk(migrated) // persist migration immediately
      return migrated
    }

    // Version 2 (tree) — validate structure
    if (parsed?.version === 2 && parsed?.roots?.bookmarkBar && parsed?.roots?.other) {
      return parsed as BookmarkTree
    }

    // Unknown format — reset
    log('bookmarks', 'warn', 'unknown format — resetting to fresh tree')
    return createFreshTree()
  } catch {
    return createFreshTree()
  }
}

function createFreshTree(): BookmarkTree {
  return {
    version: 2,
    roots: {
      bookmarkBar: createEmptyFolder('Bookmarks bar', 0),
      other: createEmptyFolder('Other bookmarks', 1),
    },
  }
}

function writeToDisk(tree: BookmarkTree): void {
  _cached = tree
  try {
    fs.writeFileSync(getBookmarksPath(), JSON.stringify(tree, null, 2), 'utf-8')
  } catch (err) {
    log('bookmarks', 'error', 'failed to save', { err: String(err) })
  }
}

// ── Tree traversal helpers ───────────────────────────────────

/** Find a node by ID anywhere in the tree. Returns [parent, node, pathToParent]. */
export function findNodeById(tree: BookmarkTree, id: string):
  { parent: BookmarkNode | null; node: BookmarkNode | null; parentPath: string[] } {
  const roots = [tree.roots.bookmarkBar, tree.roots.other]

  function walk(nodes: BookmarkNode[], parent: BookmarkNode | null, path: string[]):
    { parent: BookmarkNode | null; node: BookmarkNode | null; parentPath: string[] } {
    for (const node of nodes) {
      if (node.id === id) return { parent, node, parentPath: path }
      if (node.children) {
        const found = walk(node.children, node, [...path, node.id])
        if (found.node) return found
      }
    }
    return { parent: null, node: null, parentPath: [] }
  }

  return walk(roots, null, [])
}

/** Flatten the entire tree into a list (for search, etc.). */
function flattenTree(nodes: BookmarkNode[]): BookmarkNode[] {
  const result: BookmarkNode[] = []
  function walk(list: BookmarkNode[]) {
    for (const n of list) {
      result.push(n)
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return result
}

/** Remove a node from the tree by ID. Returns true if found and removed. */
function removeFromTree(tree: BookmarkTree, id: string): boolean {
  // Check roots
  if (tree.roots.bookmarkBar.id === id) return false // can't remove root
  if (tree.roots.other.id === id) return false        // can't remove root

  function removeFromList(nodes: BookmarkNode[]): boolean {
    const idx = nodes.findIndex(n => n.id === id)
    if (idx !== -1) {
      nodes.splice(idx, 1)
      return true
    }
    for (const n of nodes) {
      if (n.children && removeFromList(n.children)) return true
    }
    return false
  }

  return removeFromList([tree.roots.bookmarkBar, tree.roots.other])
}

/** Sort children by `order` in-place. */
function sortChildren(nodes: BookmarkNode[]): void {
  nodes.sort((a, b) => a.order - b.order)
  for (const n of nodes) {
    if (n.children) sortChildren(n.children)
  }
}

// ── Public API ───────────────────────────────────────────────

/** Load the full bookmark tree (cached). */
export function getTree(): BookmarkTree {
  if (_cached) return _cached
  _cached = readFromDisk()
  return _cached
}

/** Force reload from disk on next access. */
export function invalidateCache(): void {
  _cached = null
}

// ── Legacy API (adapted for backward compat) ─────────────────

/** Load all bookmarks as a flat list (legacy). For search/display. */
export function loadBookmarks(): Bookmark[] {
  const tree = getTree()
  const all = flattenTree([tree.roots.bookmarkBar, tree.roots.other])
  return all
    .filter(n => n.url) // only actual bookmarks
    .map(n => ({ id: n.id, title: n.title, url: n.url!, order: n.order, dateAdded: n.dateAdded }))
}

/** Add a bookmark to a specific folder (defaults to 'other' root). */
export function addBookmark(title: string, url: string, parentId?: string): Bookmark {
  const tree = getTree()
  const bm: BookmarkNode = {
    id: `bm_${makeId()}`,
    title,
    url,
    dateAdded: Date.now(),
    order: 0,
  }

  // Find parent
  const parent = parentId
    ? findNodeById(tree, parentId).node
    : tree.roots.other

  if (!parent || !parent.children) {
    tree.roots.other.children!.push(bm)
  } else {
    bm.order = parent.children.length
    parent.children.push(bm)
  }

  sortChildren([tree.roots.bookmarkBar, tree.roots.other])
  writeToDisk(tree)
  return { id: bm.id, title: bm.title, url: bm.url!, order: bm.order, dateAdded: bm.dateAdded }
}

export function removeBookmark(id: string): void {
  const tree = getTree()
  removeFromTree(tree, id)
  writeToDisk(tree)
}

export function updateBookmark(id: string, updates: Partial<Pick<Bookmark, 'title' | 'url' | 'order'>>): Bookmark | null {
  const tree = getTree()
  const { node } = findNodeById(tree, id)
  if (!node) return null
  if (updates.title !== undefined) node.title = updates.title
  if (updates.url !== undefined) node.url = updates.url
  if (updates.order !== undefined) node.order = updates.order
  node.dateModified = Date.now()
  sortChildren([tree.roots.bookmarkBar, tree.roots.other])
  writeToDisk(tree)
  return { id: node.id, title: node.title, url: node.url || '', order: node.order, dateAdded: node.dateAdded }
}

export function isBookmarked(url: string): Bookmark | null {
  const tree = getTree()
  const all = flattenTree([tree.roots.bookmarkBar, tree.roots.other])
  const found = all.find(n => n.url === url)
  if (!found) return null
  return { id: found.id, title: found.title, url: found.url || '', order: found.order, dateAdded: found.dateAdded }
}

// ── New Tree API ─────────────────────────────────────────────

/** Get the full tree including root folders. */
export function getFullTree(): BookmarkTree {
  return getTree()
}

/** Add a folder inside a parent folder. Returns the created folder node. */
export function addFolder(title: string, parentId: string): BookmarkNode | null {
  const tree = getTree()
  const { node: parent } = findNodeById(tree, parentId)
  if (!parent || !parent.children) return null

  const folder = createEmptyFolder(title, parent.children.length)
  parent.children.push(folder)
  sortChildren([tree.roots.bookmarkBar, tree.roots.other])
  writeToDisk(tree)
  return folder
}

/** Move a node to a new parent folder (optionally at a specific order index). */
export function moveNode(nodeId: string, newParentId: string, newOrder?: number): boolean {
  const tree = getTree()

  // Can't move roots
  if (nodeId === tree.roots.bookmarkBar.id || nodeId === tree.roots.other.id) return false

  const { node, parent: oldParent } = findNodeById(tree, nodeId)
  const { node: newParent } = findNodeById(tree, newParentId)

  if (!node || !newParent || !newParent.children) return false
  if (!oldParent || !oldParent.children) return false

  // Don't move a folder into itself or its own descendants
  if (node.children) {
    // Check if newParent is a descendant of node
    const descendants = flattenTree(node.children).map(n => n.id)
    if (descendants.includes(newParentId)) return false
  }

  // Remove from old parent
  const idx = oldParent.children.indexOf(node)
  if (idx !== -1) oldParent.children.splice(idx, 1)

  // Add to new parent
  if (newOrder !== undefined) {
    node.order = newOrder
    newParent.children.splice(newOrder, 0, node)
  } else {
    node.order = newParent.children.length
    newParent.children.push(node)
  }

  sortChildren([tree.roots.bookmarkBar, tree.roots.other])
  writeToDisk(tree)
  return true
}

/** Remove a node (and all its children if it's a folder). Returns false if it's a root. */
export function removeNode(id: string): boolean {
  const tree = getTree()
  if (id === tree.roots.bookmarkBar.id || id === tree.roots.other.id) return false
  const removed = removeFromTree(tree, id)
  if (removed) writeToDisk(tree)
  return removed
}

/** Update any fields of a node. */
export function updateNode(id: string, updates: Partial<Pick<BookmarkNode, 'title' | 'url' | 'order'>>): BookmarkNode | null {
  const tree = getTree()
  const { node } = findNodeById(tree, id)
  if (!node) return null
  if (updates.title !== undefined) node.title = updates.title
  if (updates.url !== undefined) node.url = updates.url
  if (updates.order !== undefined) node.order = updates.order
  node.dateModified = Date.now()
  sortChildren([tree.roots.bookmarkBar, tree.roots.other])
  writeToDisk(tree)
  return node
}

/** Search bookmarks by title or URL. Returns flat list of matching bookmark nodes (not folders). */
export function searchBookmarks(query: string): BookmarkNode[] {
  const tree = getTree()
  const all = flattenTree([tree.roots.bookmarkBar, tree.roots.other])
  const q = query.toLowerCase()
  return all.filter(n => n.url && (n.title.toLowerCase().includes(q) || n.url.toLowerCase().includes(q)))
}
