using ITComputer.InputHelper.Interop;

namespace ITComputer.InputHelper.Input;

/// <summary>
/// Hides and restores the global system cursor by replacing all cursor shapes
/// with an invisible blank cursor using Win32 SetSystemCursor.
/// This affects the ENTIRE desktop session — the cursor is invisible to the
/// physically seated employee even though software injection still works.
/// </summary>
internal static class CursorManager
{
    /// <summary>Replace every system cursor shape with a transparent 1x1 cursor.</summary>
    public static void HideGlobalCursor()
    {
        int cx = User32.GetSystemMetrics(User32.SM_CXCURSOR);
        int cy = User32.GetSystemMetrics(User32.SM_CYCURSOR);
        if (cx <= 0) cx = 32;
        if (cy <= 0) cy = 32;

        // AND plane all 1 → fully transparent (cursor blends with background)
        // XOR plane all 0 → no inversion
        int widthBytes = ((cx + 15) / 16) * 2;
        int planeBytes = widthBytes * cy;

        byte[] andPlane = new byte[planeBytes];
        for (int i = 0; i < planeBytes; i++) andPlane[i] = 0xFF;
        byte[] xorPlane = new byte[planeBytes];  // all zero

        foreach (uint id in User32.AllCursorIds)
        {
            IntPtr blank = User32.CreateCursor(IntPtr.Zero, 0, 0, cx, cy, andPlane, xorPlane);
            if (blank != IntPtr.Zero)
                User32.SetSystemCursor(blank, id);
        }
    }

    /// <summary>Restore all cursor shapes to their Windows defaults.</summary>
    public static void RestoreGlobalCursor()
    {
        User32.SystemParametersInfo(User32.SPI_SETCURSORS, 0, IntPtr.Zero, 0);
    }
}
