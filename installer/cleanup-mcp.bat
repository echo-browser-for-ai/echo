@echo off
REM Echo MCP Cleanup — manually removes Echo's MCP entries from all AI coding
REM apps. Run this if you uninstalled Echo but your AI tools still show an "echo"
REM server, or before uninstalling if you want a guaranteed clean removal.
REM Uses the installed files at %~dp0 (node.exe + the shared cleanup logic).

"%~dp0resources\node.exe" "%~dp0resources\echo-mcp-cleanup.mjs"
echo.
echo MCP cleanup complete. Restart your AI tools.
pause
