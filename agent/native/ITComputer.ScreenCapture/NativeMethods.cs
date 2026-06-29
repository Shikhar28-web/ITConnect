using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace ITComputer.ScreenCapture;

public static class NativeMethods
{
    // Desktop and Thread
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, [Out] StringBuilder pvInfo, uint nLength, out uint lpnLengthNeeded);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    // GDI P/Invokes
    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowDC(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

    public const int SRCCOPY = 0x00CC0020;
    public const int CAPTUREBLT = 0x40000000;



    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, uint dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    public static void InjectMouseMove(int x, int y)
    {
        uint dx = (uint)Math.Round((double)x * 65535.0 / 10000.0);
        uint dy = (uint)Math.Round((double)y * 65535.0 / 10000.0);
        mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, dx, dy, 0, 0);
    }

    public static void InjectMouseClick(int x, int y, int button)
    {
        uint dx = (uint)Math.Round((double)x * 65535.0 / 10000.0);
        uint dy = (uint)Math.Round((double)y * 65535.0 / 10000.0);

        // Move to the position absolute first
        mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, dx, dy, 0, 0);
        System.Threading.Thread.Sleep(10);

        uint down = MOUSEEVENTF_LEFTDOWN;
        uint up = MOUSEEVENTF_LEFTUP;
        if (button == 2)
        {
            down = MOUSEEVENTF_RIGHTDOWN;
            up = MOUSEEVENTF_RIGHTUP;
        }
        else if (button == 1)
        {
            down = MOUSEEVENTF_MIDDLEDOWN;
            up = MOUSEEVENTF_MIDDLEUP;
        }
        mouse_event(down | MOUSEEVENTF_ABSOLUTE, dx, dy, 0, 0);
        System.Threading.Thread.Sleep(15);
        mouse_event(up | MOUSEEVENTF_ABSOLUTE, dx, dy, 0, 0);
    }

    public static void InjectMouseDown(int x, int y, int button)
    {
        uint dx = (uint)Math.Round((double)x * 65535.0 / 10000.0);
        uint dy = (uint)Math.Round((double)y * 65535.0 / 10000.0);

        mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, dx, dy, 0, 0);
        System.Threading.Thread.Sleep(10);

        uint down = MOUSEEVENTF_LEFTDOWN;
        if (button == 2) down = MOUSEEVENTF_RIGHTDOWN;
        else if (button == 1) down = MOUSEEVENTF_MIDDLEDOWN;
        mouse_event(down | MOUSEEVENTF_ABSOLUTE, dx, dy, 0, 0);
    }

    public static void InjectMouseUp(int x, int y, int button)
    {
        uint dx = (uint)Math.Round((double)x * 65535.0 / 10000.0);
        uint dy = (uint)Math.Round((double)y * 65535.0 / 10000.0);

        mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, dx, dy, 0, 0);
        System.Threading.Thread.Sleep(10);

        uint up = MOUSEEVENTF_LEFTUP;
        if (button == 2) up = MOUSEEVENTF_RIGHTUP;
        else if (button == 1) up = MOUSEEVENTF_MIDDLEUP;
        mouse_event(up | MOUSEEVENTF_ABSOLUTE, dx, dy, 0, 0);
    }

    public static void InjectMouseWheel(int delta)
    {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, 0);
    }

    public static void InjectKey(string combo)
    {
        try
        {
            SendKeys.SendWait(combo);
        }
        catch
        {
            // Ignore key injection failure (e.g. if focus is lost)
        }
    }

    public static void InjectRawKey(int vk, bool ctrl, bool alt, bool shift)
    {
        const uint KEYEVENTF_KEYUP = 0x0002;
        const byte VK_SHIFT = 0x10;
        const byte VK_CONTROL = 0x11;
        const byte VK_MENU = 0x12;

        try
        {
            // Press modifiers
            if (ctrl) keybd_event(VK_CONTROL, 0, 0, 0);
            if (alt) keybd_event(VK_MENU, 0, 0, 0);
            if (shift) keybd_event(VK_SHIFT, 0, 0, 0);

            // Press and release the key
            keybd_event((byte)vk, 0, 0, 0);
            System.Threading.Thread.Sleep(10);
            keybd_event((byte)vk, 0, KEYEVENTF_KEYUP, 0);

            // Release modifiers
            if (shift) keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0);
            if (alt) keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
            if (ctrl) keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
        }
        catch
        {
            // Ignore key injection failure
        }
    }
}
