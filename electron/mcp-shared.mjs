/**
 * MCP config targets + install/uninstall/status logic — SHARED, Electron-free.
 *
 * This module has ZERO Electron dependencies (only node:fs / node:path / node:os),
 * so it can run two ways from ONE source of truth:
 *
 *   1. Inside the Echo Electron app — imported by electron/mcp-registration.ts
 *      (which adds the Electron-specific getEchoEntry() and the settings timestamp).
 *   2. Standalone during NSIS UNINSTALL — run via the bundled node.exe by
 *      resources/echo-mcp-cleanup.mjs (which imports THIS file). At uninstall the
 *      Echo app is gone, so the uninstaller must clean configs itself. Removing
 *      Echo only needs to delete the "echo" key/block by name — no entry path
 *      required — which is why this can be Electron-free.
 *
 * Apps covered: pi, Claude Code (CLI), Claude Desktop, Cursor, OpenCode, Codex,
 *   Gemini CLI, Antigravity 2.0, Qwen Code, Cline, Roo Code, VS Code (Copilot),
 *   Windsurf, Continue. MiniMax Code is browser-based → reported "unsupported".
 *
 * Safety: atomic writes (tmp + rename); a config that exists but fails to parse
 * is NEVER overwritten (skipped + reported "error"); dotfile configs are created
 * if missing; AppData/globalStorage configs are only written when their parent
 * app folder already exists (requireDir) so we don't litter phantom dirs.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ── Types (JSDoc; mirrored by electron/mcp-shared.d.ts for TS consumers) ───

/**
 * @typedef {'registered'|'stale'|'absent'|'not-installed'|'unsupported'|'error'} AppStatusKind
 * @typedef {{ id: string, name: string, status: AppStatusKind, path?: string, note?: string }} AppStatus
 * @typedef {{ command: string, args: string[] }} EchoEntry
 */

// ── Path helpers ──────────────────────────────────────────

export const HOME = os.homedir()
export const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
export const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')

const ECHO_KEY = 'echo'
const CODEX_HEADER = '[mcp_servers.echo]'

// ── Target registry ───────────────────────────────────────

/**
 * @typedef {'mcpServers'|'opencode'|'vscode'|'toml'|'unsupported'} Handler
 * @typedef {{ path: string, requireDir?: string }} ConfigFile
 * @typedef {{ id: string, name: string, files: ConfigFile[], handler: Handler, extra?: (e: EchoEntry) => Record<string, unknown>, note?: string }} Target
 */

/** @type {Target[]} */
export const TARGETS = [
  {
    id: 'pi',
    name: 'pi',
    files: [{ path: path.join(HOME, '.pi', 'agent', 'mcp.json') }],
    handler: 'mcpServers',
    extra: () => ({ lifecycle: 'lazy' }),
  },
  {
    id: 'claude-code',
    name: 'Claude Code (CLI)',
    files: [{ path: path.join(HOME, '.claude.json') }],
    handler: 'mcpServers',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    files: [
      { path: path.join(APPDATA, 'Claude', 'claude_desktop_config.json'), requireDir: path.join(APPDATA, 'Claude') },
      {
        path: path.join(LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'),
        requireDir: path.join(LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc'),
      },
    ],
    handler: 'mcpServers',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    files: [{ path: path.join(HOME, '.cursor', 'mcp.json') }],
    handler: 'mcpServers',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    files: [{ path: path.join(HOME, '.config', 'opencode', 'opencode.json') }],
    handler: 'opencode',
  },
  {
    id: 'codex',
    name: 'Codex (OpenAI)',
    files: [{ path: path.join(HOME, '.codex', 'config.toml') }],
    handler: 'toml',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    files: [{ path: path.join(HOME, '.gemini', 'settings.json') }],
    handler: 'mcpServers',
  },
  {
    id: 'antigravity',
    name: 'Antigravity 2.0',
    files: [{ path: path.join(HOME, '.gemini', 'config', 'mcp_config.json') }],
    handler: 'mcpServers',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    files: [{ path: path.join(HOME, '.qwen', 'settings.json') }],
    handler: 'mcpServers',
  },
  {
    id: 'cline',
    name: 'Cline',
    files: [
      { path: path.join(HOME, '.cline', 'mcp.json') },
      { path: path.join(HOME, '.cline', 'data', 'settings', 'cline_mcp_settings.json') },
      {
        path: path.join(APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
        requireDir: path.join(APPDATA, 'Code', 'User', 'globalStorage'),
      },
    ],
    handler: 'mcpServers',
  },
  {
    id: 'roo-code',
    name: 'Roo Code',
    files: [
      {
        path: path.join(APPDATA, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'),
        requireDir: path.join(APPDATA, 'Code', 'User', 'globalStorage'),
      },
    ],
    handler: 'mcpServers',
  },
  {
    id: 'vscode',
    name: 'VS Code (Copilot)',
    files: [{ path: path.join(APPDATA, 'Code', 'User', 'mcp.json'), requireDir: path.join(APPDATA, 'Code', 'User') }],
    handler: 'vscode',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    files: [{ path: path.join(APPDATA, 'Windsurf', 'mcp.json'), requireDir: path.join(APPDATA, 'Windsurf') }],
    handler: 'mcpServers',
  },
  {
    id: 'continue',
    name: 'Continue',
    files: [{ path: path.join(APPDATA, 'Continue', 'config.json'), requireDir: path.join(APPDATA, 'Continue') }],
    handler: 'mcpServers',
  },
  {
    id: 'minimax',
    name: 'MiniMax Code',
    files: [],
    handler: 'unsupported',
    note: 'Browser-based engine — no writable file config.',
  },
]

// ── File IO helpers ───────────────────────────────────────

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

/** Returns parsed data, or null if missing. Throws if it exists but can't parse. */
async function readJsonSafe(p) {
  let raw
  try { raw = await fs.readFile(p, 'utf-8') }
  catch { return null }
  try { return JSON.parse(raw) }
  catch { throw new Error(`config unreadable (invalid JSON): ${p}`) }
}

async function writeJsonAtomic(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = p + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, p)
}

async function readTextSafe(p) {
  try { return await fs.readFile(p, 'utf-8') }
  catch { return null }
}

async function writeTextAtomic(p, text) {
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = p + '.tmp'
  await fs.writeFile(tmp, text, 'utf-8')
  await fs.rename(tmp, p)
}

// ── Minimal TOML block handling (for Codex ~/.codex/config.toml) ──────────

function parseToml(text) {
  const lines = text.split(/\r?\n/)
  const preamble = []
  const blocks = new Map()
  const order = []
  let current = null
  for (const line of lines) {
    if (/^\[[^\[]/.test(line)) {
      const key = line.trim()
      current = []
      if (!blocks.has(key)) order.push(key)
      blocks.set(key, current)
      current.push(line)
    } else if (current) {
      current.push(line)
    } else {
      preamble.push(line)
    }
  }
  return { preamble, blocks, order }
}

function serializeToml(doc) {
  const parts = []
  const pre = doc.preamble.join('\n').replace(/\s+$/, '')
  if (pre) parts.push(pre)
  for (const key of doc.order) {
    const blk = doc.blocks.get(key)
    if (!blk) continue
    parts.push(blk.join('\n').replace(/\s+$/, ''))
  }
  return parts.join('\n\n').replace(/\s+$/, '') + '\n'
}

function tomlEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function codexBlockLines(entry) {
  return [
    CODEX_HEADER,
    `command = "${tomlEscape(entry.command)}"`,
    `args = [${entry.args.map(a => '"' + tomlEscape(a) + '"').join(', ')}]`,
  ]
}

// ── Per-file install / uninstall / status ─────────────────

function looksLikeEcho(commandOrArgs) {
  const str = typeof commandOrArgs === 'string'
    ? commandOrArgs
    : Array.isArray(commandOrArgs) ? commandOrArgs.join(' ') : ''
  return str.includes('echo-mcp-launcher')
}

async function fileInstall(t, file, entry) {
  if (t.handler === 'toml') {
    const existing = await readTextSafe(file) ?? ''
    const doc = parseToml(existing)
    doc.blocks.set(CODEX_HEADER, codexBlockLines(entry))
    if (!doc.order.includes(CODEX_HEADER)) doc.order.push(CODEX_HEADER)
    await writeTextAtomic(file, serializeToml(doc))
    return
  }
  const data = (await readJsonSafe(file)) ?? {}
  if (t.handler === 'mcpServers') {
    if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {}
    data.mcpServers[ECHO_KEY] = { ...entry, ...(t.extra ? t.extra(entry) : {}) }
  } else if (t.handler === 'opencode') {
    if (!data.mcp || typeof data.mcp !== 'object') data.mcp = {}
    data.mcp[ECHO_KEY] = { type: 'local', command: [entry.command, ...entry.args], enabled: true }
  } else if (t.handler === 'vscode') {
    if (!data.servers || typeof data.servers !== 'object') data.servers = {}
    data.servers[ECHO_KEY] = { type: 'stdio', command: entry.command, args: entry.args }
  }
  await writeJsonAtomic(file, data)
}

async function fileUninstall(t, file) {
  if (t.handler === 'toml') {
    const existing = await readTextSafe(file)
    if (existing == null) return
    const doc = parseToml(existing)
    if (!doc.blocks.has(CODEX_HEADER)) return
    doc.blocks.delete(CODEX_HEADER)
    doc.order = doc.order.filter(k => k !== CODEX_HEADER)
    await writeTextAtomic(file, serializeToml(doc))
    return
  }
  const data = await readJsonSafe(file)
  if (data == null) return
  if (t.handler === 'mcpServers' && data.mcpServers) {
    delete data.mcpServers[ECHO_KEY]
  } else if (t.handler === 'opencode' && data.mcp) {
    delete data.mcp[ECHO_KEY]
  } else if (t.handler === 'vscode' && data.servers) {
    delete data.servers[ECHO_KEY]
  }
  await writeJsonAtomic(file, data)
}

async function fileStatus(t, file) {
  if (t.handler === 'toml') {
    const text = await readTextSafe(file)
    if (text == null) return 'absent'
    const doc = parseToml(text)
    const blk = doc.blocks.get(CODEX_HEADER)
    if (!blk) return 'absent'
    const hasCommand = blk.some(l => l.startsWith('command ='))
    const hasEcho = blk.some(l => looksLikeEcho(l))
    return hasCommand && hasEcho ? 'registered' : 'stale'
  }
  const data = await readJsonSafe(file)
  if (data == null) return 'absent'
  let node
  if (t.handler === 'mcpServers') node = data.mcpServers?.[ECHO_KEY]
  else if (t.handler === 'opencode') node = data.mcp?.[ECHO_KEY]
  else if (t.handler === 'vscode') node = data.servers?.[ECHO_KEY]
  if (!node) return 'absent'
  return looksLikeEcho(node.command) || looksLikeEcho(node.args) ? 'registered' : 'stale'
}

// ── Per-target install / uninstall / status ───────────────

const STATUS_RANK = {
  registered: 5, stale: 4, error: 3, absent: 2, 'not-installed': 1, unsupported: 0,
}

async function targetInstall(t, entry) {
  if (t.handler === 'unsupported') return { status: 'unsupported', note: t.note }
  let wrote = false, considered = false, lastErr = '', lastPath = ''
  for (const f of t.files) {
    if (f.requireDir && !(await exists(f.requireDir))) continue
    considered = true
    lastPath = f.path
    try { await fileInstall(t, f.path, entry); wrote = true }
    catch (e) { lastErr = String(e).split('\n')[0] }
  }
  if (!considered) return { status: 'not-installed' }
  if (wrote) return { status: 'registered', path: lastPath }
  return { status: 'error', path: lastPath, note: lastErr || 'write failed' }
}

async function targetUninstall(t) {
  if (t.handler === 'unsupported') return
  for (const f of t.files) {
    if (f.requireDir && !(await exists(f.requireDir))) continue
    try { await fileUninstall(t, f.path) } catch { /* best effort */ }
  }
}

async function targetStatus(t) {
  if (t.handler === 'unsupported') {
    return { id: t.id, name: t.name, status: 'unsupported', note: t.note }
  }
  let best = 'absent', anyConsidered = false, lastPath = ''
  for (const f of t.files) {
    if (f.requireDir && !(await exists(f.requireDir))) continue
    anyConsidered = true
    lastPath = f.path
    let s
    try { s = await fileStatus(t, f.path) }
    catch { s = 'error' }
    if (s === 'registered') { best = 'registered'; break }
    if (STATUS_RANK[s] > STATUS_RANK[best]) best = s
  }
  if (!anyConsidered) return { id: t.id, name: t.name, status: 'not-installed' }
  return { id: t.id, name: t.name, status: best, path: lastPath }
}

// ── Aggregate operations (used by app + standalone uninstall) ─────────────

/** Install Echo into every target. Returns per-app status.
 * @param {EchoEntry} entry
 * @returns {Promise<AppStatus[]>} */
export async function installAll(entry) {
  const apps = []
  for (const t of TARGETS) {
    const res = await targetInstall(t, entry)
    apps.push({ id: t.id, name: t.name, status: res.status, path: res.path, note: res.note })
  }
  return apps
}

/** Remove Echo from every target. Returns per-app resulting status.
 * @returns {Promise<AppStatus[]>} */
export async function unregisterAll() {
  const apps = []
  for (const t of TARGETS) {
    await targetUninstall(t)
    apps.push(await targetStatus(t))
  }
  return apps
}

/** Read-only status of every target.
 * @returns {Promise<AppStatus[]>} */
export async function getStatusAll() {
  const apps = []
  for (const t of TARGETS) apps.push(await targetStatus(t))
  return apps
}

// ── Formatting (shared by app output + uninstall log) ─────

const SYMBOL = { registered: '✓', stale: '!', absent: '·', 'not-installed': '○', unsupported: 'ℹ', error: '✗' }

export function shortPath(p) {
  return p.replace(HOME, '~').replace(APPDATA, '%APPDATA%').replace(LOCALAPPDATA, '%LOCALAPPDATA%')
}

export function formatLines(apps) {
  return apps.map(a => {
    const tail = a.note ? ` — ${a.note}` : a.path ? ` — ${shortPath(a.path)}` : ''
    return `${SYMBOL[a.status] || '?'} ${a.name}${tail}`
  }).join('\n')
}
