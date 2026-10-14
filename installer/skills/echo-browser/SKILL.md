---
name: echo-browser
description: Drive the user's Echo browser — a Chromium build with an MCP bridge — to search, fetch, read, screenshot, fill forms or interact with web pages using the user's real logins, and to read PDFs. Use for browsing, web search, scraping a page, extracting page text, structure or JSON, screenshots, clicking, form filling, reading a PDF, or checking whether Echo itself is running or broken.
---

# Echo browser

Echo is a Chromium build with MCP servers attached. Driving it gives you a real browser
running the user's real profile: live logins, real cookies, real extensions.

That is the point of it. It reaches what a plain HTTP request cannot — pages behind a
sign-in, JavaScript apps, sites that captcha a cold scraper.

Use it for: searching the web, reading an article, pulling a page's text, structure or
JSON, screenshots, clicking, forms, reading a PDF, and anything that needs JavaScript.

Do not use it for: a static page that `fetch` or `curl` already returns. Echo is
slower, and it takes the one shared tab.

## What your client shows you, and how to call the rest

Echo always installs **the same 63 browser tools plus `read_pdf`**. What varies is how
many of them your client announces up front. Find your row:

| Your client | What you see | How to call |
|---|---|---|
| **Pi with the adapter** (`mcp` proxy tool present) | 7 hot tools; the other 56 reachable but not listed | call the 7 directly; `mcp({ ... })` for the rest (below) |
| **Pi without the adapter, codemode active** (the default) | 7 hot tools | call the 7 directly; reach the rest from a `codemode` script (below) |
| **Pi with `autoEnableCodemode: false`** | 7 hot tools only | the 56 cannot be called — ask the user to remove that setting from `~/.pi/agent/mcp.json` and restart Pi; until then `browser_run_code_unsafe` covers most jobs |
| **Claude Code** | searchable, not all declared | its own tool search |
| **Codex CLI** | searchable, not all declared | its own tool search |
| VS Code Copilot, Cursor, Cline, OpenCode, Antigravity, Claude Desktop, Gemini CLI, Qwen, Roo Code, Continue, Windsurf, MiniMax Code | all 63 declared | call them like built-in tools |

**The 7 hot tools**, when the short list is active: `browser_navigate`,
`browser_evaluate`, `browser_snapshot`, `browser_click`, `browser_type`,
`browser_wait_for`, `browser_run_code_unsafe`.

**If a tool is not visible, do not conclude Echo cannot do it.** It is almost certainly
installed and one call away:

```
mcp({ server: "echo" })                              # the whole menu — name, parameters, one line each
mcp({ search: "screenshot" })                        # find a tool by word
mcp({ describe: "echo_browser_take_screenshot" })    # full schema for one tool
mcp({ tool: "echo_browser_take_screenshot", args: { type: "png", scale: "css" } })
```

Names come back prefixed with the server (`echo_browser_close`). **Both the prefixed and
the bare form work when calling** — `mcp({ tool: "browser_close" })` resolves too.

**A failed call still teaches you.** When a required argument is missing, the error
prints that tool's complete parameter list. Read it and retry — faster than guessing,
and it is why an unlisted tool is never a dead end.

**On plain Pi without the adapter** (codemode active), call the `codemode` tool and reach
the rest from the script — search for names first, then call them:

```js
const found = await searchTools("screenshot");        // find hidden tools by word
const ns = await describeNamespace("mcp__echo");      // -> { name, tools: [...] }
await tools.mcp__echo__browser_navigate({ url: "https://example.com" });
const r = await tools.mcp__echo__browser_evaluate({ function: "() => document.title" });
const text = (r.content || []).map((c) => c.text ?? "").join("\n");
```

## Check it is running

```bash
cat ~/.echo/mcp.json       # {"cdpPort":59736,"pid":4860,"version":"0.2.9",...}
```

No lockfile means Echo is not running. The MCP launcher starts it for you and polls for
up to 30 seconds, so the first call after a cold start is simply slow. Do not launch
`Echo.exe` yourself.

## The two servers

Echo registers **two** MCP servers into every AI app:

| Namespace | What it is | Tools |
|---|---|---|
| `mcp__echo` | Microsoft's `@playwright/mcp`, pointed at Echo's Chromium | 63 browser tools |
| `mcp__echo-pdf` | Echo's own server, `echo-pdf-server.mjs` | 1: `read_pdf` |

They are separate processes on purpose. The browser tools come from a package Echo must
not modify, so rather than standing in front of it (a proxy, where one bug breaks all
browsing), Echo runs alongside it. Either can be fixed or replaced alone.

A call resolves to a `CallToolResult` **object**, not a string — read `r.content`.
Results come back wrapped in `### Result` markdown plus a `### Ran Playwright code`
echo, so strip both before parsing anything as JSON.

For a long codemode script, raise the timeout on the first line:
`// @options: {"timeout_ms": 240000}`

## The reading recipe

One shared tab, so calls run sequentially. Never fire two navigations at once.

1. `browser_navigate({ url })`
2. Read it, cheapest first:
   - `browser_evaluate({ function })` — run any JS and return any value. Cheapest.
     `document.body.innerText` for the page text, or a selector for one field.
   - `browser_snapshot({})` — accessibility tree as YAML with `ref=` handles.
     Heavier, but **required when you need to click something**.
3. Let heavy pages settle with `browser_wait_for({ time: 5 })`.

**Take a fresh snapshot immediately before you click.** `ref=` handles belong to one
snapshot; a ref from an earlier turn is usually invalid, and the error is
`Ref <x> not found in the current page snapshot`.

## PDFs

Chrome renders PDFs with the PDFium plugin inside a shadow DOM, so **no page-side call
can read one** — not `innerText`, not the accessibility tree, not CDP's `getFullAXTree`
(all return nothing). That is why `read_pdf` exists: it takes the bytes and runs a
parser over them.

```
mcp__echo-pdf__read_pdf({ source: "https://arxiv.org/pdf/1706.03762", pages: "1-5" })
```

- `source` — a URL or an absolute file path.
- `pages` — `"3"`, `"1-5"`, `"1,4,7-9"`. Default: every page.
- `max_chars` — default 100,000. Output past the cap is cut off and the reply says so.

It handles scans by telling you there is no text (OCR is not done), and returns clean
errors for a 404, a non-PDF, or a page range past the end.

**For a PDF behind a login**, download it through the browser first so the session
cookies apply, then hand the saved file to `read_pdf`:

```js
mcp__echo__browser_run_code_unsafe({ code: `async (page) => {
  const fs = require('fs');
  const path = require('path');
  const out = path.join(require('os').tmpdir(), 'private.pdf');
  const res = await page.request.get('https://site.example/private.pdf');
  fs.writeFileSync(out, Buffer.from(await res.body()));
  return res.status() + ' ' + res.headers()['content-type'] + ' ' + out;
}` })
```

Never use select-all and copy in the PDF viewer: the keys do not reach the plugin, and
the clipboard you read back is whatever the user last copied.

## Pitfalls

- **Some arguments look optional and are not.** `browser_take_screenshot` requires
  `type` **and** `scale`; `browser_network_requests` requires `static`;
  `browser_network_request` takes `part` as exactly one of `request-headers`,
  `request-body`, `response-headers`, `response-body`. Guessing fails validation.
  Full signatures: `references/tool-reference.md`.
- **A domain-filtered `browser_cookie_list` proves nothing about the profile.** A site
  that sets no cookies returns nothing while the profile holds hundreds across many
  domains. Call it with no filter before concluding anything.
- **Never trust a `ref=` from an earlier turn.** Snapshot again.
- **Google Maps returns 1 character of text with no wait**, then every business name
  (via `aria-label`) after about 5 seconds.
- **Heavy SPAs are slow** — a busy social site can take 18 seconds. Give the script a
  long timeout.
- **A declared (`direct`) server costs a moment at startup.** pi waits up to 10 seconds
  for Echo to connect on the first message. If Echo is already open this is instant; if
  it is closed, expect a short pause while the launcher starts it.
- **`browser_run_code_unsafe` runs in the MCP server process**, with full file and
  network access. It is the right tool for `page.request`, and the wrong tool for
  anything you have not thought through.

## What works

Every row was run live against Echo and passed.

| Category | Result |
|---|---|
| HTML article (Wikipedia) | 26,317 chars, 3.6s |
| Plain text (RFC 9110) | 502,906 chars, 2.7s |
| XML / RSS feed | 15,964 chars, 1.8s |
| JSON API, navigated to | 7,107 chars, 1.4s |
| JSON pulled from the network log | parses clean, <1s |
| Google / DuckDuckGo / Bing search | real results, no captcha, 4.4–7.6s |
| JavaScript SPA | 22,498 chars, not bot-blocked, 18.6s |
| Google Maps | works **only after a ~5s wait** |
| Geocoding (Nominatim JSON) | real lat/lon, 1.2s |
| Direct image URL | reads natural dimensions, 1.7s |
| Cloudflare test page | passes, no challenge, 2.2s |
| Raw fetch, no CORS (`page.request`) | JSON and a 2.2 MB PDF |
| PDF text (`read_pdf`) | 15-page paper, 35,000+ chars; IRS form; tiny PDFs |
| PDF errors | clean messages for 404, non-PDF, bad page range |

## Operating Echo without breaking it

- **Never `taskkill /f /im node.exe`** — that can kill the agent session. Echo's
  processes are `Echo.exe` and `EchoBrowser.exe`.
- Logs: `~/.echo/logs/echo.log`.
- Profile: `%APPDATA%\echo\chrome-profile\Default` — the user's real profile.
  Read from it; never write to it.
- Installed app: `%LOCALAPPDATA%\Programs\Echo\resources\`. Both servers live there:
  `echo-mcp-launcher.js` (finds the browser by pid, spawns `@playwright/mcp` against its
  CDP port) and `echo-pdf-server.mjs` (PDF text, using the vendored `node_modules/pdfjs-dist`).
- **The `pdfjs-dist` pin is load-bearing** — raising it silently breaks `read_pdf` at
  runtime while everything else looks healthy. Why, and the two constraints: see
  `references/tool-reference.md`.
- Chromium is a Developer Build, so it is unsigned. Launch flags include
  `--remote-debugging-port=<from lockfile>`, `--user-data-dir`, and
  `--load-extension=...echo-extension`.
