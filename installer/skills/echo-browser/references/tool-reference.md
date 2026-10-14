# Echo MCP tool reference

The browser tools, with the arguments each one actually requires. Required
arguments are marked **!**. Everything comes from `describeTool("<name>")` on a
live connection — when in doubt, ask the server:

```js
await describeTool("mcp__echo__browser_click")
```

Every tool resolves to a `CallToolResult`, so read `r.content`, not `r`.

---

## Navigation

### browser_navigate
```ts
{ url: string }                       // !
```

### browser_navigate_back
```ts
{}
```

### browser_tabs
```ts
{
  action: "list" | "new" | "close" | "select";   // !
  index?: number;      // close/select
  url?: string;        // new
}
```

### browser_close
```ts
{}
```

### browser_resize
```ts
{ width: number; height: number }     // both !
```

### browser_wait_for
```ts
{
  time?: number;        // seconds — the simplest way to let a page settle
  text?: string;        // wait for text to appear
  textGone?: string;    // wait for text to disappear
}
```

---

## Reading

### browser_evaluate
The cheapest way to read anything. Runs your function in the page and returns its
value.
```ts
{
  function: string;     // ! e.g. "() => document.body.innerText"
  target?: string;      // element ref from a snapshot, or a CSS selector
  element?: string;     // human-readable description of that element
  filename?: string;    // save the result to a file instead of returning it
}
```

### browser_snapshot
Accessibility tree as YAML, with `ref=` handles you pass to click/type tools.
Heavier than evaluate — use it when you need to interact, not just read.
```ts
{
  target?: string;
  boxes?: boolean;      // add [box=x,y,w,h] per element
  depth?: number;       // limit tree depth
  filename?: string;    // save to markdown instead of returning text
}
```

### browser_take_screenshot
```ts
{
  type: "png" | "jpeg";                 // !
  scale: "css" | "device";              // !
  filename?: string;                    // relative names stay in the output dir
  fullPage?: boolean;                   // not valid with element screenshots
  element?: string;
  target?: string;
}
```
Saving with a bare `filename` writes into the session working directory, not the
app folder.

### browser_console_messages
```ts
{
  level: "error" | "warning" | "info" | "debug";   // !
  all?: boolean;       // since session start instead of since last navigation
  filename?: string;
}
```

---

## Network

### browser_network_requests
```ts
{
  static: boolean;      // !  true includes images/fonts/scripts
  filter?: string;      // regexp against the URL, e.g. "/api/.*user"
  filename?: string;
}
```
Returns a numbered list:
```
1. [GET] https://github.com/microsoft/vscode => [200]
```

### browser_network_request
Pulls one request's headers and body. This is the clean way to get JSON out of an
app that fetches it in the background — the body arrives as raw text and parses.
```ts
{
  index: number;        // !  the 1-based number from browser_network_requests
  part?: "request-headers" | "request-body" | "response-headers" | "response-body";
  filename?: string;
}
```

### browser_run_code_unsafe
Runs arbitrary Playwright code **inside the MCP server process** — full file and
network access, RCE-equivalent. Use it for `page.request` (a fetch with the
browser's cookies that ignores CORS), for reaching other frames, and for CDP.
```ts
{
  code?: string;        // async (page) => { ... }
  filename?: string;    // or load the code from a file
}
```
```js
// Fetch bytes with the browser's session, write them to disk
await tools.mcp__echo__browser_run_code_unsafe({ code: `async (page) => {
  const fs = require('fs');
  const res = await page.request.get('https://example.com/paper.pdf');
  fs.writeFileSync('C:/path/paper.pdf', Buffer.from(await res.body()));
  return res.status() + ' ' + res.headers()['content-type'];
}` });
```

---

## Interaction

### browser_click
```ts
{
  target: string;                                            // ! ref or selector
  element?: string;
  button?: "left" | "right" | "middle";
  doubleClick?: boolean;
  modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">;
}
```

### browser_type
```ts
{
  target: string;       // !
  text: string;         // !
  clear?: boolean;
  submit?: boolean;     // press Enter after
  press_enter?: boolean;  // alias for submit
  slowly?: boolean;     // one character at a time, triggers key handlers
}
```

### browser_fill_form
```ts
{
  fields: Array<{
    name: string;                                        // !
    target: string;                                      // !
    type: "textbox" | "checkbox" | "radio" | "combobox" | "slider";   // !
    value: string;                                       // ! "true"/"false" for checkboxes
    element?: string;
  }>;
}
```

### browser_select_option
```ts
{ target: string; values: string[] }
```

### browser_hover
```ts
{ target: string; element?: string }
```

### browser_press_key
```ts
{ key: string }         // "ArrowLeft", "Enter", "a"
```

### browser_drag
```ts
{ startTarget: string; endTarget: string; startElement?: string; endElement?: string }
```

### browser_drop
```ts
{
  target: string;
  paths?: string[];      // absolute file paths to drop
  data?: { [mimeType: string]: string };   // e.g. {"text/plain": "hello"}
  element?: string;
}
```

### browser_file_upload
```ts
{ paths?: string[] }    // omit to cancel the file chooser
```

### browser_handle_dialog
```ts
{ accept: boolean; promptText?: string }
```

---

## Echo's own server: `mcp__echo-pdf`

One tool. Separate server from the browser tools on purpose (see SKILL.md).

### read_pdf
```ts
{
  source: string;        // !  URL (http/https) or an absolute local file path
  pages?: string;        // "3", "1-5", "1,4,7-9". Default: every page
  max_chars?: number;    // default 100000, hard ceiling 1000000
}
```
Returns plain text with `[page N]` markers and a header line giving the page
count and how much text was found. When the text exceeds `max_chars` the tail is
replaced by a note saying how much is left, so the caller can ask for the rest.

Failure modes it reports cleanly rather than throwing: HTTP errors, invalid PDF
structure, a page range past the end, a file that does not exist, and a PDF with
no text layer at all (a scan), which is reported as needing OCR.

---

## The 63 browser tools

Echo launches `@playwright/mcp` with every capability group enabled
(`--caps=vision,pdf,storage,devtools,testing`), which is the difference between
the 23-tool default and 63. Groups and the tools they add:

| Group | Adds |
|---|---|
| core (default) | navigate, navigate_back, tabs, close, resize, evaluate, snapshot, take_screenshot, wait_for, console_messages |
| core-input (default) | click, type, fill_form, select_option, hover, press_key, drag, drop, file_upload, handle_dialog |
| network (default) | network_requests, network_request |
| pdf | pdf_save |
| vision | mouse_move_xy, mouse_click_xy, mouse_drag_xy, mouse_down, mouse_up, mouse_wheel, highlight, hide_highlight, annotate, generate_locator, resume |
| storage | cookie_list/get/set/delete/clear, localstorage_*, sessionstorage_*, storage_state, set_storage_state |
| testing | verify_element_visible, verify_text_visible, verify_list_visible, verify_value, start_tracing, stop_tracing, start_video, stop_video, video_chapter, video_show_actions, video_hide_actions |
| devtools | the remaining devtools-flavoured helpers |

An unrecognised capability name is ignored rather than fatal, so the launcher's
`--caps` line survives a package upgrade that renames or drops a group.

---

## Notes from live testing

**Result wrapping.** Every result is markdown: `### Result`, the value, then a
`### Ran Playwright code` block echoing the code. Strip both before `JSON.parse`.

**Timings observed.** Wikipedia 3.6s, RFC text 2.7s, RSS 1.8s, JSON API 1.4s,
Google 4.7s, DuckDuckGo 4.4s, Bing 7.6s, Reddit 18.6s, Google Maps 12.1s.
Set `// @options: {"timeout_ms": 240000}` on scripts with more than one
navigation.

**Google Maps.** With no wait, `document.body.innerText.length` is 1. After about
5 seconds it is 1,295, and every result name is available as an `aria-label` on
the result links — the map itself is canvas, so the labels and the DOM text are
what you read.

**Bot walls.** The Cloudflare test page (`nowsecure.nl`) passes with no challenge,
and neither Google nor Reddit served a captcha. The reason is the profile: the user's
real, already signed-in session — hundreds of cookies across many domains.

**PDF text is NOT reachable from the page — use `read_pdf`.** Chrome 152 renders
PDFs in a Lit shadow DOM inside `<pdf-viewer>`, with the pages drawn by the
PDFium plugin:

- `document.body.innerText` → 0 characters
- `document.querySelectorAll('embed')` → 0 (the plugin is inside the shadow root)
- the viewer frame `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai` is
  reachable and has `window.viewer`, but its shadow root holds only
  `viewer-toolbar`, `viewer-pdf-sidenav` and a scroller — no text layer
- `Accessibility.enable` + `Accessibility.getFullAXTree` over CDP → 7 nodes, 0 text

`navigator.pdfViewerEnabled` is `true` and the PDF renders correctly on screen,
so this is an extraction limit, not a display fault. That is exactly why
`mcp__echo-pdf`'s `read_pdf` exists: it fetches the bytes and parses them.

**pdfjs-dist is pinned to 4.10.38 for two reasons, both learned the hard way.**
v5 calls `DOMMatrix` during extraction and only gets it by loading
`@napi-rs/canvas`, an optional dependency whose Windows binary is 37 MB and which
Echo does not ship — so on v5 a missing canvas becomes `DOMMatrix is not defined`
at runtime. Separately, v5.5+ needs Node 20.19 and v5.7+ needs Node 22.13 while
Echo ships Node 20.18.3. A v5 test that appears to pass inside the repo is being
helped by the repo's own `node_modules`; test the vendored copy in isolation.

**pdf.js writes to stdout, and stdout is the protocol.** `console.log` in a stdio
MCP server lands in the JSON-RPC stream and corrupts it — measured at 6 stray
lines on an ordinary call and 51 when the source was not a PDF at all. The server
reassigns `console.log/info/warn/error/debug/trace` to stderr before pdf.js loads,
and passes `verbosity: 0`. Any new server here needs the same guard, and any test
for it must check that *every* stdout line parses as JSON — a parser that skips
unparseable lines will report success on a corrupted stream.
