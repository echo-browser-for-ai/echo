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
//   echowin.exe <pid> <0=hide | 5=show>
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

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: echowin.exe <pid> <0=hide|5=show>");
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
        foreach (var h in handles)
        {
            ShowWindow(h, action);
            count++;
        }

        Console.WriteLine(count);
        return count > 0 ? 0 : 1;
    }
}
