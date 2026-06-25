using System.Runtime.InteropServices;

namespace ITComputer.WindowsService.Interop;

/// <summary>
/// All Win32 / WTS P/Invoke declarations used by the Windows Service.
/// The service runs as LocalSystem so we have access to privileged APIs:
/// - SendSAS (sas.dll) — generate Ctrl+Alt+Delete from LocalSystem
/// - WTS APIs — enumerate sessions, get active console session
/// - Desktop APIs — open Winlogon / UAC desktops, set thread desktop
/// - GDI BitBlt — capture secure desktop screen content
/// </summary>
internal static class NativeApi
{
    // ── SAS (Secure Attention Sequence = Ctrl+Alt+Delete) ─────────────────────

    /// <summary>
    /// Sends the Secure Attention Sequence.
    /// MUST be called from LocalSystem (Windows Service) — fails from user-mode.
    /// asUser=true: SAS on behalf of the logged-on user; false: system-level SAS.
    /// </summary>
    [DllImport("sas.dll", SetLastError = true)]
    public static extern void SendSAS(bool asUser);

    // ── WTS Session APIs ───────────────────────────────────────────────────────

    [DllImport("kernel32.dll")]
    public static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("wtsapi32.dll", SetLastError = true)]
    public static extern bool WTSQueryUserToken(uint SessionId, out IntPtr phToken);

    [DllImport("wtsapi32.dll")]
    public static extern void WTSFreeMemory(IntPtr pMemory);

    // ── Desktop APIs ──────────────────────────────────────────────────────────

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(
        string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool GetUserObjectInformation(
        IntPtr hObj, int nIndex,
        [Out] System.Text.StringBuilder pvInfo,
        uint nLength, out uint lpnLengthNeeded);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern IntPtr GetThreadDesktop(uint dwThreadId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    public const uint DESKTOP_READOBJECTS       = 0x0001;
    public const uint DESKTOP_CREATEWINDOW      = 0x0002;
    public const uint DESKTOP_CREATEMENU        = 0x0004;
    public const uint DESKTOP_HOOKCONTROL       = 0x0008;
    public const uint DESKTOP_JOURNALRECORD     = 0x0010;
    public const uint DESKTOP_JOURNALPLAYBACK   = 0x0020;
    public const uint DESKTOP_ENUMERATE         = 0x0040;
    public const uint DESKTOP_WRITEOBJECTS      = 0x0080;
    public const uint DESKTOP_SWITCHDESKTOP     = 0x0100;
    public const uint GENERIC_ALL               = 0x10000000;

    public const int UOI_NAME = 2; // GetUserObjectInformation index for desktop name

    // ── GDI screen capture ────────────────────────────────────────────────────

    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowDC(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(
        IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight,
        IntPtr hdcSrc, int nXSrc, int nYSrc, uint dwRop);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    public const uint SRCCOPY = 0x00CC0020;

    // ── System metrics ────────────────────────────────────────────────────────

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    public const int SM_CXSCREEN = 0;
    public const int SM_CYSCREEN = 1;

    // ── SendInput (for secure desktop input from service context) ─────────────

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int x, int y);

    public const int INPUT_MOUSE    = 0;
    public const int INPUT_KEYBOARD = 1;

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    public struct INPUT
    {
        public int type;
        public INPUTUNION u;
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Explicit)]
    public struct INPUTUNION
    {
        [System.Runtime.InteropServices.FieldOffset(0)] public MOUSEINPUT    mi;
        [System.Runtime.InteropServices.FieldOffset(0)] public KEYBDINPUT    ki;
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public IntPtr dwExtraInfo;
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk, wScan;
        public uint dwFlags, time;
        public IntPtr dwExtraInfo;
    }

    public const uint MOUSEEVENTF_LEFTDOWN  = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP    = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP   = 0x0010;
    public const uint KEYEVENTF_KEYUP       = 0x0002;
}
