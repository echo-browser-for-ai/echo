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
//   echowin.exe <pid> <0=hide | 1=probe | 5=show+activate>
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

    private const int SW_HIDE = 0;
    private const int PROBE = 1;
    private const int SW_SHOW = 5;
    private const int SW_RESTORE = 9;

    private const string BROWSER_WIN_CLASS = "Chrome_WidgetWin_1";

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

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
    private static void ShowAndActivate(IntPtr hWnd)
    {
        ShowWindow(hWnd, SW_SHOW);
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
        Console.Error.WriteLine(
            "foreground=" + (GetForegroundWindow() == hWnd ? "yes" : "no"));
    }

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: echowin.exe <pid> <0=hide|1=probe|5=show>");
            return 2;
        }
        if (!uint.TryParse(args[0], out targetPid))
        {
            Console.Error.WriteLine("Invalid pid: " + args[0]);
            return 2;
        }
        int action;
        if (!int.TryParse(args[1], out action))
        {
            Console.Error.WriteLine("Invalid action: " + args[1]);
            return 2;
        }

        handles.Clear();
        targetAction = action;
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
                ShowAndActivate(h);
            }
            count++;
        }

        Console.WriteLine(count);
        if (action == PROBE)
        {
            Console.WriteLine(
                "visible=" + (anyVisible ? "1" : "0") + " iconic=" + (anyIconic ? "1" : "0"));
        }
        return count > 0 ? 0 : 1;
    }
}
