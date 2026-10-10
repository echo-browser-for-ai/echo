/**
 * Echo MCP Launcher (dev mode).
 * Same robust port resolution as the production launcher, but looks for
 * node_modules at the project root (dev mode). See echo-mcp-launcher.js for
 * the full rationale (lockfile can go stale after a Chromium relaunch).
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const projectRoot = __dirname;

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
    /* ignore */
  }
  return [...new Set(ports)];
}

async function resolveCdpPort() {
  const lockPort = readLockPort();
  if (lockPort > 0 && await probe(lockPort)) return lockPort;
  for (const p of findLiveChromiumPorts()) {
    if (await probe(p)) return p;
  }
  return 0;
}

(async () => {
  const cdpPort = await resolveCdpPort();
  if (!cdpPort) {
    process.exit(1);
  }

  const mcpBin = join(projectRoot, 'node_modules', '@playwright', 'mcp', 'cli.js');
  const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;

  /**
   * Keep this in lockstep with echo-mcp-launcher.js (production):
   *   --caps          dev used to omit this, which quietly changed the toolset
   *                   (23 tools in dev vs 63 in the shipped app — dev testing
   *                   did not represent the product).
   *   --output-dir    artifacts go to Echo's folder, not the AI client's cwd.
   *   --output-max-size  disk eviction only (not a context cap); 50 MB.
   */
  const CAPS = 'vision,pdf,storage,devtools,testing';
  const OUTPUT_DIR = join(homedir(), '.echo', 'output');
  const OUTPUT_MAX_SIZE_BYTES = 52428800; // 50 MB

  const child = spawn(process.execPath, [mcpBin, `--cdp-endpoint=${cdpEndpoint}`, '--allow-unrestricted-file-access', `--caps=${CAPS}`, `--output-dir=${OUTPUT_DIR}`, `--output-max-size=${OUTPUT_MAX_SIZE_BYTES}`], {
    stdio: 'inherit',
  });

  child.on('exit', (code) => process.exit(code || 0));
})().catch(() => process.exit(1));
