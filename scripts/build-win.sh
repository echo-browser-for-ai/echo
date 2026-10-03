#!/usr/bin/env bash
# Build Windows NSIS installer with Z: drive mapping for uninstaller extraction
# The Z: drive lets the WSL-run Windows installer write the uninstaller to the Linux filesystem
set -e

# Map Z: drive to WSL root so NSIS WriteUninstaller can write to Linux paths from Windows
cmd.exe /c 'subst Z: \\wsl.localhost\Ubuntu\' 2>/dev/null || true

# Run electron-builder — capture exit code
npx electron-builder --win nsis --x64 --publish never
EXIT_CODE=$?

# Always clean up Z: drive mapping
cmd.exe /c 'subst Z: /d' 2>/dev/null || true

exit $EXIT_CODE
