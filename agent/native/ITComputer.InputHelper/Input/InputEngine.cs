using ITComputer.InputHelper.Interop;

namespace ITComputer.InputHelper.Input;

/// <summary>
/// Mouse and keyboard injection via SendInput.
/// All methods MUST be called from the same thread that called BlockInput
/// (the main stdin-reader thread) so the "calling thread is exempt" rule applies.
/// </summary>
internal static class InputEngine
{
    // ── Mouse ─────────────────────────────────────────────────────────────────

    /// <summary>Move cursor to absolute physical pixel coordinates.</summary>
    public static void Move(int x, int y)
    {
        // SetCursorPos is the most reliable move primitive on multi-monitor setups.
        // SendInput MOVE can be added too but SetCursorPos alone is sufficient for positioning.
        User32.SetCursorPos(x, y);
    }

    /// <summary>Press and release a mouse button at (x, y).</summary>
    public static void Click(int x, int y, int button)
    {
        User32.SetCursorPos(x, y);
        (uint down, uint up) = ButtonFlags(button);
        SendMouseButton(down);
        System.Threading.Thread.Sleep(15);
        SendMouseButton(up);
    }

    public static void MouseDown(int x, int y, int button)
    {
        User32.SetCursorPos(x, y);
        SendMouseButton(ButtonFlags(button).down);
    }

    public static void MouseUp(int x, int y, int button)
    {
        User32.SetCursorPos(x, y);
        SendMouseButton(ButtonFlags(button).up);
    }

    public static void MouseWheel(int delta)
    {
        var input = new User32.INPUT
        {
            type = User32.INPUT_MOUSE,
            u = new User32.INPUTUNION
            {
                mi = new User32.MOUSEINPUT
                {
                    mouseData = (uint)delta,
                    dwFlags = User32.MOUSEEVENTF_WHEEL
                }
            }
        };
        User32.SendInput(1, [input], System.Runtime.InteropServices.Marshal.SizeOf<User32.INPUT>());
    }

    // ── Keyboard ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Inject a key event.
    /// Uses KEYEVENTF_UNICODE for printable characters (layout-independent)
    /// and VK codes for control/special keys.
    /// </summary>
    public static void KeyEvent(string key, bool isDown, bool ctrl, bool alt, bool shift)
    {
        uint flags = isDown ? 0u : User32.KEYEVENTF_KEYUP;

        // Send modifiers first on keydown, last on keyup
        if (isDown)
        {
            if (ctrl)  SendVk(0x11, flags); // VK_CONTROL
            if (alt)   SendVk(0x12, flags); // VK_MENU
            if (shift) SendVk(0x10, flags); // VK_SHIFT
        }

        // Resolve the key itself
        ushort vk = KeyboardMap.ToVirtualKey(key);

        if (vk != 0)
        {
            // Known VK code — send as virtual key with scan code
            ushort scan = (ushort)User32.MapVirtualKey(vk, User32.MAPVK_VK_TO_VSC);
            uint extFlags = flags;
            // Extended-key flag required for: Delete, Insert, Home, End, PageUp/Down, arrows, numpad /, right Ctrl/Alt
            if (IsExtendedKey(vk)) extFlags |= User32.KEYEVENTF_EXTENDEDKEY;

            var input = new User32.INPUT
            {
                type = User32.INPUT_KEYBOARD,
                u = new User32.INPUTUNION
                {
                    ki = new User32.KEYBDINPUT
                    {
                        wVk = vk, wScan = scan, dwFlags = extFlags
                    }
                }
            };
            User32.SendInput(1, [input], System.Runtime.InteropServices.Marshal.SizeOf<User32.INPUT>());
        }
        else if (key.Length == 1)
        {
            // Printable single character — inject as Unicode (layout-independent)
            char ch = key[0];
            var input = new User32.INPUT
            {
                type = User32.INPUT_KEYBOARD,
                u = new User32.INPUTUNION
                {
                    ki = new User32.KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = ch,
                        dwFlags = User32.KEYEVENTF_UNICODE | flags
                    }
                }
            };
            User32.SendInput(1, [input], System.Runtime.InteropServices.Marshal.SizeOf<User32.INPUT>());
        }

        // Release modifiers on keyup
        if (!isDown)
        {
            if (shift) SendVk(0x10, flags);
            if (alt)   SendVk(0x12, flags);
            if (ctrl)  SendVk(0x11, flags);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static void SendMouseButton(uint flags)
    {
        var input = new User32.INPUT
        {
            type = User32.INPUT_MOUSE,
            u = new User32.INPUTUNION { mi = new User32.MOUSEINPUT { dwFlags = flags } }
        };
        User32.SendInput(1, [input], System.Runtime.InteropServices.Marshal.SizeOf<User32.INPUT>());
    }

    private static void SendVk(ushort vk, uint flags)
    {
        ushort scan = (ushort)User32.MapVirtualKey(vk, User32.MAPVK_VK_TO_VSC);
        var input = new User32.INPUT
        {
            type = User32.INPUT_KEYBOARD,
            u = new User32.INPUTUNION
            {
                ki = new User32.KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags }
            }
        };
        User32.SendInput(1, [input], System.Runtime.InteropServices.Marshal.SizeOf<User32.INPUT>());
    }

    private static (uint down, uint up) ButtonFlags(int button) => button switch
    {
        2 => (User32.MOUSEEVENTF_RIGHTDOWN,  User32.MOUSEEVENTF_RIGHTUP),
        1 => (User32.MOUSEEVENTF_MIDDLEDOWN, User32.MOUSEEVENTF_MIDDLEUP),
        _ => (User32.MOUSEEVENTF_LEFTDOWN,   User32.MOUSEEVENTF_LEFTUP)
    };

    private static bool IsExtendedKey(ushort vk) => vk is
        0x21 or 0x22 or 0x23 or 0x24 or // PageUp, PageDown, End, Home
        0x25 or 0x26 or 0x27 or 0x28 or // Arrow keys
        0x2D or 0x2E or                  // Insert, Delete
        0x6F or                          // Numpad Divide
        0xA3 or 0xA5;                    // Right Ctrl, Right Alt
}
