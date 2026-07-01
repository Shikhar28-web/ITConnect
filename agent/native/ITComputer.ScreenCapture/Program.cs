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
    private static IntPtr _currentDesktopHandle = IntPtr.Zero;
    private static string _currentDesktopName = "";

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

    // Cache of the last successfully captured frame – resent when capture fails to prevent black flickering
    static byte[]? _lastGoodFrame = null;
    // Timestamp of when the desktop last changed – used to decide when to clear the frame cache
    static DateTime _lastDesktopChangeTime = DateTime.MinValue;

    static void CaptureLoop(StreamWriter writer, CancellationToken ct)
    {
        string lastDesktopName = "";
        int failedFramesInRow = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                string desktopName = AttachToInputDesktop();
                if (desktopName != lastDesktopName)
                {
                    writer.WriteLine($"desktop:{desktopName}");
                    lastDesktopName = desktopName;
                    _lastDesktopChangeTime = DateTime.UtcNow;
                    // Clear cached frame only when returning to Default desktop so we don't show a stale secure desktop image
                    if (desktopName == "Default" || desktopName == "unknown")
                    {
                        _lastGoodFrame = null;
                    }
                    failedFramesInRow = 0;
                }

                byte[] frame = CaptureCurrentDesktop();
                if (frame != null && frame.Length > 0)
                {
                    _lastGoodFrame = frame;
                    failedFramesInRow = 0;
                    string b64 = Convert.ToBase64String(frame);
                    writer.WriteLine($"frame:{b64}");
                }
                else
                {
                    failedFramesInRow++;
                    // Re-send the last known good frame to keep the console display stable
                    // Only skip the first 2 failures (may be a genuine timeout/no-change) to avoid sending duplicate frames on a static screen
                    if (_lastGoodFrame != null && failedFramesInRow > 2)
                    {
                        string b64 = Convert.ToBase64String(_lastGoodFrame);
                        writer.WriteLine($"frame:{b64}");
                    }
                }
            }
            catch (Exception ex)
            {
                Log($"Capture loop error: {ex.Message}");
            }
            Thread.Sleep(33); // ~30 FPS for capture loop
        }
    }

    static string AttachToInputDesktop()
    {
        IntPtr hDesk = NativeMethods.OpenInputDesktop(0, false, 0x01FF);
        if (hDesk == IntPtr.Zero) return _currentDesktopName;

        try
        {
            var sb = new StringBuilder(256);
            if (NativeMethods.GetUserObjectInformation(hDesk, 2, sb, (uint)sb.Capacity, out _))
            {
                string newDeskName = sb.ToString();
                if (newDeskName != _currentDesktopName)
                {
                    if (NativeMethods.SetThreadDesktop(hDesk))
                    {
                        if (_currentDesktopHandle != IntPtr.Zero)
                        {
                            NativeMethods.CloseDesktop(_currentDesktopHandle);
                        }
                        _currentDesktopHandle = hDesk;
                        _currentDesktopName = newDeskName;
                        hDesk = IntPtr.Zero;
                    }
                }
                return _currentDesktopName;
            }
            return "unknown";
        }
        finally
        {
            if (hDesk != IntPtr.Zero)
            {
                NativeMethods.CloseDesktop(hDesk);
            }
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
        Log($"--- INPUT RECEIVED --- Packet: '{line}'");
        Log(NativeMethods.GetProcessIdentityInfo());

        var thread = new System.Threading.Thread(() =>
        {
            try
            {
                IntPtr hDesk = NativeMethods.OpenInputDesktop(0, false, 0x01FF);
                if (hDesk != IntPtr.Zero)
                {
                    var sb = new StringBuilder(256);
                    string deskName = "Unknown";
                    if (NativeMethods.GetUserObjectInformation(hDesk, 2, sb, (uint)sb.Capacity, out var needed))
                    {
                        deskName = sb.ToString();
                    }
                    Log($"OpenInputDesktop returned: {hDesk} (Name: {deskName})");

                    bool setDeskOk = NativeMethods.SetThreadDesktop(hDesk);
                    if (setDeskOk)
                    {
                        Log($"SetThreadDesktop succeeded. Thread attached to desktop: {deskName}");
                    }
                    else
                    {
                        Log($"SetThreadDesktop failed. Error: {Marshal.GetLastWin32Error()}");
                    }
                    NativeMethods.CloseDesktop(hDesk);
                }
                else
                {
                    Log($"OpenInputDesktop failed. Error: {Marshal.GetLastWin32Error()}");
                }

                NativeMethods.POINT ptBefore;
                bool getPosBefore = NativeMethods.GetCursorPos(out ptBefore);
                if (getPosBefore)
                {
                    Log($"Cursor pos BEFORE injection: X={ptBefore.x}, Y={ptBefore.y}");
                }
                else
                {
                    Log($"GetCursorPos BEFORE failed. Error: {Marshal.GetLastWin32Error()}");
                }

                ExecuteCommandInternal(line);

                NativeMethods.POINT ptAfter;
                bool getPosAfter = NativeMethods.GetCursorPos(out ptAfter);
                if (getPosAfter)
                {
                    Log($"Cursor pos AFTER injection: X={ptAfter.x}, Y={ptAfter.y}");
                }
                else
                {
                    Log($"GetCursorPos AFTER failed. Error: {Marshal.GetLastWin32Error()}");
                }
            }
            catch (Exception ex)
            {
                Log($"Injection thread failed: {ex.Message}\n{ex.StackTrace}");
            }
        });
        thread.Start();
        thread.Join(); // Block main thread until the input is injected
    }

    static void ExecuteCommandInternal(string line)
    {
        var parts = line.Split(' ');
        if (parts.Length == 0) return;

        switch (parts[0])
        {
            case "m":
                if (parts.Length >= 3)
                {
                    int x = int.Parse(parts[1]);
                    int y = int.Parse(parts[2]);
                    NativeMethods.InjectMouseMove(x, y);
                    Log($"Executing InjectMouseMove: X={x}, Y={y} (GetLastError: {Marshal.GetLastWin32Error()})");
                }
                break;
            case "c":
                if (parts.Length >= 4)
                {
                    int x = int.Parse(parts[1]);
                    int y = int.Parse(parts[2]);
                    int button = int.Parse(parts[3]);
                    NativeMethods.InjectMouseClick(x, y, button);
                    Log($"Executing InjectMouseClick: X={x}, Y={y}, Button={button} (GetLastError: {Marshal.GetLastWin32Error()})");
                }
                break;
            case "d":
                if (parts.Length >= 4)
                {
                    int x = int.Parse(parts[1]);
                    int y = int.Parse(parts[2]);
                    int button = int.Parse(parts[3]);
                    NativeMethods.InjectMouseDown(x, y, button);
                    Log($"Executing InjectMouseDown: X={x}, Y={y}, Button={button} (GetLastError: {Marshal.GetLastWin32Error()})");
                }
                break;
            case "u":
                if (parts.Length >= 4)
                {
                    int x = int.Parse(parts[1]);
                    int y = int.Parse(parts[2]);
                    int button = int.Parse(parts[3]);
                    NativeMethods.InjectMouseUp(x, y, button);
                    Log($"Executing InjectMouseUp: X={x}, Y={y}, Button={button} (GetLastError: {Marshal.GetLastWin32Error()})");
                }
                break;
            case "w":
                if (parts.Length >= 2)
                {
                    int delta = int.Parse(parts[1]);
                    NativeMethods.InjectMouseWheel(delta);
                    Log($"Executing InjectMouseWheel: Delta={delta} (GetLastError: {Marshal.GetLastWin32Error()})");
                }
                break;
            case "k":
                if (parts.Length >= 5)
                {
                    int vk = int.Parse(parts[1]);
                    bool ctrl = parts[2] == "1";
                    bool alt = parts[3] == "1";
                    bool shift = parts[4] == "1";
                    NativeMethods.InjectRawKey(vk, ctrl, alt, shift);
                    Log($"Executing InjectRawKey: VK={vk}, Ctrl={ctrl}, Alt={alt}, Shift={shift} (GetLastError: {Marshal.GetLastWin32Error()})");
                }
                else if (line.Length > 2)
                {
                    string keys = line.Substring(2);
                    NativeMethods.InjectKey(keys);
                    Log($"Executing InjectKey: Keys='{keys}' (GetLastError: {Marshal.GetLastWin32Error()})");
                }
                break;
        }
    }

    private static readonly object LogLock = new object();
    static void Log(string msg)
    {
        lock (LogLock)
        {
            try
            {
                File.AppendAllText("C:\\Users\\Public\\itc_capture.log", $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {msg}\r\n");
            }
            catch { }
        }
    }
}
