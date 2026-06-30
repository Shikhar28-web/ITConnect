using System;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.Text;
using System.Threading;
using System.Windows.Forms;

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

                    if (BlackoutWindow.IsActive)
                    {
                        Log($"[Desktop Transition] Active desktop changed to {desktopName} while blackout is enabled. Recreating blackout window...");
                        BlackoutWindow.HideBlackout();
                        BlackoutWindow.ShowBlackout();
                    }
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
        IntPtr hDesk = NativeMethods.OpenInputDesktop(0, false, 0x01FF);
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
        Log($"--- INPUT RECEIVED --- Packet: '{line}'");
        Log(NativeMethods.GetProcessIdentityInfo());

        var thread = new System.Threading.Thread(() =>
        {
            IntPtr hDesk = IntPtr.Zero;
            try
            {
                hDesk = NativeMethods.OpenInputDesktop(0, false, 0x01FF);
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
            finally
            {
                if (hDesk != IntPtr.Zero)
                {
                    NativeMethods.CloseDesktop(hDesk);
                }
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
            case "b":
                if (parts.Length >= 2)
                {
                    bool enable = parts[1] == "1";
                    Log($"Executing SetBlackout: {enable} (GetLastError: {Marshal.GetLastWin32Error()})");
                    if (enable)
                    {
                        BlackoutWindow.ShowBlackout();
                    }
                    else
                    {
                        BlackoutWindow.HideBlackout();
                    }
                }
                break;
        }
    }

    private static readonly object LogLock = new object();
    public static void Log(string msg)
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

public class BlackoutWindow
{
    private static BlackoutForm? _blackoutForm;
    private static Thread? _windowThread;
    public static bool IsActive { get; private set; }

    public static void ShowBlackout()
    {
        IsActive = true;
        if (_blackoutForm != null) return;

        _windowThread = new Thread(() =>
        {
            try
            {
                Program.Log("[Blackout] Starting blackout window thread...");
                
                // Attach thread to active input desktop
                IntPtr hDesk = NativeMethods.OpenInputDesktop(0, false, 0x01FF);
                if (hDesk != IntPtr.Zero)
                {
                    bool ok = NativeMethods.SetThreadDesktop(hDesk);
                    Program.Log($"[Blackout] SetThreadDesktop on input desktop: {ok}");
                    NativeMethods.CloseDesktop(hDesk);
                }

                _blackoutForm = new BlackoutForm
                {
                    BackColor = Color.Black,
                    FormBorderStyle = FormBorderStyle.None,
                    WindowState = FormWindowState.Maximized,
                    TopMost = true,
                    ShowInTaskbar = false,
                    StartPosition = FormStartPosition.Manual
                };

                // Cover virtual screen bounds (all monitors)
                var bounds = SystemInformation.VirtualScreen;
                _blackoutForm.Bounds = bounds;

                _blackoutForm.Load += (s, e) =>
                {
                    // Exclude from capture so admin can see through the blackout window
                    bool affOk = NativeMethods.SetWindowDisplayAffinity(_blackoutForm.Handle, 0x00000011); // WDA_EXCLUDEFROMCAPTURE
                    Program.Log($"[Blackout] SetWindowDisplayAffinity returned: {affOk}");
                };

                var label = new Label
                {
                    Text = "Windows",
                    Font = new Font("Segoe UI", 48, FontStyle.Bold),
                    ForeColor = Color.White,
                    AutoSize = true,
                };
                _blackoutForm.Controls.Add(label);

                var timer = new System.Windows.Forms.Timer { Interval = 16 };
                int x = 80, y = 80;
                int vx = 3, vy = 2;
                Color[] colors = { Color.White, Color.DeepSkyBlue, Color.MediumPurple, Color.Cyan, Color.Pink, Color.LightGreen };
                int colorIndex = 0;

                timer.Tick += (sender, args) =>
                {
                    if (_blackoutForm == null || _blackoutForm.IsDisposed) return;
                    x += vx;
                    y += vy;

                    bool bounced = false;
                    if (x + label.Width >= _blackoutForm.Width) { x = _blackoutForm.Width - label.Width; vx = -Math.Abs(vx); bounced = true; }
                    if (x <= 0) { x = 0; vx = Math.Abs(vx); bounced = true; }
                    if (y + label.Height >= _blackoutForm.Height) { y = _blackoutForm.Height - label.Height; vy = -Math.Abs(vy); bounced = true; }
                    if (y <= 0) { y = 0; vy = Math.Abs(vy); bounced = true; }

                    if (bounced)
                    {
                        colorIndex = (colorIndex + 1) % colors.Length;
                        label.ForeColor = colors[colorIndex];
                    }

                    label.Left = x;
                    label.Top = y;
                };
                timer.Start();

                Program.Log("[Blackout] Running form message loop...");
                Application.Run(_blackoutForm);
            }
            catch (Exception ex)
            {
                Program.Log($"[Blackout] Window thread failed: {ex.Message}");
            }
        })
        { IsBackground = true };
        _windowThread.Start();
    }

    public static void HideBlackout()
    {
        IsActive = false;
        if (_blackoutForm != null)
        {
            try
            {
                Program.Log("[Blackout] Closing blackout form...");
                _blackoutForm.Invoke(new Action(() =>
                {
                    _blackoutForm.Close();
                    _blackoutForm.Dispose();
                }));
            }
            catch (Exception ex)
            {
                Program.Log($"[Blackout] Failed to close form programmatically: {ex.Message}");
            }
            _blackoutForm = null;
        }
        _windowThread = null;
    }
}

public class BlackoutForm : Form
{
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            // WS_EX_TRANSPARENT = 0x20 (Click-through)
            // WS_EX_NOACTIVATE = 0x08000000 (No focus activation)
            // WS_EX_TOPMOST = 0x8
            // WS_EX_LAYERED = 0x80000 (Required for click-through to work)
            cp.ExStyle |= 0x20 | 0x08000000 | 0x8 | 0x80000;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation
    {
        get { return true; }
    }
}
