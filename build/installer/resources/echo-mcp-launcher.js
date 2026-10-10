/**
 * Echo MCP Launcher (production).
 *
 * Spawns @playwright/mcp pointed at Echo's bundled Chromium over CDP, with
 * stdio inherited so the AI agent talks DIRECTLY to @playwright/mcp.
 *
 * Port resolution (robust to a stale lockfile — the original cause of
 * ECONNREFUSED in AI apps):
 *   1. Read cdpPort from the Echo lockfile (~/.echo/mcp.json).
 *   2. Verify it's alive (GET /json/version). If alive → use it.
 *   3. If dead, find Chromium's ACTUAL live CDP port: locate EchoBrowser.exe
 *      via tasklist, then its 127.0.0.1 LISTENING ports via netstat, and probe
 *      each for /json/version. Use the first that responds.
 *   4. If nothing is alive, wake Echo itself by launching Echo.exe — the tray
 *      app starts Chromium and writes the lockfile — then poll for up to 30s.
 *      Required because AI apps spawn this launcher at THEIR own startup, often
 *      before Echo is running, and most never retry a server that failed once.
 *   5. Only if that still fails: exit 1 (the browser genuinely could not start).
 */

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

function readLockPort() {
  try {
    const lf = JSON.parse(readFileSync(join(homedir(), '.echo', 'mcp.json'), 'utf-8'));
    return lf && typeof lf.cdpPort === 'number' ? lf.cdpPort : 0;
  } catch {
    return 0;
  }
}

function probe(port) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => finish(res.statusCode === 200 && /Browser/i.test(body)));
      });
      req.on('error', () => finish(false));
      req.setTimeout(1500, () => { req.destroy(); finish(false); });
    } catch {
      finish(false);
    }
  });
}

/** Find live CDP ports owned by EchoBrowser.exe (fallback when lockfile is stale). */
function findLiveChromiumPorts() {
  const ports = [];
  try {
    const task = spawnSync('tasklist', ['/FI', 'IMAGENAME eq EchoBrowser.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf-8' });
    if (task.status !== 0) return ports;
    const pids = new Set();
    for (const m of task.stdout.matchAll(/"[^"]*","(\d+)"/g)) pids.add(m[1]);
    if (pids.size === 0) return ports;

    const net = spawnSync('netstat', ['-ano'], { encoding: 'utf-8' });
    if (net.status !== 0) return ports;
    for (const line of net.stdout.split(/\r?\n/)) {
      if (!/LISTENING/.test(line)) continue;
      const addr = line.match(/127\.0\.0\.1:(\d+)/);
      if (!addr) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pids.has(pid)) ports.push(parseInt(addr[1], 10));
    }
  } catch {
    /* ignore — best effort */
  }
  return [...new Set(ports)];
}

async function resolveCdpPort() {
  const lockPort = readLockPort();
  if (lockPort > 0 && await probe(lockPort)) return lockPort;
  // Lockfile stale (or missing) — discover the live Chromium port.
  for (const p of findLiveChromiumPorts()) {
    if (await probe(p)) return p;
  }
  return 0;
}

/** Where Echo.exe sits relative to this launcher in the installed app. */
const ECHO_APP_EXE = join(__dirname, '..', 'Echo.exe');
const WAKE_TIMEOUT_MS = 30000;
const WAKE_POLL_MS = 1000;

function startEchoApp() {
  if (!existsSync(ECHO_APP_EXE)) return false;
  try {
    // Detached, stdio ignored: the app must outlive this launcher and must never
    // write into the MCP stdio pipe. If Echo is already running, Windows' single-
    // instance lock bounces this to the running copy, which relaunches Chromium —
    // so this also recovers a live tray app whose browser has died.
    const child = spawn(ECHO_APP_EXE, [], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a CDP port, waking Echo if no browser is running.
 *
 * AI apps spawn this launcher when THEY start, which is often before the user has
 * opened Echo. The launcher used to exit immediately in that case, and most AI
 * apps do not retry a failed MCP server — so Echo looked permanently broken until
 * the AI app was restarted. Starting Echo here removes that race entirely.
 */
async function resolveCdpPortOrWake() {
  const found = await resolveCdpPort();
  if (found) return found;

  if (!startEchoApp()) return 0;
  console.error('[echo] no running browser - started Echo, waiting for it to come up...');

  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS));
    const port = await resolveCdpPort();
    if (port) return port;
  }
  return 0;
}

(async () => {
  const cdpPort = await resolveCdpPortOrWake();
  if (!cdpPort) {
    // Nothing came up — exit so the AI agent reports a clean error instead of hanging.
    console.error('[echo] no browser available - Echo could not be started');
    process.exit(1);
  }

  const mcpBin = join(__dirname, 'node_modules', '@playwright', 'mcp', 'cli.js');
  const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;

  /**
   * Every capability @playwright/mcp offers.
   *
   * Without --caps it starts with 23 tools. With all five groups it starts with
   * 63: cookies, localStorage/sessionStorage, save-the-page-as-PDF, coordinate
   * clicking, element highlight, session video, tracing, and the verify helpers.
   *
   * Before removing any of these, know why they are all on:
   *   - The tool list is a stable prefix sent before the conversation, which is
   *     the position prompt caching handles best, so repeat turns cost a
   *     fraction of the first. An AI that can see every tool also stops wasting
   *     a turn searching for one, and never misses a capability it did not
   *     think to look for.
   *   - A capability name that a future @playwright/mcp does not recognise is
   *     ignored rather than fatal (verified against 0.0.77: a deliberately
   *     bogus name still started the server), so this line cannot break Echo.
   */
  const CAPS = 'vision,pdf,storage,devtools,testing';

  /**
   * Output artifacts (page snapshots, console logs) MUST NOT land in the AI
   * client's working directory — @playwright/mcp defaults to clientInfo.cwd,
   * which pollutes whichever project the agent runs from. Point every artifact
   * at Echo's own folder instead, and bound that folder to 50 MB.
   *
   * NOTE: --output-max-size is DISK eviction only (oldest files deleted
   * first). It does NOT cap what goes into the model's context — that is the
   * evaluate cap + inline-snapshot patches in scripts/patch-playwright-mcp.mjs.
   */
  const OUTPUT_DIR = join(homedir(), '.echo', 'output');
  const OUTPUT_MAX_SIZE_BYTES = 52428800; // 50 MB

  // Saved storage states (cookies + localStorage) are encrypted at rest with
  // Windows DPAPI by echocrypt.exe, which ships beside this launcher. The
  // patched @playwright/mcp reads this env var; if it is missing or the file
  // does not exist, browser_storage_state REFUSES to save rather than writing
  // plaintext. Saved state is DPAPI-encrypted at rest.
  //
  // Passing the absolute path beats letting the patch guess one: the dev
  // launcher lives at the repo root while the staged build lives under
  // build/installer/resources, and __dirname inside the patched bundle is
  // neither of those.
  const CRYPTO_EXE = join(__dirname, 'echocrypt.exe');

  const child = spawn(process.execPath, [mcpBin, `--cdp-endpoint=${cdpEndpoint}`, '--allow-unrestricted-file-access', `--caps=${CAPS}`, `--output-dir=${OUTPUT_DIR}`, `--output-max-size=${OUTPUT_MAX_SIZE_BYTES}`], {
    stdio: 'inherit',
    env: { ...process.env, ECHO_CRYPTO_EXE: CRYPTO_EXE },
  });

  child.on('exit', (code) => process.exit(code || 0));
})().catch(() => process.exit(1));
