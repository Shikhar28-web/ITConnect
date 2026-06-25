using ITComputer.InputHelper.Blackout;
using ITComputer.InputHelper.Input;
using ITComputer.InputHelper.Interop;

// ─────────────────────────────────────────────────────────────────────────────
//  ITComputer.InputHelper — Native Win32 Input & Blackout Helper
//
//  Spawned by Electron agent (replaces the PowerShell inputWorker).
//  Communicates via stdin/stdout with a simple line-based command protocol.
//
//  CRITICAL THREADING RULE:
//    BlockInput() and all SendInput() calls MUST run on this same thread.
//    Windows exempts the calling thread from BlockInput — so physical
//    employee input is blocked while admin injected input still works.
//    The single-threaded stdin loop guarantees this invariant.
//
//  Command protocol (one command per line):
//    m  <x> <y>                     Mouse move (physical pixels)
//    c  <x> <y> <button>            Mouse click (0=left 1=mid 2=right)
//    d  <x> <y> <button>            Mouse button down
//    u  <x> <y> <button>            Mouse button up
//    w  <delta>                     Mouse wheel
//    k  <key> <isDown> <ctrl> <alt> <shift>  Keyboard event
//    h                              Hide global cursor
//    r                              Restore global cursor
//    b  <1|0>                       BlockInput on/off
//    B  <1|0>                       Blackout overlay show/hide
//    e  <hwnd>                      SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
//    q  <1|0>                       Restore (1) / demote (0) Shell_TrayWnd z-order
// ─────────────────────────────────────────────────────────────────────────────

// Set process DPI awareness context programmatically before creating any windows
try
{
    User32.SetProcessDpiAwarenessContext(User32.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
}
catch
{
    // Ignore if not supported on the OS version
}

// Disable stdout buffering so Electron's readline gets lines immediately
Console.OutputEncoding = System.Text.Encoding.UTF8;
Console.InputEncoding  = System.Text.Encoding.UTF8;

// Restore cursor on any exit (process kill / Electron shutdown)
AppDomain.CurrentDomain.ProcessExit += (_, _) => CursorManager.RestoreGlobalCursor();

string? line;
while ((line = Console.ReadLine()) is not null)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    line = line.TrimEnd('\r', '\n');

    // Split once only — avoid repeated allocations in hot path
    var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
    if (parts.Length == 0) continue;

    try
    {
        switch (parts[0])
        {
            // ── Mouse move ───────────────────────────────────────────────────
            case "m" when parts.Length >= 3:
                InputEngine.Move(int.Parse(parts[1]), int.Parse(parts[2]));
                break;

            // ── Mouse click ──────────────────────────────────────────────────
            case "c" when parts.Length >= 4:
                InputEngine.Click(
                    int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]));
                break;

            // ── Mouse button down ─────────────────────────────────────────────
            case "d" when parts.Length >= 4:
                InputEngine.MouseDown(
                    int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]));
                break;

            // ── Mouse button up ───────────────────────────────────────────────
            case "u" when parts.Length >= 4:
                InputEngine.MouseUp(
                    int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]));
                break;

            // ── Mouse wheel ───────────────────────────────────────────────────
            case "w" when parts.Length >= 2:
                InputEngine.MouseWheel(int.Parse(parts[1]));
                break;

            // ── Keyboard event ────────────────────────────────────────────────
            // k <key> <isDown:0|1> <ctrl:0|1> <alt:0|1> <shift:0|1>
            case "k" when parts.Length >= 6:
                InputEngine.KeyEvent(
                    key:    parts[1],
                    isDown: parts[2] == "1",
                    ctrl:   parts[3] == "1",
                    alt:    parts[4] == "1",
                    shift:  parts[5] == "1");
                break;

            // ── Hide cursor ───────────────────────────────────────────────────
            case "h":
                CursorManager.HideGlobalCursor();
                break;

            // ── Restore cursor ────────────────────────────────────────────────
            case "r":
                CursorManager.RestoreGlobalCursor();
                break;

            // ── BlockInput ────────────────────────────────────────────────────
            // This thread is exempt from BlockInput — SendInput from here still works.
            case "b" when parts.Length >= 2:
                User32.BlockInput(parts[1] == "1");
                break;

            // ── Blackout overlay show/hide ────────────────────────────────────
            case "B" when parts.Length >= 2:
                if (parts[1] == "1") BlackoutOverlay.Show();
                else                 BlackoutOverlay.Hide();
                break;

            // ── SetWindowDisplayAffinity (WDA_EXCLUDEFROMCAPTURE) ─────────────
            case "e" when parts.Length >= 2:
                if (long.TryParse(parts[1], out long hwndVal))
                    User32.SetWindowDisplayAffinity(new IntPtr(hwndVal), User32.WDA_EXCLUDEFROMCAPTURE);
                break;

            // ── Taskbar z-order ───────────────────────────────────────────────
            // q 0 = demote taskbars to HWND_NOTOPMOST; q 1 = restore taskbars topmost
            case "q" when parts.Length >= 2:
            {
                IntPtr insertAfter = parts[1] == "1" ? User32.HWND_TOPMOST : User32.HWND_NOTOPMOST;

                IntPtr tray = User32.FindWindow("Shell_TrayWnd", null);
                if (tray != IntPtr.Zero)
                {
                    User32.SetWindowPos(tray, insertAfter, 0, 0, 0, 0,
                        User32.SWP_NOMOVE | User32.SWP_NOSIZE | User32.SWP_NOACTIVATE);
                }

                IntPtr secTray = IntPtr.Zero;
                while ((secTray = User32.FindWindowEx(IntPtr.Zero, secTray, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero)
                {
                    User32.SetWindowPos(secTray, insertAfter, 0, 0, 0, 0,
                        User32.SWP_NOMOVE | User32.SWP_NOSIZE | User32.SWP_NOACTIVATE);
                }
                break;
            }
        }
    }
    catch (Exception ex)
    {
        // Log to stderr — Electron can optionally listen but won't be blocked
        Console.Error.WriteLine($"[InputHelper] Error on '{line}': {ex.Message}");
    }
}

// Cleanup on stdin close (Electron process exited)
CursorManager.RestoreGlobalCursor();
BlackoutOverlay.Hide();
