#!/usr/bin/env node
/**
 * Patch @playwright/mcp's nested playwright-core for Echo.
 *
 * This runs after npm install (via the postinstall hook) because patch-package
 * doesn't handle files inside nested node_modules/ directories.
 *
 * Edits:
 *   1. Add `press_enter` and `clear` to the browser_type schema
 *   2. Add `clear` handler (fill empty string before typing)
 *   3. Accept `press_enter` as alias for `submit` in the handler
 *   4. Cap browser_evaluate INLINE output at 20,000 chars. Without this, one
 *      evaluate can return megabytes straight into the model's context.
 *      When `filename` is passed, the FULL result is still written to a file.
 *   5. Snapshots of 8,000 chars or fewer go INLINE; bigger ones use a file.
 *      Without this, browser_navigate always returns a dead-end file link
 *      (the "empty result" bug) — even for nearly empty pages.
 *   6. After navigation, settle for network idle (max 5s, best effort,
 *      never fatal). Pages that fetch data after `load` are read too early
 *      otherwise. Accepted trade: up to ~5s slower on busy pages.
 *
 * Every edit is idempotent: each has its own marker and is a no-op if present.
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
  let applied = 0
  let present = 0

  const edit = (name, marker, pattern, replacement) => {
    if (code.includes(marker)) {
      present++
      return
    }
    // Normalize line endings: this script may be checked out with CRLF while
    // the npm-installed bundle is LF-only. Without this, a multi-line anchor
    // (the evaluate edit) would silently fail to match on a fresh checkout.
    pattern = pattern.replace(/\r\n/g, '\n')
    replacement = replacement.replace(/\r\n/g, '\n')
    if (!code.includes(pattern)) {
      throw new Error(`${name}: anchor not found — @playwright/mcp version may have changed`)
    }
    code = code.replace(pattern, replacement)
    applied++
    console.error(`[patch-playwright-mcp] applied: ${name}`)
  }

  // ── Edit 1: Add press_enter and clear to the schema ────────────────
  edit(
    'type schema (press_enter/clear)',
    'press_enter: z13.boolean().optional()',
    `      submit: z13.boolean().optional().describe("Whether to submit entered text (press Enter after)"),`,
    `      submit: z13.boolean().optional().describe("Whether to submit entered text (press Enter after)"),
      press_enter: z13.boolean().optional().describe("Alias for submit — press Enter after typing"),
      clear: z13.boolean().optional().describe("Whether to clear the field before typing"),`
  )

  // ── Edit 2: Add clear handler block before slowly ──────────────────
  edit(
    'type clear handler',
    'if (params2.clear) {',
    `          if (params2.slowly) {`,
    `          // Clear field first if requested
          if (params2.clear) {
            response2.addCode("await page." + resolved + ".fill('');");
            await locator2.fill('', tab2.actionTimeoutOptions);
          }
          if (params2.slowly) {`
  )

  // ── Edit 3a: Change submit check to accept both submit and press_enter ──
  edit(
    'type submit alias (handler)',
    'if (params2.submit || params2.press_enter) {',
    `          if (params2.submit) {`,
    `          // Support both submit (internal name) and press_enter (AI tool convention)
          if (params2.submit || params2.press_enter) {`
  )

  // ── Edit 3b: In the waitForCompletion guard ────────────────────────
  edit(
    'type submit alias (wait guard)',
    'if (params2.submit || params2.press_enter || params2.slowly)',
    `        if (params2.submit || params2.slowly)`,
    `        if (params2.submit || params2.press_enter || params2.slowly)`
  )

  // ── Edit 4: Cap browser_evaluate inline output ─────────────────────
  // Only truncates the INLINE path (no filename given). With a filename the
  // full result is expected to go to disk, so it is left untouched.
  edit(
    'evaluate output cap',
    'const EVAL_LIMIT = 20000;',
    `          const text = JSON.stringify(evalResult.result, null, 2) ?? "undefined";
          await response.addResult("Evaluation result", text, { prefix: "result", ext: "json", suggestedFilename: params.filename });`,
    `          const text = JSON.stringify(evalResult.result, null, 2) ?? "undefined";
          const EVAL_LIMIT = 20000;
          if (!params.filename && text.length > EVAL_LIMIT) {
            const hidden = text.length - EVAL_LIMIT;
            await response.addResult("Evaluation result (truncated)", text.slice(0, EVAL_LIMIT) + "\\n\\n[Output truncated: " + hidden + " of " + text.length + " chars hidden. Pass filename to save the full result, or narrow the expression.]", { prefix: "result", ext: "json" });
          } else {
            await response.addResult("Evaluation result", text, { prefix: "result", ext: "json", suggestedFilename: params.filename });
          }`
  )

  // ── Edit 5: Inline small snapshots instead of always writing a file ─
  // Original behavior: "full" mode always writes to a file and returns a
  // link. New behavior: snapshots under 8,000 chars come back inline; an
  // explicitly requested filename still always writes a file.
  edit(
    'inline small snapshots',
    'ariaSnapshot.length > 8e3',
    `          if (this._includeSnapshot !== "explicit" || this._includeSnapshotFileName) {`,
    `          if ((this._includeSnapshot !== "explicit" || this._includeSnapshotFileName) && (this._includeSnapshotFileName || tabSnapshot.ariaSnapshot.length > 8e3)) {`
  )

  // ── Edit 6: Settle for network idle after navigation ───────────────
  // waitForLoadState() swallows its own timeout errors, so this can never
  // make navigation fail — it only gives late-fetching pages extra time.
  edit(
    'network idle settle',
    'waitForLoadState("networkidle", { timeout: 5e3 })',
    `        await this.waitForLoadState("load", { timeout: 5e3 });`,
    `        await this.waitForLoadState("load", { timeout: 5e3 });
        await this.waitForLoadState("networkidle", { timeout: 5e3 });`
  )

  // ── Write back ─────────────────────────────────────────────────────
  if (applied > 0) {
    writeFileSync(targetFile, code, 'utf-8')
    console.error(`[patch-playwright-mcp] Patch applied: ${applied} edit(s) written, ${present} already present.`)
  } else {
    console.error(`[patch-playwright-mcp] All ${present} edits already present — nothing to do.`)
  }
} catch (err) {
  console.error(`[patch-playwright-mcp] ERROR: ${err.message}`)
  process.exit(1)
}
