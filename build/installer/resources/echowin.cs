// echowin.cs — tiny native helper to hide/show a process's windows.
//
// WHY THIS EXISTS:
// Echo keeps bundled Chromium (EchoBrowser.exe) alive in the background so the
// MCP/CDP connection never drops. When the user "minimizes to tray", we hide
// Chromium's window completely (no taskbar entry) via Win32 ShowWindow(SW_HIDE).
//
// PowerShell was the original mechanism but is BROKEN on the target machine
// (the Microsoft.PowerShell.Security module fails to load — a system policy
// cripples PowerShell, so every earlier SW_HIDE attempt silently failed).
// This standalone .exe avoids PowerShell entirely. It is compiled once with:
//   csc.exe -nologo -out:echowin.exe echowin.cs
// (csc.exe ships with .NET Framework at C:\Windows\Microsoft.NET\Framework64\v4.0.30319\)
//
// USAGE:
//   echowin.exe <pid> <0=hide | 1=probe | 3=show+maximize | 5=show+activate>
// Prints the count of windows it acted on to stdout. Exit 0 if >=1 window was
// found and acted on, 1 if none were found, 2 on bad args.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class EchoWin
{
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    private const uint GW_OWNER = 4;
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;

    private const int SW_HIDE = 0;
    private const int PROBE = 1;
    private const int SW_SHOWMAXIMIZED = 3;
    private const int SW_SHOW = 5;
    private const int SW_RESTORE = 9;

    private const string BROWSER_WIN_CLASS = "Chrome_WidgetWin_1";

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    // This is built as a WINDOWS-subsystem app (-target:winexe) so it never
    // allocates a console window. That matters: the caller used to spawn it with
    // Node's windowsHide:true, which puts SW_HIDE in the child's STARTUPINFO —
    // and Windows then silently overrides that process's FIRST ShowWindow call
    // with SW_HIDE. So "show" became a hide, while SetForegroundWindow still
    // succeeded, and the caller logged "foreground=yes" for a window that never
    // appeared. Being a GUI-subsystem binary removes the need for windowsHide
    // entirely, so the startup state is clean.
    //
    // Consequence: write to stdout/stderr defensively — they are valid when the
    // parent redirects them, but absent if a person runs this by hand.
    private static void Out(string s)
    {
        try { Console.WriteLine(s); } catch { }
    }

    private static void Err(string s)
    {
        try { Console.Error.WriteLine(s); } catch { }
    }

    private static List<IntPtr> handles = new List<IntPtr>();
    private static uint targetPid;
    private static int targetAction;

    private static bool Callback(IntPtr hWnd, IntPtr lParam)
    {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid != targetPid) return true;

        // Only act on Chromium's real browser-window class. Chromium also owns
        // many hidden helper windows (Chrome_WidgetWin_0, Chrome_StatusTrayWindow,
        // Base_PowerMessageWindow, IME, COM/OLE windows). Force-showing those
        // creates phantom taskbar icons. Chrome_WidgetWin_1 is Chromium's main
        // frame class and covers all real browser windows (incl. Ctrl+N extras).
        var cls = new System.Text.StringBuilder(64);
        GetClassName(hWnd, cls, 64);
        if (cls.ToString() != BROWSER_WIN_CLASS) return true;

        // Chrome_WidgetWin_1 is NOT only the browser frame. Chromium gives its
        // popup bubbles the same class — notably the "Restore pages?" bubble it
        // shows after an unclean exit. That bubble is small, VISIBLE, owned by
        // the browser window, and a tool window.
        //
        // Acting on it broke things badly:
        //   * "is any window visible?" answered YES while the real window was
        //     hidden (the bubble was the visible one), so Show believed the
        //     browser was already on screen and skipped restoring it;
        //   * activating the bubble last stole the foreground from the real
        //     window, so the browser flashed into view and then went behind
        //     everything — the "split second then disappears" report.
        //
        // A genuine browser window has no owner and is not a tool window.
        if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return true;
        if ((GetWindowLong(hWnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;

        // Include the window whether or not it is currently visible: SHOW must be
        // able to un-hide a previously-hidden browser window (IsWindowVisible is
        // false for it). ShowWindow is a safe no-op on an already-(hidden|visible)
        // window, so no visibility filtering is needed for either action.
        handles.Add(hWnd);
        return true;
    }

    /// <summary>
    /// Un-hide the window and genuinely bring it to the front.
    ///
    /// Showing alone is not enough: Windows leaves the window behind whatever
    /// the user is looking at, so "show from tray" appeared to do nothing until
    /// they clicked the taskbar icon. Two details matter:
    ///   1. Only call SW_RESTORE when the window is genuinely minimised.
    ///      SW_RESTORE also un-maximises, which would undo the maximisation
    ///      Echo applies separately via CDP.
    ///   2. SetForegroundWindow is refused while another process owns the
    ///      foreground, so attach to the foreground thread for the duration.
    /// </summary>
    private static void ShowAndActivate(IntPtr hWnd, bool maximize)
    {
        // SW_SHOWMAXIMIZED rather than SW_SHOW for the maximised case: Chromium's
        // own idea of the window state goes stale once the window has been hidden
        // with SW_HIDE (it can report "maximized" while the real window sits at
        // its small restore rect), so asking CDP to maximise is a no-op. Letting
        // Win32 do it sidesteps the disagreement entirely.
        ShowWindow(hWnd, maximize ? SW_SHOWMAXIMIZED : SW_SHOW);
        if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);

        uint currentThread = GetCurrentThreadId();
        IntPtr foreground = GetForegroundWindow();
        uint foregroundProcess = 0;
        uint foregroundThread = foreground == IntPtr.Zero
            ? 0
            : GetWindowThreadProcessId(foreground, out foregroundProcess);

        bool attached = false;
        if (foregroundThread != 0 && foregroundThread != currentThread)
        {
            attached = AttachThreadInput(currentThread, foregroundThread, true);
        }

        BringWindowToTop(hWnd);
        SetForegroundWindow(hWnd);

        if (attached) AttachThreadInput(currentThread, foregroundThread, false);

        // Report the outcome on stderr so it lands in Echo's log. Windows can
        // silently refuse SetForegroundWindow, and "did the window actually come
        // to the front?" is otherwise impossible to answer after the fact.
        Err(
            "foreground=" + (GetForegroundWindow() == hWnd ? "yes" : "no"));
    }

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Err("Usage: echowin.exe <pid> <0=hide|1=probe|3=show+maximize|5=show>");
            return 2;
        }
        if (!uint.TryParse(args[0], out targetPid))
        {
            Err("Invalid pid: " + args[0]);
            return 2;
        }
        int action;
        if (!int.TryParse(args[1], out action))
        {
            Err("Invalid action: " + args[1]);
            return 2;
        }

        handles.Clear();
        targetAction = action;

        // ── BURN THE FIRST ShowWindow CALL ──────────────────────────────────
        // Windows overrides the FIRST ShowWindow call a process makes with the
        // show state from that process's STARTUPINFO. This one binary is spawned
        // by Node, whose startup info says "normal" (or "hide" when the caller
        // passes windowsHide:true), so the real call below was silently being
        // turned into SW_SHOWNORMAL — which is why "show" always produced a
        // small window and never a maximised one, and why windowsHide:true made
        // show behave as hide. Making one call on a null handle first absorbs
        // the override so every call afterwards honours its own argument.
        ShowWindow(IntPtr.Zero, SW_SHOW);
        // ────────────────────────────────────────────────────────────────────

        EnumWindows(Callback, IntPtr.Zero);

        int count = 0;
        bool anyVisible = false;
        bool anyIconic = false;
        foreach (var h in handles)
        {
            if (action == SW_HIDE)
            {
                ShowWindow(h, SW_HIDE);
            }
            else if (action == PROBE)
            {
                // Report the truth about the window. This is the ONLY reliable
                // source: CDP cannot see ShowWindow(SW_HIDE) at all, so a hidden
                // window still answers windowState=maximized to Chromium, which
                // made the tray toggle hide a window the user was trying to show.
                if (IsWindowVisible(h)) anyVisible = true;
                if (IsIconic(h)) anyIconic = true;
            }
            else
            {
                ShowAndActivate(h, action == SW_SHOWMAXIMIZED);
            }
            count++;
        }

        Out(count.ToString());
        if (action == PROBE)
        {
            Out(
                "visible=" + (anyVisible ? "1" : "0") + " iconic=" + (anyIconic ? "1" : "0"));
        }
        return count > 0 ? 0 : 1;
    }
}
