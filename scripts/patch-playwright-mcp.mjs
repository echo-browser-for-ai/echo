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
 *   7. Encrypt saved storage state at rest with Windows DPAPI (echocrypt.exe),
 *      into ~/.echo/sessions/ - a directory deliberately outside outputDir so
 *      the 50 MB _enforceOutputBudget sweep cannot delete saved logins.
 *   8. Decrypt that state on restore, deleting the temp plaintext immediately.
 *      Pre-patch PLAINTEXT files still load, with a warning.
 *   9. Route caller-supplied RELATIVE filenames to outputDir instead of the AI
 *      app's cwd. Absolute paths are still honoured verbatim.
 *  10-13. Mask cookie values in browser_cookie_list / browser_cookie_get by
 *      default. Encrypting the file is necessary but NOT sufficient: these
 *      tools return raw values straight into the model's context, so a page
 *      that talks an AI into calling them harvests live sessions without ever
 *      touching the filesystem. `reveal: true` is the opt-out.
 *  14. Warn in browser_storage_state's description that the file holds live
 *      credentials for every signed-in site (UX, not enforcement).
 *
 * Every edit is idempotent: each has its own marker and is a no-op if present.
 * edit() also asserts that a marker appears in its own replacement — without
 * that check an edit whose marker is absent from its output succeeds once and
 * then aborts on the second run.
 *
 * NOTE: this patches only <repo>/node_modules. scripts/vendor-runtime.sh copies
 * @playwright into build/installer/resources/ for packaging, so it must run
 * AFTER postinstall. `npm run build:installer` does vendor first and build
 * second, which is correct.
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
    // A marker that is NOT present in its own replacement is a latent
    // idempotency bug: the first run succeeds, the second run cannot find the
    // anchor again and aborts. Catch it here rather than on the next
    // `npm install`.
    if (!replacement.includes(marker)) {
      throw new Error(
        `${name}: BUG — marker is not present in the replacement, so this ` +
        `edit would abort on its second run. Marker: ${JSON.stringify(marker)}`)
    }
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

  // ── Edit 7: encrypt saved storage state (DPAPI) ───────────────────
  // `browser_storage_state` writes every cookie + localStorage entry the user
  // is signed into as PLAINTEXT JSON. A stress test produced a 1.9 MB file with
  // 768 live auth cookies sitting in the user's project dir, not gitignored.
  //
  // Fix: pipe the serialized state through echocrypt.exe (Windows DPAPI, keyed
  // to the user's account) into ~/.echo/sessions/, a directory deliberately
  // OUTSIDE outputDir so the 50 MB _enforceOutputBudget sweep can never delete
  // saved logins (that sweep is recursive and silently unlinks oldest-first).
  //
  // The plaintext is piped over STDIN so it never touches the disk at all.
  // Fails CLOSED: if echocrypt.exe is missing or errors, we throw and save
  // nothing, rather than silently falling back to a plaintext file.
  edit(
    'storage_state encrypt at rest',
    'Echo: storage-state encrypted at rest',
    `        const resolvedFile = await response2.resolveClientFile({ prefix: "storage-state", ext: "json", suggestedFilename: params2.filename }, "Storage state");
        response2.addCode(\`await page.context().storageState({ path: '\${resolvedFile.relativeName}' });\`);
        await response2.addFileResult(resolvedFile, serializedState);`,
    `        // Echo: storage-state encrypted at rest (DPAPI-encrypted at rest)
        const __ecFs = require("fs");
        const __ecPath = require("path");
        const __ecOs = require("os");
        const __ecCp = require("child_process");
        const __ecExe = process.env.ECHO_CRYPTO_EXE;
        if (!__ecExe || !__ecFs.existsSync(__ecExe))
          throw new Error("Echo: echocrypt.exe not found at " + __ecExe + ". Refusing to save cookies unencrypted.");
        const __ecDir = __ecPath.join(__ecOs.homedir(), ".echo", "sessions");
        __ecFs.mkdirSync(__ecDir, { recursive: true });
        let __ecName = __ecPath.basename(String(params2.filename || "")).replace(/\\.json(\\.enc)?$/i, "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[.]+/, "");
        if (!__ecName)
          __ecName = "storage-state-" + new Date().toISOString().replace(/[:.]/g, "-");
        const __ecOut = __ecPath.join(__ecDir, __ecName + ".json.enc");
        const __ecRun = __ecCp.spawnSync(__ecExe, ["encrypt-stdin", __ecOut], { input: serializedState, encoding: "utf-8", windowsHide: true });
        if (__ecRun.status !== 0 || !__ecFs.existsSync(__ecOut))
          throw new Error("Echo: could not encrypt saved logins (" + String(__ecRun.stderr || "exit " + __ecRun.status).trim() + "). Nothing was saved.");
        response2.addTextResult("- [Storage state (encrypted, " + __ecOut + ")]");`
  )

  // ── Edit 8: decrypt storage state on restore ───────────────────────
  // Mirror of edit 7. If the file starts with the DPAPI magic we decrypt it to
  // a temp file (Playwright's setStorageState() requires a real path), hand it
  // over, then delete the temp immediately in a finally block.
  //
  // A pre-patch PLAINTEXT file still loads, so sessions saved before this
  // patch keep working - but it is reported so the user is not left believing
  // an unencrypted file is protected.
  edit(
    'storage_state decrypt on restore',
    'Echo: storage-state decrypt on restore',
    `        const resolvedFilename = await response2.resolveClientFilename(params2.filename);
        await browserContext.setStorageState(resolvedFilename);
        response2.addTextResult(\`Storage state restored from \${params2.filename}\`);`,
    `        // Echo: storage-state decrypt on restore
        const __ecFs2 = require("fs");
        const __ecPath2 = require("path");
        const __ecOs2 = require("os");
        const __ecCp2 = require("child_process");
        const resolvedFilename = await response2.resolveClientFilename(params2.filename);
        const __ecHeader = Buffer.alloc(4);
        const __ecFd = __ecFs2.openSync(resolvedFilename, "r");
        __ecFs2.readSync(__ecFd, __ecHeader, 0, 4, 0);
        __ecFs2.closeSync(__ecFd);
        const __ecIsDpapi = __ecHeader[0] === 1 && __ecHeader[1] === 0 && __ecHeader[2] === 0 && __ecHeader[3] === 0;
        if (__ecIsDpapi) {
          const __ecExe2 = process.env.ECHO_CRYPTO_EXE;
          if (!__ecExe2 || !__ecFs2.existsSync(__ecExe2))
            throw new Error("Echo: echocrypt.exe not found at " + __ecExe2 + ". Cannot decrypt saved logins.");
          const __ecTmp = __ecPath2.join(__ecOs2.tmpdir(), "echo-restore-" + process.pid + "-" + Date.now() + ".json");
          const __ecRun2 = __ecCp2.spawnSync(__ecExe2, ["decrypt-stdin", resolvedFilename], { maxBuffer: 256 * 1024 * 1024, windowsHide: true });
          if (__ecRun2.status !== 0)
            throw new Error("Echo: could not decrypt saved logins (" + String(__ecRun2.stderr || "exit " + __ecRun2.status).trim() + "). The file may belong to a different Windows account.");
          __ecFs2.writeFileSync(__ecTmp, __ecRun2.stdout);
          try {
            await browserContext.setStorageState(__ecTmp);
          } finally {
            // The decrypted temp MUST not survive the call.
            try { __ecFs2.unlinkSync(__ecTmp); } catch {}
          }
          response2.addTextResult("Storage state restored (decrypted from " + resolvedFilename + ")");
        } else {
          await browserContext.setStorageState(resolvedFilename);
          response2.addTextResult("Storage state restored from " + params2.filename + " (legacy UNENCRYPTED file - re-save it to get a protected one)");
        }`
  )

  // ── Edit 9: route explicit filenames into outputDir ────────────────
  // Upstream resolves a caller-supplied filename against the AI app's cwd, so
  // `browser_take_screenshot({filename:'x.png'})` wrote into the user's
  // project folder instead of ~/.echo/output. Only the auto-name branch used
  // outputFile(). Route relative names to outputFile(), keep absolute paths
  // (drive letter or UNC) exactly as the caller asked.
  edit(
    'explicit filename routing',
    'Echo: relative output files go to outputDir',
    `      async resolveClientFilename(filename) {
        return await this._context.workspaceFile(filename, this._clientWorkspace);
      }`,
    `      async resolveClientFilename(filename) {
        // Echo: relative output files go to outputDir, not the client's cwd.
        const __ecIsAbs = /^[A-Za-z]:[\\\\/]/.test(filename) || /^\\\\\\\\/.test(filename);
        if (__ecIsAbs)
          return await this._context.workspaceFile(filename, this._clientWorkspace);
        return await this._context.outputFile({ suggestedFilename: filename.replace(/[\\\\/]/g, "_") }, { origin: "llm" });
      }`
  )

// ── Edit 10: mask cookie values by default ─────────────────────────
  // Encrypting the file is necessary but NOT sufficient: `browser_cookie_list`
  // and `browser_cookie_get` return raw cookie values straight into the model's
  // context, so a page that talks an AI into calling them harvests live
  // sessions without touching the filesystem at all. Mask by default; callers
  // that genuinely need a value pass `reveal: true`.
  edit(
    'cookie_list masking (schema + handler)',
    'reveal: z9.boolean().optional().describe("Include raw cookie VALUES',
    `        description: "List all cookies (optionally filtered by domain/path)",
        inputSchema: z9.object({
          domain: z9.string().optional().describe("Filter cookies by domain"),
          path: z9.string().optional().describe("Filter cookies by path")
        }),`,
    `        description: "List all cookies (optionally filtered by domain/path). VALUES ARE MASKED by default because they are live session credentials. Pass reveal: true only when the raw value is genuinely required.",
        inputSchema: z9.object({
          domain: z9.string().optional().describe("Filter cookies by domain"),
          path: z9.string().optional().describe("Filter cookies by path"),
          reveal: z9.boolean().optional().describe("Include raw cookie VALUES. These are live credentials - avoid unless strictly necessary.")
        }),`
  )

  // ── Edit 11: mask the cookie_list VALUE in its handler ─────────────
  // Separate from edit 10 so each half is independently revertible. Without
  // this the schema advertises `reveal` but the handler still prints raw
  // values, which would be worse than no change at all.
  edit(
    'cookie_list value masking (handler)',
    'params2.reveal ? c.value',
    `          response2.addTextResult(cookies.map((c) => \`\${c.name}=\${c.value} (domain: \${c.domain}, path: \${c.path})\`).join("\\n"));`,
    `          response2.addTextResult(cookies.map((c) => \`\${c.name}=\${params2.reveal ? c.value : \`<masked:\${c.value.length} chars>\`} (domain: \${c.domain}, path: \${c.path})\`).join("\\n"));`
  )

// ── Edit 12: mask browser_cookie_get ───────────────────────────────
  edit(
    'cookie_get masking',
    'reveal: z9.boolean().optional().describe("Include the raw cookie VALUE',
    `        description: "Get a specific cookie by name",
        inputSchema: z9.object({
          name: z9.string().describe("Cookie name to get")
        }),`,
    `        description: "Get a specific cookie by name. The VALUE IS MASKED by default because it is a live session credential. Pass reveal: true only when the raw value is genuinely required.",
        inputSchema: z9.object({
          name: z9.string().describe("Cookie name to get"),
          reveal: z9.boolean().optional().describe("Include the raw cookie VALUE. This is a live credential - avoid unless strictly necessary.")
        }),`
  )

  // ── Edit 13: mask browser_cookie_get value in its handler ───────────
  edit(
    'cookie_get value masking (handler)',
    'params2.reveal ? cookie.value',
    `          response2.addTextResult(\`\${cookie.name}=\${cookie.value} (domain: \${cookie.domain}, path: \${cookie.path}, httpOnly: \${cookie.httpOnly}, secure: \${cookie.secure}, sameSite: \${cookie.sameSite})\`);`,
    `          response2.addTextResult(\`\${cookie.name}=\${params2.reveal ? cookie.value : \`<masked:\${cookie.value.length} chars>\`} (domain: \${cookie.domain}, path: \${cookie.path}, httpOnly: \${cookie.httpOnly}, secure: \${cookie.secure}, sameSite: \${cookie.sameSite})\`);`
  )

  // ── Edit 14: warn that saved state holds live credentials ──────────
  // UX only, NOT a security control — edits 7 and 10-13 are. An AI reading
  // this description should tell the user what the file contains.
  edit(
    'storage_state description warning',
    'values contain your live session credentials for EVERY site',
    `        description: "Save storage state (cookies, local storage) to a file for later reuse",`,
    `        description: "Save storage state (cookies, local storage) to a file for later reuse. Echo writes it ENCRYPTED (Windows DPAPI, readable only by this Windows account) into its own ~/.echo/sessions folder. Tell the user this: the values contain your live session credentials for EVERY site they are signed into - it can restore a logged-in session without a password.",`
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
