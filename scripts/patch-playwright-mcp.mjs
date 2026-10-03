#!/usr/bin/env node
/**
 * Patch @playwright/mcp's nested playwright-core to accept `clear` and `press_enter` params.
 *
 * This runs after npm install (via postinstall hook) because patch-package doesn't
 * handle files inside nested node_modules/ directories.
 *
 * Edits:
 *   1. Add `press_enter` and `clear` to the browser_type schema
 *   2. Add `clear` handler (fill empty string before typing)
 *   3. Accept `press_enter` as alias for `submit` in the handler
 *
 * All edits are idempotent — if the patch is already applied, they're no-ops.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// The nested playwright-core that ships with @playwright/mcp
const targetFile = path.join(
  repoRoot,
  'node_modules',
  '@playwright',
  'mcp',
  'node_modules',
  'playwright-core',
  'lib',
  'coreBundle.js'
)

try {
  let code = readFileSync(targetFile, 'utf-8')

  // ── Guard: skip if already patched ─────────────────────────────────
  if (code.includes('press_enter: z13.boolean().optional()')) {
    console.error('[patch-playwright-mcp] Patch already applied — skipping.')
    process.exit(0)
  }

  // ── Edit 1: Add press_enter and clear to the schema ────────────────
  const schemaPattern = `      submit: z13.boolean().optional().describe("Whether to submit entered text (press Enter after)"),`
  const schemaReplacement = `      submit: z13.boolean().optional().describe("Whether to submit entered text (press Enter after)"),
      press_enter: z13.boolean().optional().describe("Alias for submit — press Enter after typing"),
      clear: z13.boolean().optional().describe("Whether to clear the field before typing"),`
  if (!code.includes(schemaPattern)) {
    throw new Error('Schema pattern not found — @playwright/mcp version may have changed')
  }
  code = code.replace(schemaPattern, schemaReplacement)

  // ── Edit 2: Add clear handler block before slowly ─────────────────
  const clearPattern = `          if (params2.slowly) {`
  const clearReplacement = `          // Clear field first if requested
          if (params2.clear) {
            response2.addCode("await page." + resolved + ".fill('');");
            await locator2.fill('', tab2.actionTimeoutOptions);
          }
          if (params2.slowly) {`
  if (!code.includes(clearPattern)) {
    throw new Error('Clear handler pattern not found — @playwright/mcp version may have changed')
  }
  code = code.replace(clearPattern, clearReplacement)

  // ── Edit 3: Change submit check to accept both submit and press_enter ──
  // In the handler body
  const submitPattern1 = `          if (params2.submit) {`
  const submitReplacement1 = `          // Support both submit (internal name) and press_enter (AI tool convention)
          if (params2.submit || params2.press_enter) {`
  if (!code.includes(submitPattern1)) {
    throw new Error('Handler submit pattern not found — @playwright/mcp version may have changed')
  }
  code = code.replace(submitPattern1, submitReplacement1)

  // In the waitForCompletion guard
  const submitPattern2 = `        if (params2.submit || params2.slowly)`
  const submitReplacement2 = `        if (params2.submit || params2.press_enter || params2.slowly)`
  if (!code.includes(submitPattern2)) {
    throw new Error('Wait guard submit pattern not found — @playwright/mcp version may have changed')
  }
  code = code.replace(submitPattern2, submitReplacement2)

  // ── Write back ─────────────────────────────────────────────────────
  writeFileSync(targetFile, code, 'utf-8')
  console.error('[patch-playwright-mcp] Patch applied successfully.')

} catch (err) {
  console.error(`[patch-playwright-mcp] ERROR: ${err.message}`)
  process.exit(1)
}
