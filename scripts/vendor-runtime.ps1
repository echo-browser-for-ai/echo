# PowerShell equivalent of vendor-runtime.sh
# Stages portable Node.js, compiled ESM shims, and vendored node_modules
# into build/installer/resources/ for the Windows installer.

$ErrorActionPreference = "Stop"
$root = "$PSScriptRoot\.."
$resDir = "$root\build\installer\resources"
$nodeVersion = "20.18.3"

Write-Host "[vendor] Staging runtime to $resDir"

# Clean and recreate
if (Test-Path $resDir) { Remove-Item -Recurse -Force $resDir }
New-Item -ItemType Directory -Force -Path "$resDir\shims" | Out-Null
New-Item -ItemType Directory -Force -Path "$resDir\node_modules" | Out-Null

# ── 1. Download portable Node.js ───────────────────────────
$nodeExe = "$resDir\node.exe"
if (-not (Test-Path $nodeExe)) {
  Write-Host "[vendor] Downloading Node.js $nodeVersion Windows x64..."
  $zip = "$env:TEMP\node-v$nodeVersion-win-x64.zip"
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath "$env:TEMP\node-extract" -Force
  Copy-Item "$env:TEMP\node-extract\node-v$nodeVersion-win-x64\node.exe" $nodeExe
  Remove-Item $zip -Force
  Remove-Item -Recurse -Force "$env:TEMP\node-extract"
  Write-Host "[vendor] node.exe extracted"
}

# ── 2. Copy compiled ESM shim ──────────────────────────────
Write-Host "[vendor] Copying compiled dist (multi-file ESM)..."
Remove-Item -Recurse -Force "$resDir\shims" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$resDir\shims" | Out-Null
Copy-Item -Recurse "$root\mcp-server\dist\*" "$resDir\shims\"
Remove-Item "$resDir\shims\*.map" -ErrorAction SilentlyContinue
Remove-Item "$resDir\shims\installer\*.map" -ErrorAction SilentlyContinue
Rename-Item "$resDir\shims\index.js" "$resDir\shims\echo-shim.js"
Set-Content -Path "$resDir\shims\package.json" -Value '{"type":"module"}'

# ── 3. Vendor node_modules ─────────────────────────────────
Write-Host "[vendor] Vendoring @playwright/mcp..."
Copy-Item -Recurse "$root\node_modules\@playwright" "$resDir\node_modules\"

Write-Host "[vendor] Vendoring playwright-core..."
Copy-Item -Recurse "$root\node_modules\playwright-core" "$resDir\node_modules\"

Write-Host "[vendor] Vendoring ws..."
Copy-Item -Recurse "$root\node_modules\ws" "$resDir\node_modules\"

Write-Host "[vendor] Vendoring jsonc-parser..."
Copy-Item -Recurse "$root\node_modules\jsonc-parser" "$resDir\node_modules\"

Write-Host "[vendor] Vendoring @iarna/toml..."
Copy-Item -Recurse "$root\node_modules\@iarna" "$resDir\node_modules\"

# ── 4. Create .cmd wrapper ──────────────────────────────────
Write-Host "[vendor] Creating echo-mcp.cmd..."
Set-Content -Path "$root\build\installer\echo-mcp.cmd" -Value @'
@echo off
"%~dp0resources\node.exe" "%~dp0resources\shims\echo-shim.js" %*
'@

Write-Host "[vendor] Done. Staged at $resDir"
Get-Item "$nodeExe", "$resDir\shims\echo-shim.js", "$root\build\installer\echo-mcp.cmd" | Format-Table FullName, Length
Write-Host "[vendor] node.exe version:"
& $nodeExe --version
Write-Host "[vendor] Vendored modules:"
Get-ChildItem "$resDir\node_modules" | Select-Object Name