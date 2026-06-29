using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;

namespace ITComputer.WindowsService;

public class ScreenCaptureLauncher
{
    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(uint SessionId, out IntPtr Token);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUser(
        IntPtr hToken,
        string? lpApplicationName,
        string? lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    private readonly ILogger _logger;
    private Process? _captureProcess;
    private readonly object _processLock = new();

    public ScreenCaptureLauncher(ILogger logger)
    {
        _logger = logger;
    }

    public void LaunchInSession(int sessionId, string desktopName = "winsta0\\default")
    {
        lock (_processLock)
        {
            if (_captureProcess != null)
            {
                try
                {
                    if (!_captureProcess.HasExited)
                    {
                        _captureProcess.Kill();
                        _logger.LogInformation("Killed existing screen capture process before relaunching.");
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning($"Failed to kill existing capture process: {ex.Message}");
                }
                _captureProcess = null;
            }

            try
            {
                if (!WTSQueryUserToken((uint)sessionId, out var token))
                {
                    _logger.LogWarning($"WTSQueryUserToken failed for session {sessionId}. This is expected if no user is logged on.");
                    return;
                }

                var baseDir = AppContext.BaseDirectory;
                // Look in the same folder as the service first
                var exePath = System.IO.Path.Combine(baseDir, "ITComputer.ScreenCapture.exe");
                if (!System.IO.File.Exists(exePath))
                {
                    // Fallback to native project release folder
                    exePath = System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, "../../../native/ITComputer.ScreenCapture/bin/Release/net10.0-windows/win-x64/ITComputer.ScreenCapture.exe"));
                }

                if (!System.IO.File.Exists(exePath))
                {
                    _logger.LogError($"Could not find ITComputer.ScreenCapture.exe at {exePath}");
                    CloseHandle(token);
                    return;
                }

                var si = new STARTUPINFO
                {
                    cb = Marshal.SizeOf<STARTUPINFO>(),
                    lpDesktop = desktopName
                };

                _logger.LogInformation($"Launching capture exe in session {sessionId}: {exePath}");
                bool ok = CreateProcessAsUser(
                    token,
                    exePath,
                    $"\"{exePath}\" 59300",
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    0,
                    IntPtr.Zero,
                    null,
                    ref si,
                    out var pi);

                CloseHandle(token);

                if (ok)
                {
                    _logger.LogInformation($"Screen capture launched in session {sessionId} (PID {pi.dwProcessId})");
                    _captureProcess = Process.GetProcessById((int)pi.dwProcessId);
                    CloseHandle(pi.hProcess);
                    CloseHandle(pi.hThread);
                }
                else
                {
                    _logger.LogError($"CreateProcessAsUser failed. Error code: {Marshal.GetLastWin32Error()}");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError($"LaunchInSession failed: {ex.Message}");
            }
        }
    }
}
