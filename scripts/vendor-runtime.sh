#!/usr/bin/env bash
# -*- mode: sh -*-
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Stage the runtime files the Windows installer carries.
#
# Stages into build/installer/resources/:
#   node.exe       — Portable Node 20 LTS (Windows)
#   node_modules/  — @playwright/mcp, playwright-core, ws,
#                    jsonc-parser, @iarna/toml, pdfjs-dist
#
# The release build does this itself (.github/workflows/release.yml stages the
# same files), so this script is for building an installer locally:
#
#   npm run build:installer      # stage, then tsc + vite + electron-builder
#
# NOT staged here, on purpose: chromium/ (released separately as the engine),
# echo-extension/, echowin.exe, echo-mcp-launcher.js, echo-pdf-server.mjs and
# echo-mcp-cleanup.mjs — those are checked in or built by other steps.
#
# Safety note: this script used to begin with `rm -rf build/installer/resources`,
# which wiped the staged Chromium and everything else already there, and then
# failed on steps for the old `shims/` MCP server that no longer exists. It now
# removes only the directories it is about to rewrite, so it can be run safely.
# ─────────────────────────────────────────────────────────────

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="$PROJECT_ROOT/build/installer/resources"
NODE_MODULES_DIR="$RESOURCES_DIR/node_modules"
NODE_VERSION="20.18.3"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"

echo "[vendor] Staging runtime into $RESOURCES_DIR"
mkdir -p "$NODE_MODULES_DIR"

# ── 1. Portable Node for Windows ───────────────────────────
# The version matters: echo-pdf-server.mjs runs on this node.exe, and the
# pdfjs-dist pin below is chosen to work with it.
if [ -f "$RESOURCES_DIR/node.exe" ]; then
  echo "[vendor] node.exe already staged ($("$RESOURCES_DIR/node.exe" --version 2>/dev/null || echo "${NODE_VERSION}?"))"
else
  echo "[vendor] Downloading Node.js ${NODE_VERSION} (Windows x64)..."
  TMP_ZIP="$(mktemp)"
  curl -fsSL "$NODE_URL" -o "$TMP_ZIP"
  unzip -q -o "$TMP_ZIP" "node-v${NODE_VERSION}-win-x64/node.exe" -d /tmp/
  cp "/tmp/node-v${NODE_VERSION}-win-x64/node.exe" "$RESOURCES_DIR/node.exe"
  rm -rf "/tmp/node-v${NODE_VERSION}-win-x64" "$TMP_ZIP"
  chmod +x "$RESOURCES_DIR/node.exe"
  echo "[vendor] node.exe staged"
fi

# ── 2. Dependencies of the browser MCP server ──────────────
vendor () {
  echo "[vendor] Vendoring $1..."
  rm -rf "$NODE_MODULES_DIR/$1"
  cp -r "$PROJECT_ROOT/node_modules/$1" "$NODE_MODULES_DIR/$1"
}
vendor "@playwright"
vendor "playwright-core"
vendor "ws"
vendor "jsonc-parser"
vendor "@iarna"

# ── 3. PDF text for echo-pdf-server.mjs ────────────────────
# Only the runtime pieces ship: the legacy ESM build, its worker, the standard
# fonts and the CJK cmaps. Dropping the .map files and the non-legacy build
# keeps this near 5 MB instead of the package's full 36 MB.
#
# pdfjs-dist is pinned to exactly 4.10.38 in package.json, for two reasons:
#   1. v5 calls DOMMatrix during text extraction and only gets it by loading
#      @napi-rs/canvas — an optional dependency whose Windows binary is 37 MB
#      and which this installer does not ship — so on v5 the failure is
#      "DOMMatrix is not defined" at runtime.
#   2. v5.5+ needs Node 20.19 and v5.7+ needs Node 22.13, while $NODE_VERSION
#      above is 20.18.3.
# Raising the pin without re-checking both breaks PDF reading, and only at
# runtime. The same warning sits beside the copy step in release.yml.
echo "[vendor] Vendoring pdfjs-dist (PDF text for echo-pdf-server)..."
PDFJS_SRC="$PROJECT_ROOT/node_modules/pdfjs-dist"
PDFJS_DST="$NODE_MODULES_DIR/pdfjs-dist"
rm -rf "$PDFJS_DST"
mkdir -p "$PDFJS_DST/legacy/build"
cp "$PDFJS_SRC/package.json" "$PDFJS_DST/"
[ -f "$PDFJS_SRC/LICENSE" ] && cp "$PDFJS_SRC/LICENSE" "$PDFJS_DST/"
cp "$PDFJS_SRC/legacy/build/pdf.mjs" "$PDFJS_SRC/legacy/build/pdf.worker.mjs" "$PDFJS_DST/legacy/build/"
cp -r "$PDFJS_SRC/standard_fonts" "$PDFJS_SRC/cmaps" "$PDFJS_DST/"

echo "[vendor] Done."
echo "[vendor] Staged runtime:"
ls -1 "$NODE_MODULES_DIR" | sed 's/^/  node_modules\//'
[ -f "$RESOURCES_DIR/node.exe" ] && echo "  node.exe ($(du -h "$RESOURCES_DIR/node.exe" | cut -f1))"
echo "[vendor] Total: $(du -sh "$RESOURCES_DIR" | cut -f1)"
