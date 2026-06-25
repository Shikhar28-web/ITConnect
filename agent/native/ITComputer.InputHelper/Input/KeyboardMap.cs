namespace ITComputer.InputHelper.Input;

/// <summary>
/// Maps JavaScript KeyboardEvent.key strings to Windows Virtual Key codes.
/// Single printable chars return 0 — caller uses KEYEVENTF_UNICODE instead.
/// </summary>
internal static class KeyboardMap
{
    private static readonly Dictionary<string, ushort> _map = new(StringComparer.OrdinalIgnoreCase)
    {
        // ── Control / editing ────────────────────────────────────────────────
        ["Enter"]       = 0x0D, // VK_RETURN
        ["Return"]      = 0x0D,
        ["Escape"]      = 0x1B, // VK_ESCAPE
        ["Esc"]         = 0x1B,
        ["Tab"]         = 0x09, // VK_TAB
        ["Backspace"]   = 0x08, // VK_BACK
        ["Delete"]      = 0x2E, // VK_DELETE
        ["Insert"]      = 0x2D, // VK_INSERT
        ["Space"]       = 0x20, // VK_SPACE
        [" "]           = 0x20,

        // ── Navigation ───────────────────────────────────────────────────────
        ["Home"]        = 0x24, // VK_HOME
        ["End"]         = 0x23, // VK_END
        ["PageUp"]      = 0x21, // VK_PRIOR
        ["PageDown"]    = 0x22, // VK_NEXT
        ["ArrowLeft"]   = 0x25, // VK_LEFT
        ["ArrowUp"]     = 0x26, // VK_UP
        ["ArrowRight"]  = 0x27, // VK_RIGHT
        ["ArrowDown"]   = 0x28, // VK_DOWN

        // ── Modifiers ────────────────────────────────────────────────────────
        ["Control"]     = 0x11, // VK_CONTROL
        ["Ctrl"]        = 0x11,
        ["Alt"]         = 0x12, // VK_MENU
        ["Shift"]       = 0x10, // VK_SHIFT
        ["Meta"]        = 0x5B, // VK_LWIN
        ["OS"]          = 0x5B,
        ["ContextMenu"] = 0x5D, // VK_APPS
        ["CapsLock"]    = 0x14, // VK_CAPITAL
        ["NumLock"]     = 0x90, // VK_NUMLOCK
        ["ScrollLock"]  = 0x91, // VK_SCROLL

        // ── Function keys ────────────────────────────────────────────────────
        ["F1"]  = 0x70, ["F2"]  = 0x71, ["F3"]  = 0x72, ["F4"]  = 0x73,
        ["F5"]  = 0x74, ["F6"]  = 0x75, ["F7"]  = 0x76, ["F8"]  = 0x77,
        ["F9"]  = 0x78, ["F10"] = 0x79, ["F11"] = 0x7A, ["F12"] = 0x7B,
        ["F13"] = 0x7C, ["F14"] = 0x7D, ["F15"] = 0x7E, ["F16"] = 0x7F,
        ["F17"] = 0x80, ["F18"] = 0x81, ["F19"] = 0x82, ["F20"] = 0x83,
        ["F21"] = 0x84, ["F22"] = 0x85, ["F23"] = 0x86, ["F24"] = 0x87,

        // ── System / special ─────────────────────────────────────────────────
        ["PrintScreen"] = 0x2C, // VK_SNAPSHOT
        ["Pause"]       = 0x13, // VK_PAUSE

        // ── Numpad ───────────────────────────────────────────────────────────
        ["Numpad0"] = 0x60, ["Numpad1"] = 0x61, ["Numpad2"] = 0x62,
        ["Numpad3"] = 0x63, ["Numpad4"] = 0x64, ["Numpad5"] = 0x65,
        ["Numpad6"] = 0x66, ["Numpad7"] = 0x67, ["Numpad8"] = 0x68,
        ["Numpad9"] = 0x69,
        ["NumpadMultiply"] = 0x6A,
        ["NumpadAdd"]      = 0x6B,
        ["NumpadSubtract"] = 0x6D,
        ["NumpadDecimal"]  = 0x6E,
        ["NumpadDivide"]   = 0x6F,
        ["NumpadEnter"]    = 0x0D,

        // ── Media / browser keys ─────────────────────────────────────────────
        ["AudioVolumeMute"]  = 0xAD,
        ["AudioVolumeDown"]  = 0xAE,
        ["AudioVolumeUp"]    = 0xAF,
        ["MediaTrackNext"]   = 0xB0,
        ["MediaTrackPrevious"] = 0xB1,
        ["MediaStop"]        = 0xB2,
        ["MediaPlayPause"]   = 0xB3,
        ["BrowserBack"]      = 0xA6,
        ["BrowserForward"]   = 0xA7,
        ["BrowserRefresh"]   = 0xA8,
        ["BrowserHome"]      = 0xAC,
        ["LaunchApp1"]       = 0xB6,
        ["LaunchApp2"]       = 0xB7,

        // ── OEM / punctuation keys (US layout VK) ────────────────────────────
        [";"]  = 0xBA, // VK_OEM_1
        ["="]  = 0xBB, // VK_OEM_PLUS
        [","]  = 0xBC, // VK_OEM_COMMA
        ["-"]  = 0xBD, // VK_OEM_MINUS
        ["."]  = 0xBE, // VK_OEM_PERIOD
        ["/"]  = 0xBF, // VK_OEM_2
        ["`"]  = 0xC0, // VK_OEM_3
        ["["]  = 0xDB, // VK_OEM_4
        ["\\"] = 0xDC, // VK_OEM_5
        ["]"]  = 0xDD, // VK_OEM_6
        ["'"]  = 0xDE, // VK_OEM_7
    };

    /// <summary>
    /// Returns the Windows VK code for a JS key name.
    /// Returns 0 for single printable characters — use KEYEVENTF_UNICODE instead.
    /// </summary>
    public static ushort ToVirtualKey(string key)
    {
        if (_map.TryGetValue(key, out ushort vk))
            return vk;

        // Single uppercase letter A-Z → VK_A (0x41) … VK_Z (0x5A)
        if (key.Length == 1)
        {
            char ch = char.ToUpperInvariant(key[0]);
            if (ch >= 'A' && ch <= 'Z') return (ushort)ch;
            if (ch >= '0' && ch <= '9') return (ushort)ch;
            return 0; // printable — caller uses KEYEVENTF_UNICODE
        }

        return 0;
    }
}
