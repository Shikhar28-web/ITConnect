using System;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.Text;
using System.Threading;

namespace ITComputer.ScreenCapture;

class Program
{
    static int Port = 59300;

    static void Main(string[] args)
    {
        if (args.Length > 0 && int.TryParse(args[0], out var p)) Port = p;

        while (true)
        {
            try
            {
                RunSession();
            }
            catch (Exception ex)
            {
                Log($"Session crashed: {ex.Message}");
            }
            Thread.Sleep(5000);
        }
    }

    static void RunSession()
    {
        using var client = new TcpClient("127.0.0.1", Port);
        using var ns = client.GetStream();
        using var reader = new StreamReader(ns, Encoding.UTF8);
        using var writer = new StreamWriter(ns, Encoding.UTF8) { AutoFlush = true };

        Log("Connected to Electron TCP server");

        // Start capture loop in background
        var cts = new CancellationTokenSource();
        var captureThread = new Thread(() => CaptureLoop(writer, cts.Token)) { IsBackground = true };
        captureThread.Start();

        // Read input commands in foreground
        try
        {
            string? line;
            while ((line = reader.ReadLine()) != null)
            {
                ProcessInputCommand(line);
            }
        }
        finally
        {
            cts.Cancel();
            captureThread.Join(2000);
        }
    }

    static void CaptureLoop(StreamWriter writer, CancellationToken ct)
    {
        string lastDesktopName = "";
        while (!ct.IsCancellationRequested)
        {
            try
            {
                string desktopName = GetActiveDesktopName();
                if (desktopName != lastDesktopName)
                {
                    writer.WriteLine($"desktop:{desktopName}");
                    lastDesktopName = desktopName;
                }

                byte[] frame = CaptureCurrentDesktop();
                if (frame != null && frame.Length > 0)
                {
                    string b64 = Convert.ToBase64String(frame);
                    writer.WriteLine($"frame:{b64}");
                }
            }
            catch (Exception ex)
            {
                Log($"Capture loop error: {ex.Message}");
            }
            Thread.Sleep(33); // ~30 FPS for capture loop
        }
    }

    static string GetActiveDesktopName()
    {
        IntPtr hDesk = NativeMethods.OpenInputDesktop(0, false, 0x0181);
        if (hDesk == IntPtr.Zero) return "unknown";
        try
        {
            var sb = new StringBuilder(256);
            uint needed;
            if (NativeMethods.GetUserObjectInformation(hDesk, 2, sb, (uint)sb.Capacity, out needed))
            {
                NativeMethods.SetThreadDesktop(hDesk);
                return sb.ToString();
            }
            return "unknown";
        }
        finally
        {
            NativeMethods.CloseDesktop(hDesk);
        }
    }

    static byte[] CaptureCurrentDesktop()
    {
        // Try DXGI first (GPU, fast, captures all desktops)
        var dxgi = DxgiCapture.TryCapture();
        if (dxgi != null) return dxgi;

        // Fallback to GDI BitBlt
        return GdiCapture.Capture();
    }

    static void ProcessInputCommand(string line)
    {
        try
        {
            // Switch thread desktop before injecting input
            IntPtr hDesk = NativeMethods.OpenInputDesktop(0, false, 0x0181);
            if (hDesk != IntPtr.Zero)
            {
                NativeMethods.SetThreadDesktop(hDesk);
                NativeMethods.CloseDesktop(hDesk);
            }

            var parts = line.Split(' ');
            if (parts.Length == 0) return;

            switch (parts[0])
            {
                case "m":
                    if (parts.Length >= 3)
                        NativeMethods.SendMouseMoveAbsolute(int.Parse(parts[1]), int.Parse(parts[2]));
                    break;
                case "c":
                    if (parts.Length >= 4)
                        NativeMethods.InjectMouseClick(int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]));
                    break;
                case "d":
                    if (parts.Length >= 4)
                        NativeMethods.InjectMouseDown(int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]));
                    break;
                case "u":
                    if (parts.Length >= 4)
                        NativeMethods.InjectMouseUp(int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]));
                    break;
                case "w":
                    if (parts.Length >= 2)
                        NativeMethods.InjectMouseWheel(int.Parse(parts[1]));
                    break;
                case "k":
                    if (line.Length > 2)
                        NativeMethods.InjectKey(line.Substring(2));
                    break;
            }
        }
        catch (Exception ex)
        {
            Log($"Process input command failed: {ex.Message} for line: {line}");
        }
    }

    static void Log(string msg) => File.AppendAllText("C:\\Users\\Public\\itc_capture.log", $"[{DateTime.Now}] {msg}\n");
}
