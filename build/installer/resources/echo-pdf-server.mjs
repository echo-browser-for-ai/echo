#!/usr/bin/env node
/**
 * Echo's own MCP server — the tools that are not browser actions.
 *
 * Today that is one tool: read_pdf.
 *
 * Why it exists: Echo's Chromium renders PDFs with the PDFium plugin inside a
 * shadow DOM, so nothing page-side can reach the text. `document.body.innerText`
 * is empty, the accessibility tree is empty, and even CDP's getFullAXTree
 * returns no text nodes. The only way to read a PDF is to take the bytes and run
 * a parser over them, and this server is where that parser lives.
 *
 * Why a separate server: the browser tools come from Microsoft's @playwright/mcp,
 * which Echo must not modify. Sitting in front of it (proxying) would put Echo in
 * the path of every browser call, so a bug here could break all browsing. Running
 * alongside it keeps the two independent: this server can be fixed or replaced
 * without touching the browser tools at all.
 *
 * Speaks newline-delimited JSON-RPC 2.0 on stdio, like every MCP server. Only
 * JSON goes to stdout; anything human-readable goes to stderr.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// ── Keep stdout clean ─────────────────────────────────────
//
// This has to be in place before pdf.js loads, which happens further down via a
// dynamic `await import(PDFJS_ENTRY)`. pdf.js reports through console.log/warn,
// and console.log writes to stdout — the channel carrying the protocol. A single
// stray line corrupts the stream and the client stops understanding us. Measured
// before this guard: 6 non-JSON lines on an ordinary call, and 51 when the
// source turned out not to be a PDF at all.
//
// (The static imports above are hoisted above this loop, but none of them log.)
for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[method] = (...args) => {
    try {
      process.stderr.write('[echo-pdf] ' + args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ') + '\n');
    } catch { /* stderr closed */ }
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));

const SERVER_NAME = 'echo-pdf';
const SERVER_VERSION = '1.0.0';
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05'];
const TOOL_NAME = 'read_pdf';

/** Text handed back to the model, before truncation. */
const DEFAULT_MAX_CHARS = 100000;
const HARD_MAX_CHARS = 1000000;
/** A PDF this large is almost certainly not what the caller meant. */
const MAX_BYTES = 200 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60000;

/** Vendored beside this file by the release workflow and vendor-runtime.sh. */
const PDFJS_DIR = join(HERE, 'node_modules', 'pdfjs-dist');
const PDFJS_ENTRY = 'pdfjs-dist/legacy/build/pdf.mjs';

function log(...args) {
  // stdout carries the protocol, so diagnostics must go to stderr.
  try { process.stderr.write('[echo-pdf] ' + args.join(' ') + '\n'); } catch { /* closed */ }
}

function megabytes(bytes) {
  return Math.round(bytes / 1048576);
}

// ── JSON-RPC plumbing ─────────────────────────────────────

function send(message) {
  try { process.stdout.write(JSON.stringify(message) + '\n'); } catch { /* closed */ }
}

/**
 * A response is only sent when the message carried an id. A message without one
 * is a notification, and replying to it is a protocol violation.
 */
function reply(id, result) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── The tool ──────────────────────────────────────────────

const TOOL = {
  name: TOOL_NAME,
  description:
    'Extract the text of a PDF into plain text, ready to read or quote. ' +
    'Takes a URL or a local file path. Use this whenever a PDF needs reading: ' +
    'Chrome shows PDFs on screen but exposes none of their text to the page, so ' +
    'browser tools cannot read one. For a PDF behind a login, download it first ' +
    'with the browser tools (page.request) and pass the saved file path here.',
  inputSchema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'URL (http/https) or absolute local file path of the PDF.',
      },
      pages: {
        type: 'string',
        description:
          'Pages to extract, e.g. "3", "1-5", "1,4,7-9". Default: every page.',
      },
      max_chars: {
        type: 'number',
        description:
          'Cap on returned characters. Default ' + DEFAULT_MAX_CHARS +
          '. Output past the cap is cut and the reply says so.',
      },
    },
    required: ['source'],
    additionalProperties: false,
  },
};

/** Reads a response body with a hard byte ceiling, whatever the headers claim. */
async function readCapped(response, limit) {
  const reader = response.body && response.body.getReader ? response.body.getReader() : null;
  if (!reader) return new Uint8Array(await response.arrayBuffer());

  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new Error(`PDF is over the ${megabytes(limit)} MB limit.`);
    }
    chunks.push(Buffer.from(value));
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

/** Reads a PDF's bytes from a URL or from disk. */
async function loadBytes(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/pdf,*/*' },
    });
    if (!response.ok) {
      throw new Error(`Could not download the PDF: HTTP ${response.status} ${response.statusText}`);
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) {
      throw new Error(`PDF is ${megabytes(declared)} MB, over the ${megabytes(MAX_BYTES)} MB limit.`);
    }
    return readCapped(response, MAX_BYTES);
  }

  const path = source.startsWith('file://') ? fileURLToPath(source) : source;
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Not a file: ${path}`);
  if (info.size > MAX_BYTES) {
    throw new Error(`PDF is ${megabytes(info.size)} MB, over the ${megabytes(MAX_BYTES)} MB limit.`);
  }
  return new Uint8Array(await readFile(path));
}

/**
 * Turns "1-5,8" into [1,2,3,4,5,8], clamped to the document. The clamp happens
 * before anything is stored: without it, "1-999999999" builds a gigantic Set and
 * blocks the event loop for seconds before being filtered down to the real pages.
 */
function parsePages(spec, numPages) {
  const raw = spec === undefined || spec === null ? '' : String(spec).trim();
  if (!raw || /^all$/i.test(raw)) {
    return Array.from({ length: numPages }, (_, i) => i + 1);
  }

  const wanted = new Set();
  for (const part of raw.split(',')) {
    const piece = part.trim();
    if (!piece) continue;

    const range = piece.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const first = Number(range[1]);
      const second = Number(range[2]);
      const low = Math.max(1, Math.min(first, second));
      const high = Math.min(numPages, Math.max(first, second));
      if (low > numPages) continue;             // the whole range is past the end
      for (let page = low; page <= high; page++) wanted.add(page);
      continue;
    }

    if (/^\d+$/.test(piece)) {
      const page = Number(piece);
      if (page >= 1 && page <= numPages) wanted.add(page);
    }
  }

  const pages = [...wanted].sort((a, b) => a - b);
  if (pages.length === 0) {
    throw new Error(`No valid pages in "${spec}" — this PDF has ${numPages} page${numPages === 1 ? '' : 's'}.`);
  }
  return pages;
}

/** Pulls the text out of one page, keeping paragraph breaks. */
async function pageText(page) {
  const content = await page.getTextContent();
  let out = '';
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function positiveNumber(value) {
  const number = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

async function readPdf(args) {
  const source = args && args.source;
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('read_pdf needs a "source": a PDF URL or an absolute file path.');
  }
  const requested = positiveNumber(args.max_chars);
  const maxChars = requested === undefined
    ? DEFAULT_MAX_CHARS
    : Math.min(Math.floor(requested), HARD_MAX_CHARS);

  const bytes = await loadBytes(source.trim());

  const pdfjs = await import(PDFJS_ENTRY);
  // verbosity 0 keeps pdf.js quiet; the console guard above catches anything it
  // says anyway, including the optional-canvas warnings it emits on load.
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
    // Supplying these is what makes PDFs with non-embedded or CJK fonts extract cleanly.
    standardFontDataUrl: join(PDFJS_DIR, 'standard_fonts') + '/',
    cMapUrl: join(PDFJS_DIR, 'cmaps') + '/',
    cMapPacked: true,
  });

  let document_;
  try {
    document_ = await loadingTask.promise;
    const numPages = document_.numPages;
    const pages = parsePages(args.pages, numPages);

    const chunks = [];
    for (const pageNumber of pages) {
      const page = await document_.getPage(pageNumber);
      try {
        const text = await pageText(page);
        if (text) chunks.push(`[page ${pageNumber}]\n${text}`);
      } finally {
        page.cleanup();
      }
    }

    const body = chunks.join('\n\n');
    const header =
      `PDF: ${numPages} page${numPages === 1 ? '' : 's'}` +
      (pages.length === numPages ? '' : `, extracted ${pages.length}`) +
      `, ${body.length} characters of text.`;

    if (!body.trim()) {
      return `${header}\n\nNo text found. This PDF is probably a scan of pages rather than text — ` +
        `it would need OCR, which these tools do not do.`;
    }

    if (body.length > maxChars) {
      return `${header}\n\n${body.slice(0, maxChars)}\n\n` +
        `[cut off here: ${body.length - maxChars} more characters remain. ` +
        `Call read_pdf again with max_chars, or with pages, to read the rest.]`;
    }
    return `${header}\n\n${body}`;
  } finally {
    // Releases the PDF.js worker/transport; without it every call leaves one behind.
    await loadingTask.destroy().catch(() => {});
  }
}

// ── Request handling ──────────────────────────────────────

async function handle(message) {
  // JSON-RPC wants -32600 back for anything that is not a request object, with a
  // null id when there is none to echo. This deliberately bypasses replyError(),
  // whose silence is for notifications, not for malformed input.
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    return;
  }

  const { id, method, params } = message;

  if (typeof method !== 'string') {
    send({ jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid Request: no method' } });
    return;
  }

  switch (method) {
    case 'initialize': {
      const requested = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      reply(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;

    case 'ping':
      reply(id, {});
      return;

    case 'tools/list':
      reply(id, { tools: [TOOL] });
      return;

    case 'tools/call': {
      const name = params && params.name;
      if (name !== TOOL_NAME) {
        replyError(id, -32602, `Unknown tool "${name}". This server only offers "${TOOL_NAME}".`);
        return;
      }
      try {
        const text = await readPdf(params.arguments || {});
        reply(id, { content: [{ type: 'text', text }] });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log('read_pdf failed:', reason);
        reply(id, { content: [{ type: 'text', text: `read_pdf failed: ${reason}` }], isError: true });
      }
      return;
    }

    default:
      // A notification with an unknown method gets no reply, per JSON-RPC; an
      // actual request does.
      replyError(id, -32601, `Method not found: ${method}`);
  }
}

/** One line of input: a request, a notification, or a batch of them. */
async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    log('ignoring a line that is not JSON');
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  if (Array.isArray(message)) {
    if (message.length === 0) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }
    for (const entry of message) await handle(entry);
    return;
  }

  await handle(message);
}

function main() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Requests are queued: one may be slow (a big download), and replies must stay
  // in order even if a second request arrives while the first is still running.
  let queue = Promise.resolve();

  lines.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    queue = queue
      .then(() => handleLine(trimmed))
      .catch((error) => log('handler error:', String(error)));
  });

  lines.on('close', () => {
    queue.finally(() => process.exit(0));
  });

  log(`ready (node ${process.version})`);
}

main();
