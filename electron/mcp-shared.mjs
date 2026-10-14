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
import crypto from 'node:crypto'

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
 * The seven tools a browsing loop reaches for first. They stay `direct` on the
 * pi target; the other 56 ride the server's `codemode` exposure and are fetched
 * only when wanted.
 */
const HOT_PATH = [
  'browser_navigate',
  'browser_evaluate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_wait_for',
  'browser_run_code_unsafe',
]

/**
 * The only thing a fresh agent is told before it decides whether Echo is worth
 * looking at, so it front-loads the seven direct tools and stays under pi's
 * 250-character cut-off.
 */
const BROWSER_DESCRIPTION =
  'Browser. Direct: navigate, evaluate, snapshot, click, type, wait_for, run_code_unsafe. ' +
  '56 more (cookies, storage, screenshots, PDF, network, tabs, video) fetched on demand. ' +
  'Use for logged-in or JS pages.'

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
    // pi's own config fields, saved beside command/args. Seven hot tools stay
    // declared; the other 56 ride the server's `codemode` exposure and are
    // fetched on demand (sandbox-verified 2026-10-14). echo-pdf stays direct —
    // one tool, not worth splitting.
    extra: (_entry, key) => {
      if (key === ECHO_PDF_KEY) return { exposure: 'direct', description: PDF_DESCRIPTION }
      return {
        exposure: 'codemode',
        toolExposure: Object.fromEntries(HOT_PATH.map((name) => [name, 'direct'])),
        description: BROWSER_DESCRIPTION,
      }
    },
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

// ── echo-browser skill ────────────────────────────────────
//
// The skill tells an AI client how to drive Echo: which tools it can see, how
// to reach the ones it cannot, and the traps that cost turns. Pi advertises a
// skill by name + description and loads the body only when a task matches, so
// this costs ~85 tokens until it is actually needed.
//
// `.echo-managed.json` records a sha256 of every file Echo wrote. A file whose
// hash no longer matches was edited by the user, and is never overwritten or
// deleted — Echo only ever replaces what it wrote and nobody touched.

const SKILL_NAME = 'echo-browser'
const SKILL_MANIFEST = '.echo-managed.json'

/** Written only where the parent app folder already exists (same rule as TARGETS.requireDir).
 *
 * Deliberately NOT written to `~/.agents/skills/`, even though Pi also reads it:
 * Pi warns on a duplicate skill name and keeps only the first, so writing the same
 * skill to two locations Pi scans would produce a collision warning for no gain. */
const SKILL_DIRS = [
  {
    id: 'pi',
    name: 'pi',
    dir: path.join(HOME, '.pi', 'agent', 'skills', SKILL_NAME),
    requireDir: path.join(HOME, '.pi'),
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    dir: path.join(HOME, '.claude', 'skills', SKILL_NAME),
    requireDir: path.join(HOME, '.claude'),
  },
]

/** sha256 of a file, or null if it does not exist / cannot be read. */
async function sha256File(p) {
  try { return crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex') }
  catch { return null }
}

/** Relative paths of every file under root, excluding the manifest. */
async function listFilesRecursive(root, rel = '') {
  let entries
  try { entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }) }
  catch { return [] }
  const out = []
  for (const e of entries) {
    const r = rel ? path.join(rel, e.name) : e.name
    if (e.isDirectory()) out.push(...await listFilesRecursive(root, r))
    else if (e.isFile() && e.name !== SKILL_MANIFEST) out.push(r)
  }
  return out
}

async function rmdirIfEmpty(p) {
  try { await fs.rmdir(p) } catch { /* not empty, or already gone */ }
}

/** Copy the skill into every client's skills directory that applies.
 * @param {string} skillsDir  Absolute path to the shipped skills folder.
 * @returns {Promise<AppStatus[]>} */
export async function installSkill(skillsDir) {
  const apps = []
  if (!skillsDir) return apps
  // Source root is the skill's OWN folder (skillsDir is the parent, so more
  // skills can ship later without changing this).
  const source = await listFilesRecursive(path.join(skillsDir, SKILL_NAME))
  if (source.length === 0) return apps

  for (const t of SKILL_DIRS) {
    const label = `${t.name} skill`
    if (t.requireDir && !(await exists(t.requireDir))) {
      apps.push({ id: `skill:${t.id}`, name: label, status: 'not-installed', note: 'app not present' })
      continue
    }

    const manifestPath = path.join(t.dir, SKILL_MANIFEST)
    let prev = { managedBy: ECHO_KEY, files: {} }
    try { prev = (await readJsonSafe(manifestPath)) || prev } catch { /* unreadable manifest — rewrite it */ }

    const files = {}
    const foreign = []
    for (const rel of source) {
      const to = path.join(t.dir, rel)
      const srcHash = await sha256File(path.join(skillsDir, SKILL_NAME, rel))
      const onDisk = await sha256File(to)
      const recorded = prev.files?.[rel]

      // Already byte-identical — ours, or an identical copy. Adopt it.
      if (onDisk && onDisk === srcHash) { files[rel] = srcHash; continue }

      // Present and NOT the last thing Echo wrote: the user's own file, or an
      // edit to ours. Never touch it, and never record it as ours — recording
      // it would make the NEXT run read it as ours and overwrite it.
      if (onDisk && onDisk !== recorded) { foreign.push(rel); continue }

      // Ours and unedited (onDisk === recorded), or absent: write the new copy.
      await writeTextAtomic(to, await fs.readFile(path.join(skillsDir, SKILL_NAME, rel), 'utf-8'))
      files[rel] = srcHash
    }
    await writeJsonAtomic(manifestPath, { managedBy: ECHO_KEY, files, foreign })

    apps.push({
      id: `skill:${t.id}`,
      name: label,
      status: 'registered',
      path: t.dir,
      note: foreign.length ? `${foreign.length} kept (not written by Echo)` : undefined,
    })
  }
  return apps
}

/** Remove the skill, but only the files Echo wrote and nobody edited.
 * @returns {Promise<AppStatus[]>} */
export async function uninstallSkill() {
  const apps = []
  for (const t of SKILL_DIRS) {
    const label = `${t.name} skill`
    const manifestPath = path.join(t.dir, SKILL_MANIFEST)
    let manifest = null
    try { manifest = await readJsonSafe(manifestPath) } catch { /* unreadable — leave it alone */ }

    if (!manifest || manifest.managedBy !== ECHO_KEY) {
      const present = await exists(t.dir)
      apps.push({ id: `skill:${t.id}`, name: label, status: present ? 'stale' : 'not-installed', path: present ? t.dir : undefined })
      continue
    }

    let kept = 0
    for (const [rel, hash] of Object.entries(manifest.files || {})) {
      const p = path.join(t.dir, rel)
      const onDisk = await sha256File(p)
      if (onDisk === null) continue
      if (onDisk === hash) await fs.unlink(p)
      else kept++
    }

    if (kept === 0) {
      await fs.unlink(manifestPath).catch(() => {})
      await rmdirIfEmpty(path.join(t.dir, 'references'))
      await rmdirIfEmpty(t.dir)
    }
    // A file Echo never wrote is not in manifest.files, so it survives above —
    // and if any is still there, the directory cannot be removed either.
    const leftBehind = await exists(t.dir)
    apps.push({
      id: `skill:${t.id}`,
      name: label,
      status: kept || leftBehind ? 'stale' : 'absent',
      path: leftBehind ? t.dir : undefined,
      note: leftBehind ? 'kept (not written by Echo)' : undefined,
    })
  }
  return apps
}

// ── Aggregate operations (used by app + standalone uninstall) ─────────────

/** Install Echo into every target. Returns per-app status.
 * @param {EchoEntry} entry
 * @param {{ skillsDir?: string }} [options]  Shipped skills folder; skipped when absent.
 * @returns {Promise<AppStatus[]>} */
export async function installAll(entry, options = {}) {
  const apps = []
  for (const t of TARGETS) {
    const res = await targetInstall(t, entry)
    apps.push({ id: t.id, name: t.name, status: res.status, path: res.path, note: res.note })
  }
  apps.push(...await installSkill(options.skillsDir))
  return apps
}

/** Remove Echo from every target, and the skill it wrote. Returns per-app resulting status.
 * @returns {Promise<AppStatus[]>} */
export async function unregisterAll() {
  const apps = []
  for (const t of TARGETS) {
    await targetUninstall(t)
    apps.push(await targetStatus(t))
  }
  apps.push(...await uninstallSkill())
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
