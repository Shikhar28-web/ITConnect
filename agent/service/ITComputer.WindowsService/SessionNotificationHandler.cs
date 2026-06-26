using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace ITComputer.WindowsService;

public class SessionNotificationHandler
{
    public event Action<WTS_SESSION_EVENTS, int>? OnSessionChanged;
    private readonly ILogger _logger;
    private IntPtr _hwnd = IntPtr.Zero;
    private WndProcDelegate? _wndProc;

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSRegisterSessionNotification(IntPtr hWnd, uint dwFlags);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSUnRegisterSessionNotification(IntPtr hWnd);

    private const uint NOTIFY_FOR_ALL_SESSIONS = 1;
    private const int WM_WTSSESSION_CHANGE = 0x02B1;
    private static readonly IntPtr HWND_MESSAGE = new IntPtr(-3);

    // Win32 Message window creation imports
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEX
    {
        public int cbSize;
        public int style;
        public WndProcDelegate lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassEx(ref WNDCLASSEX lpwcx);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowEx(
        int dwExStyle,
        string lpClassName,
        string lpWindowName,
        int dwStyle,
        int x, int y, int nWidth, int nHeight,
        IntPtr hWndParent,
        IntPtr hMenu,
        IntPtr hInstance,
        IntPtr lpParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpmsg);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x, y;
    }

    public SessionNotificationHandler(ILogger logger)
    {
        _logger = logger;
    }

    public Task StartAsync(CancellationToken ct)
    {
        return Task.Run(() => MessageLoop(ct), ct);
    }

    private void MessageLoop(CancellationToken ct)
    {
        try
        {
            _wndProc = CustomWndProc;
            var hInstance = GetModuleHandle(null);
            var className = "ITComputerServiceMessageWindow";

            var wc = new WNDCLASSEX
            {
                cbSize = Marshal.SizeOf<WNDCLASSEX>(),
                style = 0,
                lpfnWndProc = _wndProc,
                cbClsExtra = 0,
                cbWndExtra = 0,
                hInstance = hInstance,
                hIcon = IntPtr.Zero,
                hCursor = IntPtr.Zero,
                hbrBackground = IntPtr.Zero,
                lpszMenuName = "",
                lpszClassName = className,
                hIconSm = IntPtr.Zero
            };

            RegisterClassEx(ref wc);

            _hwnd = CreateWindowEx(
                0,
                className,
                "ITComputerServiceMessageWindow",
                0,
                0, 0, 0, 0,
                HWND_MESSAGE,
                IntPtr.Zero,
                hInstance,
                IntPtr.Zero
            );

            if (_hwnd == IntPtr.Zero)
            {
                _logger.LogError($"CreateWindowEx failed. Error code: {Marshal.GetLastWin32Error()}");
                return;
            }

            if (!WTSRegisterSessionNotification(_hwnd, NOTIFY_FOR_ALL_SESSIONS))
            {
                _logger.LogError($"WTSRegisterSessionNotification failed. Error code: {Marshal.GetLastWin32Error()}");
                return;
            }

            _logger.LogInformation("WTS Session change notifications registered successfully.");

            MSG msg;
            while (!ct.IsCancellationRequested && GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError($"SessionNotificationHandler loop error: {ex.Message}");
        }
        finally
        {
            if (_hwnd != IntPtr.Zero)
            {
                WTSUnRegisterSessionNotification(_hwnd);
                DestroyWindow(_hwnd);
                _hwnd = IntPtr.Zero;
            }
        }
    }

    private IntPtr CustomWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_WTSSESSION_CHANGE)
        {
            var eventId = (WTS_SESSION_EVENTS)(int)wParam;
            var sessionId = (int)lParam;
            _logger.LogInformation($"WTS Session change callback: {eventId} session={sessionId}");
            OnSessionChanged?.Invoke(eventId, sessionId);
        }
        return DefWindowProc(hWnd, msg, wParam, lParam);
    }
}

public enum WTS_SESSION_EVENTS
{
    WTS_CONSOLE_CONNECT = 1,
    WTS_CONSOLE_DISCONNECT = 2,
    WTS_REMOTE_CONNECT = 3,
    WTS_REMOTE_DISCONNECT = 4,
    WTS_SESSION_LOGON = 5,
    WTS_SESSION_LOGOFF = 6,
    WTS_SESSION_LOCK = 7,
    WTS_SESSION_UNLOCK = 8,
    WTS_SESSION_REMOTE_CONTROL = 9,
}
