using System.Runtime.InteropServices;
using ITComputer.InputHelper.Interop;

namespace ITComputer.InputHelper.Blackout;

/// <summary>
/// Creates a native Win32 blackout overlay window on every monitor.
///
/// Why native Win32 instead of Electron BrowserWindow:
///  - WS_EX_TOPMOST via SetWindowPos(HWND_TOPMOST) is absolute — no Electron/CEF
///    frame manager can interfere with the z-order.
///  - SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) makes the window invisible
///    to ALL screen capture APIs (WebRTC, WGC, DDA, GDI BitBlt) so the admin's
///    screen-share feed shows the real desktop underneath.
///  - No CEF/Chromium overhead — the window is pure GDI.
///  - We control the message loop entirely; no Electron abstractions in the way.
///
/// What the employee sees: solid black with "Windows" word bouncing (DVD-style).
/// What the admin sees:     the real desktop — overlay is capture-excluded.
/// </summary>
internal static class BlackoutOverlay
{
    private const string ClassName   = "ITComputerBlackout";
    private const string WindowText  = "Windows";
    private const uint   TimerId     = 1;
    private const uint   TaskbarCheckTimerId = 2;
    private const int    AnimFps     = 60;  // ~16ms timer

    // Keep delegate alive to prevent GC collection (GC hole with P/Invoke callbacks)
    private static User32.WndProcDelegate? _wndProcDelegate;

    // State shared between main thread and UI thread (volatile is sufficient; no races)
    private static volatile bool           _running;
    private static Thread?                 _uiThread;
    private static readonly List<IntPtr>   _hwnds = [];

    private const int Margin = 100;

    // Per-window animation state (indexed by window creation order = monitor order)
    private sealed class WindowState
    {
        public float X = 80, Y = 80;
        public float Vx = 1.8f, Vy = 1.3f;
        public int   ColorIndex;
        public int   MonitorW, MonitorH;
        public int   TextW, TextH;
        public IntPtr Font = IntPtr.Zero;
    }

    private static readonly List<WindowState> _states = [];

    // DVD-screensaver color palette (COLORREF = 0x00BBGGRR)
    private static readonly uint[] _colors =
    [
        0x00FFFFFF, // white
        0x00FF9E4A, // orange
        0x007B61FF, // purple
        0x00E5FF00, // yellow-green
        0x003AFF6E, // green
        0x00FF00E5, // magenta
        0x00FF4A9E, // pink
        0x004AFFFF, // cyan
    ];

    // ── Public API ────────────────────────────────────────────────────────────

    public static void Show()
    {
        if (_running) return;
        _running = true;

        _uiThread = new Thread(UiThreadProc)
        {
            IsBackground = true,
            Name = "BlackoutUI"
        };
        _uiThread.SetApartmentState(ApartmentState.STA);
        _uiThread.Start();
    }

    public static void Hide()
    {
        if (!_running) return;
        _running = false;

        // Post WM_APP_DESTROY_WINDOW to each window to destroy it on the UI thread
        lock (_hwnds)
        {
            foreach (var hwnd in _hwnds)
            {
                if (hwnd != IntPtr.Zero)
                    User32.PostMessage(hwnd, User32.WM_APP_DESTROY_WINDOW, IntPtr.Zero, IntPtr.Zero);
            }
        }
    }

    // ── UI thread ─────────────────────────────────────────────────────────────

    private static void UiThreadProc()
    {
        RegisterWindowClass();
        CreateWindowsForAllMonitors();

        // Demote taskbar to HWND_BOTTOM immediately
        DemoteTaskbar();

        // Message loop
        while (User32.GetMessage(out User32.MSG msg, IntPtr.Zero, 0, 0) > 0)
        {
            User32.TranslateMessage(ref msg);
            User32.DispatchMessage(ref msg);
        }

        // Cleanup
        lock (_hwnds) { _hwnds.Clear(); }
        lock (_states) { _states.Clear(); }
        RestoreTaskbar();
        User32.UnregisterClass(ClassName, User32.GetModuleHandle(null));
    }

    // ── Window class ──────────────────────────────────────────────────────────

    private static void RegisterWindowClass()
    {
        _wndProcDelegate = WndProc; // keep reference alive!

        var wc = new User32.WNDCLASSEX
        {
            cbSize        = (uint)Marshal.SizeOf<User32.WNDCLASSEX>(),
            style         = 0,
            lpfnWndProc   = Marshal.GetFunctionPointerForDelegate(_wndProcDelegate),
            hInstance     = User32.GetModuleHandle(null),
            hbrBackground = CreateBlackBrush(),
            lpszClassName = ClassName,
        };
        User32.RegisterClassEx(ref wc);
    }

    // ── Monitor enumeration ───────────────────────────────────────────────────

    private static void CreateWindowsForAllMonitors()
    {
        int monitorIndex = 0;

        User32.EnumDisplayMonitors(
            IntPtr.Zero, IntPtr.Zero,
            (IntPtr hMonitor, IntPtr hdcMonitor, ref User32.RECT rect, IntPtr data) =>
            {
                var mi = new User32.MONITORINFO { cbSize = (uint)Marshal.SizeOf<User32.MONITORINFO>() };
                User32.GetMonitorInfo(hMonitor, ref mi);

                var bounds = mi.rcMonitor; // full monitor bounds including taskbar
                CreateBlackoutWindow(bounds, monitorIndex++);
                return true; // continue enumeration
            },
            IntPtr.Zero);
    }

    private static void CreateBlackoutWindow(User32.RECT bounds, int index)
    {
        uint exStyle = User32.WS_EX_TOPMOST
                     | User32.WS_EX_TOOLWINDOW   // no taskbar button
                     | User32.WS_EX_NOACTIVATE   // never steals focus
                     | User32.WS_EX_TRANSPARENT  // click-through
                     | User32.WS_EX_LAYERED;     // required for click-through to work reliably

        int left = bounds.Left - Margin;
        int top = bounds.Top - Margin;
        int width = bounds.Width + (Margin * 2);
        int height = bounds.Height + (Margin * 2);

        IntPtr hwnd = User32.CreateWindowEx(
            exStyle, ClassName, "ITComputer Blackout",
            User32.WS_POPUP,
            left, top, width, height,
            IntPtr.Zero, IntPtr.Zero, User32.GetModuleHandle(null), IntPtr.Zero);

        if (hwnd == IntPtr.Zero) return;

        // Make layered window fully opaque
        User32.SetLayeredWindowAttributes(hwnd, 0, 255, User32.LWA_ALPHA);

        // Force HWND_TOPMOST with exact monitor bounds + margin
        User32.SetWindowPos(hwnd, User32.HWND_TOPMOST,
            left, top, width, height,
            User32.SWP_SHOWWINDOW | User32.SWP_NOACTIVATE);

        // CRITICAL: exclude from ALL screen capture — admin sees real desktop
        User32.SetWindowDisplayAffinity(hwnd, User32.WDA_EXCLUDEFROMCAPTURE);

        // Show without activating (don't steal focus)
        User32.ShowWindow(hwnd, User32.SW_SHOWNA);

        // Animation timer (~60fps)
        User32.SetTimer(hwnd, TimerId, 1000u / AnimFps, IntPtr.Zero);
        // Taskbar check every 200ms
        User32.SetTimer(hwnd, TaskbarCheckTimerId, 200, IntPtr.Zero);

        // Create per-window state
        var state = new WindowState
        {
            X  = 80 + index * 30,
            Y  = 80 + index * 20,
            ColorIndex = index % _colors.Length,
            MonitorW = bounds.Width,
            MonitorH = bounds.Height
        };
        // Measure text in GDI to know bounds for bouncing
        state.Font = CreateWindowFont(bounds.Height);

        lock (_states)
        {
            while (_states.Count <= index) _states.Add(null!);
            _states[index] = state;
        }

        lock (_hwnds) { _hwnds.Add(hwnd); }
    }

    // ── Window procedure ──────────────────────────────────────────────────────

    private static IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        switch (msg)
        {
            case User32.WM_ERASEBKGND:
                return new IntPtr(1); // we handle background in WM_PAINT

            case User32.WM_PAINT:
                OnPaint(hWnd);
                return IntPtr.Zero;

            case User32.WM_TIMER:
                if ((uint)wParam == TimerId)
                    OnAnimationTick(hWnd);
                else if ((uint)wParam == TaskbarCheckTimerId)
                    DemoteTaskbar();
                return IntPtr.Zero;

            case User32.WM_APP_DESTROY_WINDOW:
                User32.KillTimer(hWnd, TimerId);
                User32.KillTimer(hWnd, TaskbarCheckTimerId);
                User32.DestroyWindow(hWnd);
                // If all windows destroyed, exit message loop
                lock (_hwnds)
                {
                    bool allGone = true;
                    foreach (var h in _hwnds)
                    {
                        // After DestroyWindow, hWnd is invalid — assume it's gone
                        if (h != hWnd && h != IntPtr.Zero) { allGone = false; break; }
                    }
                    if (allGone) User32.PostQuitMessage(0);
                }
                return IntPtr.Zero;

            case User32.WM_DESTROY:
                return IntPtr.Zero;
        }
        return User32.DefWindowProc(hWnd, msg, wParam, lParam);
    }

    // ── Paint ─────────────────────────────────────────────────────────────────

    private static void OnPaint(IntPtr hWnd)
    {
        IntPtr hdc = User32.BeginPaint(hWnd, out User32.PAINTSTRUCT ps);

        // Get client rect
        User32.GetClientRect(hWnd, out User32.RECT rc);

        // Fill black background
        using var blackBrush = new GdiBrush(0x00000000);
        User32.FillRect(hdc, ref rc, blackBrush.Handle);

        var state = GetState(hWnd);
        if (state is null) { User32.EndPaint(hWnd, ref ps); return; }

        // Draw bouncing text
        var oldFont = IntPtr.Zero;
        if (state.Font != IntPtr.Zero)
            oldFont = User32.SelectObject(hdc, state.Font);

        User32.SetBkMode(hdc, User32.TRANSPARENT);
        User32.SetTextColor(hdc, _colors[state.ColorIndex]);

        // Measure text size for bounce bounds
        if (User32.GetTextExtentPoint32(hdc, WindowText, WindowText.Length, out User32.SIZE sz))
        {
            state.TextW = sz.cx;
            state.TextH = sz.cy;
        }

        User32.TextOut(hdc, (int)state.X + Margin, (int)state.Y + Margin, WindowText, WindowText.Length);

        if (oldFont != IntPtr.Zero)
            User32.SelectObject(hdc, oldFont);

        User32.EndPaint(hWnd, ref ps);
    }

    // ── Animation tick ────────────────────────────────────────────────────────

    private static void OnAnimationTick(IntPtr hWnd)
    {
        var state = GetState(hWnd);
        if (state is null) return;

        if (state.MonitorW == 0) return; // not yet initialized

        state.X += state.Vx;
        state.Y += state.Vy;

        bool bounced = false;
        int maxX = state.MonitorW - state.TextW;
        int maxY = state.MonitorH - state.TextH;
        if (maxX < 0) maxX = 0;
        if (maxY < 0) maxY = 0;

        if (state.X >= maxX) { state.X = maxX; state.Vx = -Math.Abs(state.Vx); bounced = true; }
        if (state.X <= 0)    { state.X = 0;    state.Vx =  Math.Abs(state.Vx); bounced = true; }
        if (state.Y >= maxY) { state.Y = maxY; state.Vy = -Math.Abs(state.Vy); bounced = true; }
        if (state.Y <= 0)    { state.Y = 0;    state.Vy =  Math.Abs(state.Vy); bounced = true; }

        if (bounced)
            state.ColorIndex = (state.ColorIndex + 1) % _colors.Length;

        // Re-assert TOPMOST and trigger repaint
        User32.SetWindowPos(hWnd, User32.HWND_TOPMOST, 0, 0, 0, 0,
            User32.SWP_NOMOVE | User32.SWP_NOSIZE | User32.SWP_NOACTIVATE);

        User32.InvalidateRect(hWnd, IntPtr.Zero, false);
    }

    // ── Taskbar demotion / restoration ────────────────────────────────────────

    private static void DemoteTaskbar()
    {
        // Demote primary taskbar to HWND_NOTOPMOST so it sits below topmost windows
        IntPtr tray = User32.FindWindow("Shell_TrayWnd", null);
        if (tray != IntPtr.Zero)
            User32.SetWindowPos(tray, User32.HWND_NOTOPMOST, 0, 0, 0, 0,
                User32.SWP_NOMOVE | User32.SWP_NOSIZE | User32.SWP_NOACTIVATE);

        // Demote all secondary taskbars to HWND_NOTOPMOST
        IntPtr secTray = IntPtr.Zero;
        while ((secTray = User32.FindWindowEx(IntPtr.Zero, secTray, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero)
        {
            User32.SetWindowPos(secTray, User32.HWND_NOTOPMOST, 0, 0, 0, 0,
                User32.SWP_NOMOVE | User32.SWP_NOSIZE | User32.SWP_NOACTIVATE);
        }
    }

    private static void RestoreTaskbar()
    {
        // Restore primary taskbar to HWND_TOPMOST
        IntPtr tray = User32.FindWindow("Shell_TrayWnd", null);
        if (tray != IntPtr.Zero)
            User32.SetWindowPos(tray, User32.HWND_TOPMOST, 0, 0, 0, 0,
                User32.SWP_NOMOVE | User32.SWP_NOSIZE | User32.SWP_NOACTIVATE);

        // Restore all secondary taskbars to HWND_TOPMOST
        IntPtr secTray = IntPtr.Zero;
        while ((secTray = User32.FindWindowEx(IntPtr.Zero, secTray, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero)
        {
            User32.SetWindowPos(secTray, User32.HWND_TOPMOST, 0, 0, 0, 0,
                User32.SWP_NOMOVE | User32.SWP_NOSIZE | User32.SWP_NOACTIVATE);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static WindowState? GetState(IntPtr hWnd)
    {
        int idx;
        lock (_hwnds) { idx = _hwnds.IndexOf(hWnd); }
        if (idx < 0) return null;
        lock (_states) { return idx < _states.Count ? _states[idx] : null; }
    }

    private static IntPtr CreateWindowFont(int screenHeight)
    {
        int size = Math.Max(36, screenHeight / 22); // ~5% of screen height
        return User32.CreateFont(
            -size, 0, 0, 0,
            User32.FW_BOLD, 0, 0, 0,
            User32.DEFAULT_CHARSET, User32.OUT_DEFAULT_PRECIS, User32.CLIP_DEFAULT_PRECIS,
            User32.CLEARTYPE_QUALITY, User32.DEFAULT_PITCH | User32.FF_DONTCARE,
            "Segoe UI");
    }

    private static IntPtr CreateBlackBrush() =>
        User32.CreateSolidBrush(0x00000000);

    // Wrapper to safely delete a GDI brush
    private sealed class GdiBrush(uint color) : IDisposable
    {
        public IntPtr Handle { get; } = User32.CreateSolidBrush(color);
        public void Dispose() { if (Handle != IntPtr.Zero) User32.DeleteObject(Handle); }
    }
}
