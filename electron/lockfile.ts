/**
 * Lockfile — tells MCP tools where to find Chromium's CDP endpoint.
 *
 * Written by Echo on startup. Read by echo-mcp-launcher.js (the thin
 * Node script that spawns @playwright/mcp pointed at Chromium's CDP).
 *
 * Schema: cdpPort + pid + version + startedAt.
 * Atomic write (temp + rename) prevents half-written files on crash.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { log } from './log.js'

export interface LockfileData {
  cdpPort: number
  pid: number
  version: string
  startedAt: string
}

export function getLockfilePath(): string {
  return path.join(os.homedir(), '.echo', 'mcp.json')
}

export async function writeLockfile(
  cdpPort: number,
  pid: number,
  version: string,
): Promise<void> {
  const dir = path.dirname(getLockfilePath())
  await fs.mkdir(dir, { recursive: true })

  const data: LockfileData = {
    cdpPort,
    pid,
    version,
    startedAt: new Date().toISOString(),
  }

  const tmpPath = getLockfilePath() + '.tmp'
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmpPath, getLockfilePath())

  log('lockfile', 'info', 'lockfile written', { cdpPort })
}

export async function readLockfile(): Promise<LockfileData | null> {
  try {
    const raw = await fs.readFile(getLockfilePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed.cdpPort !== 'number') return null
    return parsed as LockfileData
  } catch {
    return null
  }
}

export async function deleteLockfile(): Promise<void> {
  try { await fs.unlink(getLockfilePath()) } catch {}
  try { await fs.unlink(getLockfilePath() + '.tmp') } catch {}
}
