using System;
using System.Runtime.InteropServices;
using System.Text;

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

    // SendInput structure declarations
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern short VkKeyScan(char ch);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public INPUTUNION U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION
    {
        [FieldOffset(0)]
        public MOUSEINPUT mi;
        [FieldOffset(0)]
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;

    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    public static void SendMouseMoveAbsolute(int x, int y)
    {
        int screenWidth = GetSystemMetrics(0); // SM_CXSCREEN
        int screenHeight = GetSystemMetrics(1); // SM_CYSCREEN
        if (screenWidth <= 0) screenWidth = 1920;
        if (screenHeight <= 0) screenHeight = 1080;

        int normalizedX = (x * 65535) / screenWidth;
        int normalizedY = (y * 65535) / screenHeight;

        var inputs = new[]
        {
            new INPUT
            {
                type = INPUT_MOUSE,
                U = new INPUTUNION
                {
                    mi = new MOUSEINPUT
                    {
                        dx = normalizedX,
                        dy = normalizedY,
                        dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | 0x4000 // MOUSEEVENTF_VIRTUALDESK
                    }
                }
            }
        };
        SendInput(1, inputs, Marshal.SizeOf<INPUT>());
    }

    public static void InjectMouseClick(int x, int y, int button)
    {
        SendMouseMoveAbsolute(x, y);
        System.Threading.Thread.Sleep(10); // Ensure cursor is positioned

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

        var inputs = new[]
        {
            new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = down } } },
            new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = up } } }
        };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }

    public static void InjectMouseDown(int x, int y, int button)
    {
        SendMouseMoveAbsolute(x, y);
        System.Threading.Thread.Sleep(5);

        uint down = MOUSEEVENTF_LEFTDOWN;
        if (button == 2) down = MOUSEEVENTF_RIGHTDOWN;
        else if (button == 1) down = MOUSEEVENTF_MIDDLEDOWN;

        var inputs = new[]
        {
            new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = down } } }
        };
        SendInput(1, inputs, Marshal.SizeOf<INPUT>());
    }

    public static void InjectMouseUp(int x, int y, int button)
    {
        SendMouseMoveAbsolute(x, y);
        System.Threading.Thread.Sleep(5);

        uint up = MOUSEEVENTF_LEFTUP;
        if (button == 2) up = MOUSEEVENTF_RIGHTUP;
        else if (button == 1) up = MOUSEEVENTF_MIDDLEUP;

        var inputs = new[]
        {
            new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = up } } }
        };
        SendInput(1, inputs, Marshal.SizeOf<INPUT>());
    }

    public static void InjectMouseWheel(int delta)
    {
        var inputs = new[]
        {
            new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_WHEEL, mouseData = (uint)delta } } }
        };
        SendInput(1, inputs, Marshal.SizeOf<INPUT>());
    }

    private static ushort GetVkFromSpecialName(string name)
    {
        switch (name)
        {
            case "ENTER": return 0x0D; // VK_RETURN
            case "TAB": return 0x09; // VK_TAB
            case "BACKSPACE": return 0x08; // VK_BACK
            case "ESC": return 0x1B; // VK_ESCAPE
            case "INSERT": return 0x2D; // VK_INSERT
            case "DEL": return 0x2E; // VK_DELETE
            case "HOME": return 0x24; // VK_HOME
            case "END": return 0x23; // VK_END
            case "PGUP": return 0x21; // VK_PRIOR
            case "PGDN": return 0x22; // VK_NEXT
            case "UP": return 0x26; // VK_UP
            case "DOWN": return 0x28; // VK_DOWN
            case "LEFT": return 0x25; // VK_LEFT
            case "RIGHT": return 0x27; // VK_RIGHT
            case "CAPSLOCK": return 0x14; // VK_CAPITAL
            case "NUMLOCK": return 0x90; // VK_NUMLOCK
            case "SCROLLLOCK": return 0x91; // VK_SCROLL
            case "PRTSC": return 0x2C; // VK_SNAPSHOT
            case "HELP": return 0x2F; // VK_HELP
            case "F1": return 0x70;
            case "F2": return 0x71;
            case "F3": return 0x72;
            case "F4": return 0x73;
            case "F5": return 0x74;
            case "F6": return 0x75;
            case "F7": return 0x76;
            case "F8": return 0x77;
            case "F9": return 0x78;
            case "F10": return 0x79;
            case "F11": return 0x7A;
            case "F12": return 0x7B;
        }
        return 0;
    }

    private static ushort GetVkFromChar(char c, ref bool shift)
    {
        short res = VkKeyScan(c);
        if (res == -1) return 0;
        
        ushort vk = (ushort)(res & 0xFF);
        int shiftState = (res >> 8) & 0xFF;
        
        if ((shiftState & 1) != 0)
        {
            shift = true;
        }
        
        return vk;
    }

    private static INPUT CreateKeyInput(ushort vk, bool isKeyUp)
    {
        const uint KEYEVENTF_KEYUP = 0x0002;
        ushort scanCode = (ushort)MapVirtualKey(vk, 0); // VK to scan code
        
        return new INPUT
        {
            type = INPUT_KEYBOARD,
            U = new INPUTUNION
            {
                ki = new KEYBDINPUT
                {
                    wVk = vk,
                    wScan = scanCode,
                    dwFlags = isKeyUp ? KEYEVENTF_KEYUP : 0,
                    time = 0,
                    dwExtraInfo = IntPtr.Zero
                }
            }
        };
    }

    public static void InjectKey(string combo)
    {
        try
        {
            bool shift = false;
            bool ctrl = false;
            bool alt = false;
            string keyPart = "";

            int i = 0;
            while (i < combo.Length)
            {
                if (combo[i] == '+')
                {
                    shift = true;
                    i++;
                }
                else if (combo[i] == '^')
                {
                    ctrl = true;
                    i++;
                }
                else if (combo[i] == '%')
                {
                    alt = true;
                    i++;
                }
                else
                {
                    keyPart = combo.Substring(i);
                    break;
                }
            }

            ushort vk = 0;

            if (keyPart.StartsWith("{") && keyPart.EndsWith("}"))
            {
                string specialName = keyPart.Substring(1, keyPart.Length - 2).ToUpper();
                vk = GetVkFromSpecialName(specialName);
            }
            else if (keyPart.Length == 1)
            {
                char c = keyPart[0];
                vk = GetVkFromChar(c, ref shift);
            }

            if (vk != 0)
            {
                var inputs = new System.Collections.Generic.List<INPUT>();

                // Modifiers down
                if (ctrl) inputs.Add(CreateKeyInput(0x11, false)); // VK_CONTROL
                if (alt) inputs.Add(CreateKeyInput(0x12, false)); // VK_MENU
                if (shift) inputs.Add(CreateKeyInput(0x10, false)); // VK_SHIFT

                // Key down
                inputs.Add(CreateKeyInput(vk, false));

                // Key up
                inputs.Add(CreateKeyInput(vk, true));

                // Modifiers up (reverse order)
                if (shift) inputs.Add(CreateKeyInput(0x10, true));
                if (alt) inputs.Add(CreateKeyInput(0x12, true));
                if (ctrl) inputs.Add(CreateKeyInput(0x11, true));

                SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<INPUT>());
            }
        }
        catch (Exception ex)
        {
            // Ignore key injection failure (e.g. if focus is lost)
        }
    }
}
