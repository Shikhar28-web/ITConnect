using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using ITComputer.WindowsService.Interop;

namespace ITComputer.WindowsService.Desktop;

/// <summary>
/// Detects and captures the secure desktop (Winlogon / UAC consent screen).
///
/// Why this needs a Windows Service (LocalSystem):
///   On modern Windows, the secure desktops (Winlogon, SAW) are isolated from
///   normal user-mode processes. A user-mode process cannot open these desktops
///   via OpenInputDesktop because they are owned by the SYSTEM account.
///   Running as LocalSystem bypasses this restriction.
///
/// How it works:
///   1. GetCurrentDesktopName() checks which desktop the input desktop is.
///   2. If it's "Winlogon" or "SAW-secure*", we switch the service thread's
///      desktop context to that desktop.
///   3. We capture via GDI BitBlt (works on the secure desktop from SYSTEM).
///   4. The captured frame is JPEG-encoded and returned as base64 for relay
///      over SignalR to the admin console.
/// </summary>
public sealed class SecureDesktopCapture
{
    private const int JpegQuality = 60; // balance quality vs SignalR message size

    /// <summary>Returns the name of the currently active input desktop.</summary>
    public static string GetCurrentDesktopName()
    {
        IntPtr hDesk = NativeApi.OpenInputDesktop(0, false,
            NativeApi.DESKTOP_READOBJECTS | NativeApi.DESKTOP_ENUMERATE);

        if (hDesk == IntPtr.Zero) return "Unknown";

        try
        {
            var sb  = new StringBuilder(256);
            NativeApi.GetUserObjectInformation(hDesk, NativeApi.UOI_NAME, sb, 256, out _);
            return sb.ToString();
        }
        finally
        {
            NativeApi.CloseDesktop(hDesk);
        }
    }

    /// <summary>
    /// Captures the current secure desktop as a base64 JPEG string.
    /// Returns null if the desktop cannot be opened or is not a secure desktop.
    /// </summary>
    public static string? CaptureSecureDesktop()
    {
        string desktopName = GetCurrentDesktopName();

        // Only capture if we are on a secure desktop
        bool isSecure = desktopName.Equals("Winlogon", StringComparison.OrdinalIgnoreCase)
                     || desktopName.StartsWith("SAW-", StringComparison.OrdinalIgnoreCase)
                     || desktopName.StartsWith("WinSta0\\Winlogon", StringComparison.OrdinalIgnoreCase);

        if (!isSecure) return null;

        // Open the secure desktop
        IntPtr hDesk = NativeApi.OpenDesktop(desktopName, 0, false, NativeApi.GENERIC_ALL);
        if (hDesk == IntPtr.Zero)
        {
            // Fallback: try OpenInputDesktop (works when already on that desktop)
            hDesk = NativeApi.OpenInputDesktop(0, false, NativeApi.GENERIC_ALL);
        }
        if (hDesk == IntPtr.Zero) return null;

        // Switch this thread's desktop so GetDesktopWindow() returns the secure one
        IntPtr prevDesk = NativeApi.GetThreadDesktop(NativeApi.GetCurrentThreadId());
        NativeApi.SetThreadDesktop(hDesk);

        try
        {
            return CaptureScreen();
        }
        finally
        {
            // Always restore thread desktop before releasing
            if (prevDesk != IntPtr.Zero)
                NativeApi.SetThreadDesktop(prevDesk);
            NativeApi.CloseDesktop(hDesk);
        }
    }

    // ── GDI screen capture ────────────────────────────────────────────────────

    private static string? CaptureScreen()
    {
        int w = NativeApi.GetSystemMetrics(NativeApi.SM_CXSCREEN);
        int h = NativeApi.GetSystemMetrics(NativeApi.SM_CYSCREEN);
        if (w <= 0 || h <= 0) return null;

        IntPtr hwndDesk = NativeApi.GetDesktopWindow();
        IntPtr hdcScreen = NativeApi.GetWindowDC(hwndDesk);
        if (hdcScreen == IntPtr.Zero) return null;

        IntPtr hdcMem = NativeApi.CreateCompatibleDC(hdcScreen);
        IntPtr hBitmap = NativeApi.CreateCompatibleBitmap(hdcScreen, w, h);
        IntPtr hOld = NativeApi.SelectObject(hdcMem, hBitmap);

        NativeApi.BitBlt(hdcMem, 0, 0, w, h, hdcScreen, 0, 0, NativeApi.SRCCOPY);

        NativeApi.SelectObject(hdcMem, hOld);
        NativeApi.DeleteDC(hdcMem);
        NativeApi.ReleaseDC(hwndDesk, hdcScreen);

        try
        {
            using var bmp = Image.FromHbitmap(hBitmap);
            using var ms  = new MemoryStream();

            var encoderParams = new EncoderParameters(1);
            encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)JpegQuality);
            ImageCodecInfo? jpegCodec = GetJpegCodec();

            if (jpegCodec != null)
                bmp.Save(ms, jpegCodec, encoderParams);
            else
                bmp.Save(ms, ImageFormat.Jpeg);

            return Convert.ToBase64String(ms.ToArray());
        }
        catch
        {
            return null;
        }
        finally
        {
            NativeApi.DeleteObject(hBitmap);
        }
    }

    private static ImageCodecInfo? GetJpegCodec()
    {
        foreach (var codec in ImageCodecInfo.GetImageEncoders())
            if (codec.MimeType == "image/jpeg") return codec;
        return null;
    }
}
