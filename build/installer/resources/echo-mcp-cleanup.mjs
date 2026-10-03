/**
 * Echo MCP Cleanup — standalone uninstall entry (NO Electron).
 *
 * Run by the NSIS uninstaller (installer/nsh/hooks.nsh customUnInit) via the
 * bundled node.exe, BEFORE the app files are deleted:
 *
 *   "<INSTDIR>\resources\node.exe" "<INSTDIR>\resources\echo-mcp-cleanup.mjs"
 *
 * It removes the "echo" entry from every supported AI coding app's config —
 * the mirror of what the app does at install/startup. Removal is best-effort:
 * it logs each app and always exits 0 so the uninstaller never aborts.
 *
 * The actual logic lives in ./mcp-shared.mjs (shared with the Electron app),
 * so this file is just a tiny entry point — single source of truth.
 */

import { unregisterAll, formatLines } from './mcp-shared.mjs'

try {
  const apps = await unregisterAll()
  process.stdout.write('Echo MCP cleanup:\n' + formatLines(apps) + '\n')
} catch (err) {
  // Never fail the uninstaller — just log.
  process.stderr.write(`Echo MCP cleanup error (ignored): ${String(err)}\n`)
}
