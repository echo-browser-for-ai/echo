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
 * @typedef {object} EchoEntry
 * @property {string} command  Program that runs both MCP servers.
 * @property {string[]} args   Launcher arguments (args[0] is the launcher path).
 * @property {string} [pdfServer]  Where echo-pdf-server.mjs actually is, when it
 *   is not simply beside the launcher — dev puts the launcher at the repo root
 *   and the server under build/installer/resources.
 */

// ── Path helpers ──────────────────────────────────────────

export const HOME = os.homedir()
export const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
export const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')

const ECHO_KEY = 'echo'
const CODEX_HEADER = '[mcp_servers.echo]'

// Echo registers TWO MCP servers. The browser tools come from Microsoft's
// @playwright/mcp, started by echo-mcp-launcher.js; Echo's own tools (today just
// read_pdf) live in echo-pdf-server.mjs, which sits beside it.
//
// They are separate processes on purpose. Sitting in front of @playwright/mcp as
// a proxy would put Echo in the path of every browser call, so one bug here would
// break all browsing. Running alongside keeps them independent: either can be
// fixed or replaced without touching the other.
const ECHO_PDF_KEY = 'echo-pdf'
const CODEX_PDF_HEADER = '[mcp_servers.echo-pdf]'
const PDF_SERVER_FILE = 'echo-pdf-server.mjs'

/**
 * These two lines are the only thing a fresh agent is told before it decides
 * whether Echo is worth looking at, so they name the exact tools rather than
 * describing them in prose. pi cuts a server description at 250 characters.
 */
const BROWSER_DESCRIPTION =
  'Browser. browser_navigate=open URL, browser_evaluate=read page text, ' +
  'browser_snapshot/click/type=interact, browser_network_request=raw JSON, ' +
  'browser_run_code_unsafe=fetch as the user. Use for logged-in, JS or bot-walled pages.'

const PDF_DESCRIPTION =
  'read_pdf(source, pages?, max_chars?)=text out of any PDF, from a URL or a saved file. ' +
  'Chrome shows PDFs but exposes no text to the page, so browser tools cannot read one; this can.'

// ── Target registry ───────────────────────────────────────

/**
 * @typedef {'mcpServers'|'opencode'|'vscode'|'toml'|'unsupported'} Handler
 * @typedef {{ path: string, requireDir?: string }} ConfigFile
 * @typedef {{ id: string, name: string, files: ConfigFile[], handler: Handler, extra?: (e: EchoEntry, key: string) => Record<string, unknown>, note?: string }} Target
 */

/** @type {Target[]} */
export const TARGETS = [
  {
    id: 'pi',
    name: 'pi',
    files: [{ path: path.join(HOME, '.pi', 'agent', 'mcp.json') }],
    handler: 'mcpServers',
    // pi's own config fields, saved beside command/args. `direct` declares every
    // tool up front rather than hiding them behind a search: the tool list is a
    // stable prefix that prompt caching handles well, and an agent that can see
    // every tool never wastes a turn hunting for one or misses its favourite.
    extra: (_entry, key) => ({
      exposure: 'direct',
      description: key === ECHO_PDF_KEY ? PDF_DESCRIPTION : BROWSER_DESCRIPTION,
    }),
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

function codexBlockLines(server) {
  const args = Array.isArray(server.args) ? server.args : []
  return [
    server.header,
    `command = "${tomlEscape(server.command)}"`,
    `args = [${args.map(a => '"' + tomlEscape(a) + '"').join(', ')}]`,
  ]
}

// ── Per-file install / uninstall / status ─────────────────

function looksLikeEcho(commandOrArgs) {
  const str = typeof commandOrArgs === 'string'
    ? commandOrArgs
    : Array.isArray(commandOrArgs) ? commandOrArgs.join(' ') : ''
  return str.includes('echo-mcp-launcher')
}

/** The servers Echo registers for a target: the browser, and Echo's own tools. */
function serversFor(entry) {
  const args = Array.isArray(entry.args) ? entry.args : []
  const servers = [{ key: ECHO_KEY, header: CODEX_HEADER, command: entry.command, args }]

  // Usually the PDF server sits beside the launcher. Dev is the exception: the
  // launcher is at the repo root there while the server is staged under
  // build/installer/resources, so getEchoEntry() passes the path explicitly.
  const launcher = typeof args[0] === 'string' ? args[0] : ''
  const pdfServer = typeof entry.pdfServer === 'string' && entry.pdfServer
    ? entry.pdfServer
    : launcher ? path.join(path.dirname(launcher), PDF_SERVER_FILE) : ''

  if (pdfServer && entry.command) {
    servers.push({ key: ECHO_PDF_KEY, header: CODEX_PDF_HEADER, command: entry.command, args: [pdfServer] })
  }
  return servers
}

async function fileInstall(t, file, entry) {
  const servers = serversFor(entry)
  if (t.handler === 'toml') {
    const existing = await readTextSafe(file) ?? ''
    const doc = parseToml(existing)
    for (const server of servers) {
      doc.blocks.set(server.header, codexBlockLines(server))
      if (!doc.order.includes(server.header)) doc.order.push(server.header)
    }
    await writeTextAtomic(file, serializeToml(doc))
    return
  }
  const data = (await readJsonSafe(file)) ?? {}
  for (const server of servers) {
    if (t.handler === 'mcpServers') {
      if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {}
      data.mcpServers[server.key] = {
        command: server.command,
        args: server.args,
        ...(t.extra ? t.extra(entry, server.key) : {}),
      }
    } else if (t.handler === 'opencode') {
      if (!data.mcp || typeof data.mcp !== 'object') data.mcp = {}
      data.mcp[server.key] = { type: 'local', command: [server.command, ...(Array.isArray(server.args) ? server.args : [])], enabled: true }
    } else if (t.handler === 'vscode') {
      if (!data.servers || typeof data.servers !== 'object') data.servers = {}
      data.servers[server.key] = { type: 'stdio', command: server.command, args: server.args }
    }
  }
  await writeJsonAtomic(file, data)
}

async function fileUninstall(t, file) {
  if (t.handler === 'toml') {
    const existing = await readTextSafe(file)
    if (existing == null) return
    const doc = parseToml(existing)
    const headers = [CODEX_HEADER, CODEX_PDF_HEADER]
    if (!headers.some(h => doc.blocks.has(h))) return
    for (const header of headers) {
      doc.blocks.delete(header)
      doc.order = doc.order.filter(k => k !== header)
    }
    await writeTextAtomic(file, serializeToml(doc))
    return
  }
  const data = await readJsonSafe(file)
  if (data == null) return
  if (t.handler === 'mcpServers' && data.mcpServers) {
    delete data.mcpServers[ECHO_KEY]
    delete data.mcpServers[ECHO_PDF_KEY]
  } else if (t.handler === 'opencode' && data.mcp) {
    delete data.mcp[ECHO_KEY]
    delete data.mcp[ECHO_PDF_KEY]
  } else if (t.handler === 'vscode' && data.servers) {
    delete data.servers[ECHO_KEY]
    delete data.servers[ECHO_PDF_KEY]
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
    if (!hasCommand || !hasEcho) return 'stale'
    // A config written before Echo's PDF server existed holds only the browser
    // entry. Report stale so the 7-day auto-register adds the missing server
    // instead of leaving those users without read_pdf.
    return doc.blocks.has(CODEX_PDF_HEADER) ? 'registered' : 'stale'
  }
  const data = await readJsonSafe(file)
  if (data == null) return 'absent'
  let node, pdfNode
  if (t.handler === 'mcpServers') { node = data.mcpServers?.[ECHO_KEY]; pdfNode = data.mcpServers?.[ECHO_PDF_KEY] }
  else if (t.handler === 'opencode') { node = data.mcp?.[ECHO_KEY]; pdfNode = data.mcp?.[ECHO_PDF_KEY] }
  else if (t.handler === 'vscode') { node = data.servers?.[ECHO_KEY]; pdfNode = data.servers?.[ECHO_PDF_KEY] }
  if (!node) return 'absent'
  if (!(looksLikeEcho(node.command) || looksLikeEcho(node.args))) return 'stale'
  return pdfNode ? 'registered' : 'stale'
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
