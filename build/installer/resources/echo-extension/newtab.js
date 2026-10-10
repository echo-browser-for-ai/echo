// ── Theme sync ──────────────────────────────────────────────
// Reads Echo's theme from the settings API so the new-tab page matches
// the user's preference regardless of OS color scheme or CDP emulation.
// Falls back to @media (prefers-color-scheme: dark) if the server is down.

(function () {
  var DARK = {
    "--bg": "#1a1b1e",
    "--text": "#c1c2c5",
    "--sub": "#909296",
    "--card-bg": "#25262b",
    "--card-hover": "#2c2e33",
    "--border": "#373a40",
    "--input-bg": "#2c2e33",
    "--input-focus": "#373a40",
    "--accent": "#4dabf7",
    "--danger": "#ff6b6b",
    "--shadow": "0 1px 3px rgba(0, 0, 0, 0.3)",
  };

  var LIGHT = {
    "--bg": "#ffffff",
    "--text": "#1a1b1e",
    "--sub": "#868e96",
    "--card-bg": "#f8f9fa",
    "--card-hover": "#f1f3f5",
    "--border": "#dee2e6",
    "--input-bg": "#f1f3f5",
    "--input-focus": "#e9ecef",
    "--accent": "#228be6",
    "--danger": "#e03131",
    "--shadow": "0 1px 3px rgba(0, 0, 0, 0.08)",
  };

  function applyTheme(theme) {
    var vars = theme === "dark" ? DARK : LIGHT;
    var style = document.documentElement.style;
    Object.keys(vars).forEach(function (k) {
      style.setProperty(k, vars[k]);
    });
  }

  var port = window.__ECHO_SETTINGS_PORT__;
  if (port) {
    fetch("http://127.0.0.1:" + port + "/api/settings")
      .then(function (r) { return r.json(); })
      .then(function (s) { applyTheme(s.theme || "dark"); })
      .catch(function () { /* server not reachable — CSS media query handles it */ });
  }

  // Re-sync every 30s so the NTP reflects theme changes made in the settings page.
  setInterval(function () {
    if (!port) return;
    fetch("http://127.0.0.1:" + port + "/api/settings")
      .then(function (r) { return r.json(); })
      .then(function (s) { applyTheme(s.theme || "dark"); })
      .catch(function () {});
  }, 30000);
})();

const SHORTCUTS_KEY = "echo.newtab.shortcuts";

const DEFAULT_SHORTCUTS = [
  { title: "Echo",        url: "https://github.com/echo-browser-for-ai/echo" },
  { title: "Google",      url: "https://google.com" },
  { title: "YouTube",     url: "https://youtube.com" },
  { title: "MDN",         url: "https://developer.mozilla.org" },
  { title: "GitHub",      url: "https://github.com" },
  { title: "Stack Overflow", url: "https://stackoverflow.com" },
];

// Older builds (v0.2.1-v0.2.3) seeded the default shortcut with the project's
// pre-migration private-repo URL. Users who installed those still have it in
// localStorage, so keep a matcher to rewrite them to the public URL. The string
// is assembled from parts purely so the maintainer's personal account name is
// not published verbatim in the open-source repo.
const LEGACY_ECHO_REPO = ["https://github.com/", "uzair", "khxn66366-lang", "/browser-for-ai"].join("");

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(SHORTCUTS_KEY));
    if (Array.isArray(v) && v.length) {
      let changed = false;
      const migrated = v.map(function (item) {
        if (item && item.url === LEGACY_ECHO_REPO) {
          changed = true;
          return Object.assign({}, item, { url: DEFAULT_SHORTCUTS[0].url });
        }
        return item;
      });
      if (changed) localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch { /* corrupt — fall back to defaults */ }
  localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(DEFAULT_SHORTCUTS));
  return DEFAULT_SHORTCUTS.slice();
}
function save(items) { localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(items)); }

function normalizeUrl(input) {
  input = input.trim();
  if (!input) return input;
  if (/^(https?|ftp|file):\/\//i.test(input)) return input;
  if (input.includes(" ") || !input.includes(".")) return "https://www.google.com/search?q=" + encodeURIComponent(input);
  return "https://" + input;
}
function faviconFor(url) {
  try { return "https://www.google.com/s2/favicons?domain=" + new URL(url).hostname + "&sz=64"; }
  catch { return ""; }
}

let items = load();
const shortcutsEl = document.getElementById("shortcuts");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modal-title");
const nameInput = document.getElementById("s-name");
const urlInput = document.getElementById("s-url");

function render() {
  shortcutsEl.innerHTML = "";
  items.forEach((item, idx) => {
    const tile = document.createElement("a");
    tile.className = "tile";
    tile.href = item.url;
    tile.title = item.url;
    const img = document.createElement("img");
    img.src = faviconFor(item.url); img.alt = ""; img.width = 32; img.height = 32;
    img.onerror = function () { this.style.visibility = "hidden"; };
    const label = document.createElement("span");
    label.textContent = item.title;
    tile.appendChild(img); tile.appendChild(label);
    const del = document.createElement("button");
    del.className = "tile-del"; del.innerHTML = "&times;"; del.title = "Remove";
    del.onclick = function (e) { e.preventDefault(); e.stopPropagation();
      items.splice(idx, 1); save(items); render(); };
    tile.appendChild(del);
    shortcutsEl.appendChild(tile);
  });
  var add = document.createElement("button");
  add.className = "tile add"; add.title = "Add shortcut"; add.innerHTML = "+";
  add.onclick = function () { openModal(false); };
  shortcutsEl.appendChild(add);
}

function openModal(edit) {
  modalTitle.textContent = edit ? "Edit shortcut" : "Add shortcut";
  nameInput.value = ""; urlInput.value = "";
  modal.hidden = false;
  requestAnimationFrame(function () { nameInput.focus(); });
}
function closeModal() { modal.hidden = true; }

document.getElementById("search-form").addEventListener("submit", function (e) {
  e.preventDefault();
  var v = document.getElementById("search-input").value;
  var url = normalizeUrl(v);
  if (url) window.location.href = url;
});
document.getElementById("modal-cancel").onclick = closeModal;
document.getElementById("modal-save").onclick = function () {
  var name = nameInput.value.trim(); var url = normalizeUrl(urlInput.value);
  if (!name || !url) return;
  items.push({ title: name, url: url }); save(items); closeModal(); render();
};
modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

render();

// Support button — open support page in new tab
(function () {
  var btn = document.getElementById("support-btn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var port = window.__ECHO_SETTINGS_PORT__;
    if (port) {
      window.open("http://127.0.0.1:" + port + "/support", "_blank");
    }
  });
})();
