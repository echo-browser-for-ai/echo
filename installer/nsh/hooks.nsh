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
  ; Kill the browser process FIRST so it doesn't hold file locks during uninstall.
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
  ; ── DO NOT DELETE BROWSING DATA HERE ─────────────────────────────────────
  ; Windows runs this uninstaller when installing a NEW VERSION over an old
  ; one, so anything destructive in this macro also runs on EVERY auto-update.
  ; An earlier version wiped "$APPDATA\Echo" (cookies, logins, history) and
  ; wrote a ".wipe-on-next-launch" marker into ~/.echo here, which made the
  ; app wipe its own profile again on the next launch. Net effect: every
  ; update signed the user out of everything and deleted their new-tab
  ; shortcuts. That is why it is gone. Do not reintroduce it.
  ; If a user wants their browsing data cleared, they use the app's own
  ; "Clear browsing data" button (Settings -> Advanced) — user-initiated only.
  ; ────────────────────────────────────────────────────────────────────────
!macroend
