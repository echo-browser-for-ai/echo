#!/usr/bin/env bash
# -*- mode: sh -*-
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Vendor runtime dependencies for the Windows installer.
#
# Stages into build/installer/resources/:
#   node.exe          — Portable Node 20 LTS (Windows)
#   shims/            — Multi-file ESM (compiled mcp-server/dist)
#   node_modules/     — ws, @playwright/mcp, playwright-core,
#                       jsonc-parser, @iarna/toml
#
# Run from project root: bash scripts/vendor-runtime.sh
# ─────────────────────────────────────────────────────────────

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="$PROJECT_ROOT/build/installer/resources"
NODE_VERSION="20.18.3"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"

echo "[vendor] Staging runtime to $RESOURCES_DIR"

rm -rf "$RESOURCES_DIR"
mkdir -p "$RESOURCES_DIR/shims"
mkdir -p "$RESOURCES_DIR/node_modules"

# ── 1. Download portable Node.js 20 LTS (Windows) ──────────
if [ ! -f "$RESOURCES_DIR/node.exe" ]; then
  echo "[vendor] Downloading Node.js ${NODE_VERSION} Windows x64..."
  TMP_ZIP=$(mktemp)
  curl -fsSL "$NODE_URL" -o "$TMP_ZIP"
  unzip -q -o "$TMP_ZIP" "node-v${NODE_VERSION}-win-x64/node.exe" -d /tmp/
  cp "/tmp/node-v${NODE_VERSION}-win-x64/node.exe" "$RESOURCES_DIR/node.exe"
  rm -rf "/tmp/node-v${NODE_VERSION}-win-x64" "$TMP_ZIP"
  chmod +x "$RESOURCES_DIR/node.exe"
  echo "[vendor] node.exe extracted"
fi

# ── 2. Copy compiled ESM shim (multi-file) ─────────────────
# The compiled index.js imports ./cli.js, ./lockfile.js,
# and dynamically imports ./installer/{install,uninstall,status,agents,merge,backup,print,paths}.js
# We copy the entire dist/ tree so all imports resolve.
echo "[vendor] Copying compiled dist (multi-file ESM)..."
rm -rf "$RESOURCES_DIR/shims"
mkdir -p "$RESOURCES_DIR/shims"
cp -r "$PROJECT_ROOT/mcp-server/dist/." "$RESOURCES_DIR/shims/"
# Remove source maps (not needed in production)
rm -f "$RESOURCES_DIR/shims/"*.map
rm -rf "$RESOURCES_DIR/shims/installer/"*.map
# Rename index.js → echo-shim.js (the entry point)
mv "$RESOURCES_DIR/shims/index.js" "$RESOURCES_DIR/shims/echo-shim.js"

# Create package.json with "type": "module" so Node treats .js files as ESM
echo '{"type":"module"}' > "$RESOURCES_DIR/shims/package.json"

# ── 3. Vendor runtime node_modules ─────────────────────────
# These are needed by the MCP server at runtime.
echo "[vendor] Vendoring @playwright/mcp..."
cp -r "$PROJECT_ROOT/node_modules/@playwright" "$RESOURCES_DIR/node_modules/"

echo "[vendor] Vendoring playwright-core..."
cp -r "$PROJECT_ROOT/node_modules/playwright-core" "$RESOURCES_DIR/node_modules/"

echo "[vendor] Vendoring ws..."
cp -r "$PROJECT_ROOT/node_modules/ws" "$RESOURCES_DIR/node_modules/"

echo "[vendor] Vendoring jsonc-parser..."
cp -r "$PROJECT_ROOT/node_modules/jsonc-parser" "$RESOURCES_DIR/node_modules/"

echo "[vendor] Vendoring @iarna/toml..."
cp -r "$PROJECT_ROOT/node_modules/@iarna" "$RESOURCES_DIR/node_modules/"

# ── 4. Create .cmd wrapper ──────────────────────────────────
echo "[vendor] Creating echo-mcp.cmd..."
cat > "$PROJECT_ROOT/build/installer/echo-mcp.cmd" << 'CMDEOF'
@echo off
"%~dp0resources\node.exe" "%~dp0resources\shims\echo-shim.js" %*
CMDEOF

echo "[vendor] Done. Staged at $RESOURCES_DIR"
ls -la "$RESOURCES_DIR/node.exe" "$RESOURCES_DIR/shims/echo-shim.js" "$PROJECT_ROOT/build/installer/echo-mcp.cmd"
echo "[vendor] node.exe version:"
"$RESOURCES_DIR/node.exe" --version 2>/dev/null || echo "(can't run Windows binary on Linux — expected)"
echo "[vendor] Vendored modules:"
ls "$RESOURCES_DIR/node_modules/"
