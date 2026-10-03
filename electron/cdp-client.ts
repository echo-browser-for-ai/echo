/**
 * CDP Client — talks to bundled Chromium via Chrome DevTools Protocol.
 *
 * Uses HTTP for tab operations (/json/new, /json/list) and WebSocket
 * for CDP commands (Browser.getWindowForTarget, Browser.setWindowBounds).
 * Node.js built-in WebSocket — no npm dependency.
 *
 * Key operations:
 *  - openTab(url): opens a new tab via /json/new HTTP endpoint
 *  - hideChromiumWindow: minimizes via CDP Browser.setWindowBounds
 *  - showChromiumWindowNormal: restores via CDP Browser.setWindowBounds
 *  - isChromiumWindowVisible: checks via CDP Browser.getWindowForTarget
 *  - keepChromiumInBackground: Win32 SetWindowPos via PowerShell (fallback only)
 */

import { log } from './log.js'
import { request as httpRequest } from 'node:http'
import { getCdpPort } from './chrome.js'

interface CdpTarget {
  id: string
  title: string
  type: string
  url: string
  webSocketDebuggerUrl: string
}

/**
 * Make an HTTP request to the CDP server.
 */
function cdpRequest(cdpPort: number, path: string, method: string = 'GET', timeoutMs = 5000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port: cdpPort, path, method, timeout: timeoutMs },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode || 0, body }))
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

/**
 * Get the list of all targets from Chromium.
 */
async function getTargets(cdpPort: number): Promise<CdpTarget[]> {
  const { status, body } = await cdpRequest(cdpPort, '/json/list')
  if (status !== 200) throw new Error(`HTTP ${status}: ${body.slice(0, 200)}`)
  try { return JSON.parse(body) }
  catch (err) { throw new Error(`failed to parse /json/list: ${err}`) }
}

// ── CDP WebSocket commands ──

let _cdpId = 0
function nextCdpId(): number {
  _cdpId = (_cdpId + 1) % 0x7FFFFFFF
  return _cdpId
}

/**
 * Send a CDP command to Chromium via WebSocket and return the result.
 * Connects to the first available page target, sends the command, waits for response, and closes.
 */
async function cdpCommand(cdpPort: number, method: string, params: any = {}): Promise<any> {
  const targets = await getTargets(cdpPort)
  // Prefer a page target for Browser domain commands
  const target = targets.find(t => t.type === 'page') || targets[0]
  if (!target) throw new Error('No CDP targets available')

  const wsUrl = target.webSocketDebuggerUrl
  log('cdp', 'debug', 'sending CDP command', { method, wsUrl: wsUrl.slice(0, 60) })

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const id = nextCdpId()
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); reject(new Error('CDP command timeout')) }
    }, 5000)

    ws.onopen = () => {
      ws.send(JSON.stringify({ id, method, params }))
    }

    ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf-8')
      log('cdp', 'debug', 'CDP WS received', { raw: raw.slice(0, 200) })
      try {
        const msg = JSON.parse(raw)
        if (msg.id === id) {
          clearTimeout(timer)
          if (!settled) { settled = true; ws.close() }
          if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`))
          else resolve(msg.result)
        }
        // Also handle event messages (no id) that might contain results
        if (msg.method === 'Browser.windowBoundsChanged' && !settled) {
          clearTimeout(timer)
          settled = true
          ws.close()
          resolve({})
        }
      } catch (err) {
        log('cdp', 'warn', 'CDP WS parse error', { raw: raw.slice(0, 100), err: String(err) })
      }
    }

    ws.onerror = (err) => {
      clearTimeout(timer)
      if (!settled) { settled = true; reject(new Error(`WebSocket error: ${err}`)) }
    }

    ws.onclose = () => {
      clearTimeout(timer)
      if (!settled) { settled = true; reject(new Error('WebSocket closed before response')) }
    }
  })
}

// ── Window operations via CDP (fast, no PowerShell) ──

/**
 * Check if the Chromium window is currently in a normal (not minimized) state.
 * Uses CDP Browser.getWindowForTarget.
 */
export async function isChromiumWindowVisible(): Promise<boolean> {
  try {
    const port = getCdpPort()
    if (!port) return false
    const result = await cdpCommand(port, 'Browser.getWindowForTarget', {})
    // result: { windowId: number, bounds: { windowState: 'normal'|'minimized'|'maximized'|'fullscreen' } }
    const state = result?.bounds?.windowState
    log('cdp', 'debug', 'window state', { state })
    return state !== 'minimized'
  } catch (err) {
    log('cdp', 'error', 'failed to check window state', { err: String(err) })
    return false
  }
}

/**
 * Minimize the browser to the taskbar via CDP Browser.setWindowBounds.
 */
export async function hideChromiumWindow(): Promise<boolean> {
  try {
    const port = getCdpPort()
    if (!port) return false
    const result = await cdpCommand(port, 'Browser.getWindowForTarget', {})
    const windowId = result?.windowId
    if (!windowId) return false
    await cdpCommand(port, 'Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'minimized' }
    })
    log('cdp', 'info', 'minimized window via CDP', { windowId })
    return true
  } catch (err) {
    log('cdp', 'error', 'failed to minimize via CDP', { err: String(err) })
    return false
  }
}

/**
 * Restore the browser from minimized state via CDP Browser.setWindowBounds.
 */
export async function showChromiumWindowNormal(): Promise<boolean> {
  try {
    const port = getCdpPort()
    if (!port) return false
    const result = await cdpCommand(port, 'Browser.getWindowForTarget', {})
    const windowId = result?.windowId
    if (!windowId) return false

    // Two-step restore: first exit minimized, then maximize to fill screen
    await cdpCommand(port, 'Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal' }
    })
    await cdpCommand(port, 'Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' }
    })
    log('cdp', 'info', 'restored window via CDP', { windowId })
    return true
  } catch (err) {
    log('cdp', 'error', 'failed to restore via CDP', { err: String(err) })
    return false
  }
}

/**
 * Minimize the window to taskbar (used on initial launch to keep it out of the way).
 */
export async function keepChromiumInBackground(): Promise<boolean> {
  return hideChromiumWindow()
}

// ── HTTP-based tab operations (unchanged) ──


// ── HTTP-based tab operations (unchanged) ──

/**
 * Open a new tab with the given URL.
 * Uses /json/new HTTP endpoint — Chromium v152 requires PUT, not GET.
 */
export async function openTab(cdpPort: number, url: string): Promise<string> {
  log('cdp', 'info', 'openTab called', { cdpPort, url })
  try {
    const { status, body } = await cdpRequest(cdpPort, `/json/new?${encodeURIComponent(url)}`, 'PUT', 5000)
    if (status !== 200) {
      log('cdp', 'error', 'failed to open tab', { status, body: body.slice(0, 200) })
      throw new Error(`HTTP ${status}: ${body.slice(0, 200)}`)
    }
    const result = JSON.parse(body)
    log('cdp', 'info', 'opened tab', { url, targetId: result.id })
    return result.id
  } catch (err) {
    log('cdp', 'error', 'openTab failed', { err: String(err), cdpPort, url })
    throw err
  }
}

/**
 * List all current targets.
 */
export async function listTargets(cdpPort: number): Promise<CdpTarget[]> {
  return getTargets(cdpPort)
}

/**
 * Close every page target. With --keep-alive-for-test the browser process
 * stays alive (windowless) after the last page closes — used to "hide to tray".
 * Returns the number of page targets it attempted to close.
 */
export async function closeAllPageTargets(cdpPort: number): Promise<number> {
  const targets = await getTargets(cdpPort);
  const pages = targets.filter((t) => t.type === "page");
  for (const p of pages) {
    try {
      await cdpRequest(cdpPort, `/json/close/${p.id}`, "GET");
    } catch {
      /* best-effort — keep closing the rest */
    }
  }
  return pages.length;
}

/**
 * Returns true if at least one page target exists (i.e. the browser has a
 * window shown). False means windowless/hidden-to-tray.
 */
export async function hasPageTargets(cdpPort: number): Promise<boolean> {
  const targets = await getTargets(cdpPort);
  return targets.some((t) => t.type === "page");
}
