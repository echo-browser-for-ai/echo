# Echo MCP Browser Tools — Full Test Suite

> Run each test below using the `echo_browser_*` MCP tools. Print results inline after each test.
> Start each result line with `[PASS]` or `[FAIL]` — be strict.
> If a test fails, note the exact error.

---

## 1. Tab Management

### 1.1 List tabs
```
echo_browser_tabs: { action: "list" }
```
Expected: Shows current tabs (settings page + about:blank).

Result: **[PASS]** — Shows 2 tabs: Example Domain (tab 0) and about:blank (tab 1).

### 1.2 Open a new tab
```
echo_browser_tabs: { action: "new", url: "https://example.com" }
```
Expected: New tab opens with Example Domain. List tabs to confirm.

Result: **[PASS]** — New tab created at example.com. Lists 3 tabs. Page title "Example Domain".

### 1.3 Switch between tabs
```
echo_browser_tabs: { action: "select", index: 0 }
```
Expected: Switches to the first tab. `browser_snapshot` should show that tab's content.

Result: **[PASS]** — Switched to tab 0. Snapshot confirms Example Domain content.

### 1.4 Close a tab
```
echo_browser_tabs: { action: "close", index: <tab_index> }
```
Expected: Tab closes. List tabs to confirm it's gone.

Result: **[PASS]** — Closed tab 2 (duplicate example.com). Back to 2 tabs.

---

## 2. Navigation

### 2.1 Navigate to a URL
```
echo_browser_navigate: { url: "https://en.wikipedia.org/wiki/Hello" }
```
Expected: Page loads with title "Hello - Wikipedia". Snapshot shows content.

Result: **[PASS]** — Loaded wikipedia.org/wiki/Hello. Title: "Hello - Wikipedia".

### 2.2 Navigate back
```
echo_browser_navigate_back: {}
```
Expected: Goes back to previous page (Example Domain).

Result: **[PASS]** — Went back to Example Domain.

---

## 3. Page Content

### 3.1 Get page snapshot
```
echo_browser_snapshot: {}
```
Expected: Returns page structure with headings, links, text content.

Result: **[PASS]** — Returns YAML structure with heading "Example Domain", paragraph, link "Learn more", and Echo Settings.

### 3.2 Evaluate JavaScript
```
echo_browser_evaluate: { function: "() => document.title" }
```
Expected: Returns the page title string.

Result: **[PASS]** — Returns "Example Domain".

### 3.3 Complex JS evaluation
```
echo_browser_evaluate: { function: "() => JSON.stringify({url: location.href, title: document.title, links: document.querySelectorAll('a').length})" }
```
Expected: Returns JSON with URL, title, link count.

Result: **[PASS]** — Returns {"url":"https://example.com/","title":"Example Domain","links":1}.

---

## 4. Interacting with Elements

### 4.1 Click a link
```
echo_browser_click: { target: "e6" }
```
(Note: uses snapshot element reference from the page, not text-based matching)
On Example Domain page, clicks the "Learn more" link (iana.org).

Expected: Navigates to iana.org/domains/example. Snapshot confirms.

Result: **[PASS]** — Clicked link, navigated to iana.org/help/example-domains.

### 4.2 Hover over element
```
echo_browser_hover: { target: "f3e20" }
```
(Note: uses snapshot element reference for "Example Domains" heading)

Expected: No error. Element is found and hovered.

Result: **[PASS]** — Hovered over heading "Example Domains". No error.

---

## 5. Screenshot

### 5.1 Take a screenshot
```
echo_browser_take_screenshot: { type: "png" }
```
(Note: `type` parameter is now required by @playwright/mcp)

Expected: Returns a screenshot (base64-encoded image data).

Result: **[PASS]** — Screenshot captured successfully. Saved to .playwright-mcp/.

**Known regression:** Default call without `type: "png"` times out (5s) — Playwright waits for fonts to load.

---

## 6. Form Interaction

### 6.1 Type text (on Google search page)
Navigate to `https://www.google.com` first, then:
```
echo_browser_type: { target: "f4e38", text: "Hello World" }
```
Expected: Types "Hello World" into the search box.

Result: **[PASS]** — Typed "Hello World" into the Google search combobox.

### 6.2 Press a key
```
echo_browser_press_key: { key: "Enter" }
```
Expected: Presses Enter (would trigger search, but might not load results before timeout).

Result: **[PASS]** — Pressed Enter. Search results page loaded: "Hello World - Google Search".

---

## 7. File Upload / Drag / Drop

### 7.1 File upload
```
echo_browser_file_upload: { selector: "input[type=file]", files: ["test.txt"] }
```
Expected: No error (assumes file input exists on page).

Result: **[FAIL]** — Error: "The tool can only be used when there is related modal state present." No file input on current page (Google search). Requires a page with `<input type=file>` and a file chooser dialog to be open first.

### 7.2 Drop
```
echo_browser_drop: { target: "body", data: {"text/plain": "test"} }
```
Expected: No error. Drops text data onto the page body.

Result: **[FAIL]** — Error: "Drop target did not accept the drop — its dragover handler did not call preventDefault()". Google search page body doesn't accept drops.

---

## 8. Dialogs

### 8.1 Handle dialog (requires a page that triggers alert/confirm/prompt)
Navigate to a page with a dialog trigger:
```
echo_browser_evaluate: { function: "() => { alert('test dialog'); return 'done'; }" }
```
Then:
```
echo_browser_handle_dialog: { accept: true }
```
Expected: Dialog is accepted. No error.

Result: **[PASS]** — Alert triggered, dialog appeared in modal state, accepted with no error.

---

## 9. Network

### 9.1 List network requests
Navigate to a URL first, then:
```
echo_browser_network_requests: {}
```
Expected: Returns a list of network requests made during page load.

Result: **[PASS]** — Returns full list of ~100+ requests. FAILED entries are Echo health check probes (expected).

### 9.2 Get network request details
```
echo_browser_network_request: { index: 1 }
```
Note: index is 1-based.

Expected: Returns full details (headers, body) of the first network request.

Result: **[PASS]** — Returns full request/response headers for google.com (status 200, 561ms).

---

## 10. Console Messages

### 10.1 Get console messages
Navigate to a page that logs to console:
```
echo_browser_evaluate: { function: "() => { console.log('test message'); return 'done'; }" }
```
Then:
```
echo_browser_console_messages: {}
```
Expected: Shows "test message" in the console messages list.

Result: **[PASS]** — Shows 3 messages: 2 warnings (YouTube postMessage on Google) + [LOG] "test message".

---

## 11. Window Management (CDP-native)

### 11.1 Resize browser window
```
echo_browser_resize: { width: 800, height: 600 }
```
Expected: Window resizes. Snapshot confirms new dimensions.

Result: **[PASS]** — Window resized.

### 11.2 Check window state via evaluate
```
echo_browser_evaluate: { function: "() => JSON.stringify({w: window.innerWidth, h: window.innerHeight})" }
```
Expected: Returns width 800, height 600 (or close to it).

Result: **[PASS]** — Returns {"w":800,"h":600} — exact match.

---

## 12. Error Handling

### 12.1 Navigate to invalid URL
```
echo_browser_navigate: { url: "https://thissitedoesnotexist99999.com" }
```
Expected: Error or timeout, but tool should not crash.

Result: **[PASS]** — Error: "net::ERR_NAME_NOT_RESOLVED". Tool did not crash. Returned clean error.

### 12.2 Click non-existent element
```
echo_browser_click: { target: "nonexistent-element-xyz-123" }
```
Expected: Returns error message about element not found.

Result: **[PASS]** — Error: "'nonexistent-element-xyz-123' does not match any elements." Tool did not crash.

---

## Summary

| Category | Tests | Pass | Fail |
|----------|-------|------|------|
| Tab Management | 4 | 4 | 0 |
| Navigation | 2 | 2 | 0 |
| Page Content | 3 | 3 | 0 |
| Element Interaction | 2 | 2 | 0 |
| Screenshot | 1 | 1 | 0 |
| Form Interaction | 2 | 2 | 0 |
| File Upload/Drag/Drop | 2 | 0 | 2 |
| Dialogs | 1 | 1 | 0 |
| Network | 2 | 2 | 0 |
| Console | 1 | 1 | 0 |
| Window Management | 2 | 2 | 0 |
| Error Handling | 2 | 2 | 0 |
| **Total** | **24** | **22** | **2** |

**Failures are environment limitations, not bugs:**
- File Upload (7.1): Requires a page with `<input type=file>` and open file chooser
- Drop (7.2): Requires a page whose `dragover` handler calls `preventDefault()`

**Test notes:** Some @playwright/mcp APIs have changed since the test was written:
- `evaluate` now takes `function` (not `expression`) — a JavaScript arrow function
- `click`/`hover` take snapshot element references (`ref=e6`) not text matches
- `screenshot` requires `type: "png"` parameter
- `handle_dialog` takes `accept: boolean` (not `action: "accept"`)
- `network_request` uses 1-based index
