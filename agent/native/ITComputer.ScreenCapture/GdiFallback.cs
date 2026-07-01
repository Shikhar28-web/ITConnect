using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

namespace ITComputer.ScreenCapture;

public static class GdiCapture
{
    public static byte[] Capture()
    {
        try
        {
            var bounds = Screen.PrimaryScreen.Bounds;
            int width = bounds.Width;
            int height = bounds.Height;

            IntPtr hDesk = NativeMethods.OpenInputDesktop(0, false, 0x0181);
            if (hDesk != IntPtr.Zero)
            {
                NativeMethods.SetThreadDesktop(hDesk);
                NativeMethods.CloseDesktop(hDesk);
            }

            IntPtr hdcSrc = NativeMethods.CreateDC("DISPLAY", null, null, IntPtr.Zero);

            using (Bitmap bmp = new Bitmap(width, height))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    IntPtr hdcDest = g.GetHdc();
                    NativeMethods.BitBlt(hdcDest, 0, 0, width, height, hdcSrc, 0, 0, NativeMethods.SRCCOPY | NativeMethods.CAPTUREBLT);
                    g.ReleaseHdc(hdcDest);
                }
                NativeMethods.DeleteDC(hdcSrc);

                using (MemoryStream ms = new MemoryStream())
                {
                    ImageCodecInfo? jpgEncoder = GetEncoder(ImageFormat.Jpeg);
                    if (jpgEncoder == null) return Array.Empty<byte>();

                    Encoder myEncoder = Encoder.Quality;
                    EncoderParameters myEncoderParameters = new EncoderParameters(1);
                    EncoderParameter myEncoderParameter = new EncoderParameter(myEncoder, 60L);
                    myEncoderParameters.Param[0] = myEncoderParameter;

                    bmp.Save(ms, jpgEncoder, myEncoderParameters);
                    return ms.ToArray();
                }
            }
        }
        catch
        {
            return Array.Empty<byte>();
        }
    }

    private static ImageCodecInfo? GetEncoder(ImageFormat format)
    {
        ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
        foreach (ImageCodecInfo codec in codecs)
        {
            if (codec.FormatID == format.Guid)
            {
                return codec;
            }
        }
        return null;
    }
}
