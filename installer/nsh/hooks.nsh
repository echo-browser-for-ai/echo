; Echo NSIS install/uninstall hooks
;
; These are called by electron-builder's NSIS template.
; preInit runs at the very start of the installer's .onInit — before the UI.
; customInstall runs after files are copied (installer).
; customUnInit runs at the very start of the uninstaller (un.onInit),
;   before any files are deleted — this is where we clean up MCP entries.

!macro preInit
  ; Kill any running Echo.exe so the installer can overwrite files.
  nsExec::ExecToLog 'cmd /c taskkill /f /im Echo.exe 2>nul & exit 0'
  ; Also kill EchoBrowser.exe (the bundled Chromium) — if it's still running
  ; it holds locks on profile files, preventing a clean wipe on uninstall.
  nsExec::ExecToLog 'cmd /c taskkill /f /im EchoBrowser.exe /T 2>nul & exit 0'
  ; After UAC elevation, the installer window may be hidden behind other apps.
  ; Explicitly bring it to the foreground so the user sees the setup wizard.
  BringToFront
!macroend

!macro customInstall
  ; MCP config REGISTRATION is handled by the Echo app itself on startup
  ; (see shouldAutoRegister() + registerMcpConfigs() in electron/main.ts), which
  ; runs on every launch and refreshes every 7 days. Nothing to do here at
  ; install time — the old echo-mcp.cmd hook referenced deleted shim files.
!macroend

!macro customUnInit
  ; Kill the browser process FIRST so it doesn't hold file locks during the wipe.
  nsExec::ExecToLog 'cmd /c taskkill /f /im EchoBrowser.exe /T 2>nul & exit 0'
  ; Run MCP config CLEANUP at the very start of uninstall, BEFORE any files are
  ; deleted. At this point $INSTDIR\resources\node.exe and the cleanup script
  ; still exist. The cleanup script removes the "echo" entry from every AI
  ; coding app's config — the mirror of what the app does at startup.
  nsExec::ExecToLog '"$INSTDIR\resources\node.exe" "$INSTDIR\resources\echo-mcp-cleanup.mjs"'
  Pop $0
  ${if} $0 != "0"
    FileOpen $1 "$TEMP\echo-uninstall-error.log" w
    FileWrite $1 "MCP cleanup exited with code: $0$\r$\n"
    FileClose $1
  ${endif}
  ; Wipe Echo's browsing data (history/cookies/tiles/bookmarks) so reinstall
  ; is clean. Per-user install means $APPDATA is the real user, not
  ; Administrator — the wipe now hits the right folder.
  ; Wipe both casings to be bulletproof (NTFS is case-insensitive).
  RMDir /r "$APPDATA\echo"
  RMDir /r "$APPDATA\Echo"
  ; Delete the first-run marker so the next install is treated as a fresh
  ; first run (no --restore-last-session). KEEP the rest of ~/.echo.
  Delete "$PROFILE\.echo\.profile-initialized"
  ; Belt-and-suspenders: signal Echo to wipe its own profile on next launch
  ; (runs as the correct user — always reliable even if the above missed).
  FileOpen $0 "$PROFILE\.echo\.wipe-on-next-launch" w
  FileClose $0
!macroend
