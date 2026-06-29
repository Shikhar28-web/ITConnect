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
    private static extern bool CreateProcessWithTokenW(
        IntPtr hToken,
        uint dwLogonFlags,
        string? lpApplicationName,
        string? lpCommandLine,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, int processId);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(
        IntPtr hExistingToken,
        uint dwDesiredAccess,
        IntPtr lpTokenAttributes,
        int ImpersonationLevel,
        int TokenType,
        out IntPtr phNewToken);

    private const uint PROCESS_QUERY_INFORMATION = 0x0400;
    private const uint TOKEN_DUPLICATE = 0x0002;
    private const uint TOKEN_QUERY = 0x0008;
    private const uint TOKEN_ASSIGN_PRIMARY = 0x0001;

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

    private IntPtr GetSessionSystemToken(int sessionId)
    {
        var processes = Process.GetProcessesByName("winlogon");
        foreach (var p in processes)
        {
            if (p.SessionId == sessionId)
            {
                IntPtr hProcess = OpenProcess(PROCESS_QUERY_INFORMATION, false, p.Id);
                if (hProcess != IntPtr.Zero)
                {
                    if (OpenProcessToken(hProcess, TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY, out var hToken))
                    {
                        if (DuplicateTokenEx(hToken, 0xF01FF /* TOKEN_ALL_ACCESS */, IntPtr.Zero, 2 /* SecurityImpersonation */, 1 /* TokenPrimary */, out var hNewToken))
                        {
                            CloseHandle(hToken);
                            CloseHandle(hProcess);
                            return hNewToken;
                        }
                        CloseHandle(hToken);
                    }
                    CloseHandle(hProcess);
                }
            }
        }
        return IntPtr.Zero;
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

            IntPtr token = IntPtr.Zero;
            try
            {
                if (desktopName.Contains("Winlogon", StringComparison.OrdinalIgnoreCase))
                {
                    token = GetSessionSystemToken(sessionId);
                    if (token == IntPtr.Zero)
                    {
                        _logger.LogWarning($"Failed to get SYSTEM token from winlogon process for session {sessionId}.");
                        return;
                    }
                }
                else
                {
                    if (!WTSQueryUserToken((uint)sessionId, out token))
                    {
                        _logger.LogWarning($"WTSQueryUserToken failed for session {sessionId}. This is expected if no user is logged on.");
                        return;
                    }
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
                    return;
                }

                var si = new STARTUPINFO
                {
                    cb = Marshal.SizeOf<STARTUPINFO>(),
                    lpDesktop = desktopName
                };

                _logger.LogInformation($"Launching capture exe in session {sessionId} on desktop {desktopName}: {exePath}");
                bool ok = CreateProcessWithTokenW(
                    token,
                    0, // dwLogonFlags
                    exePath,
                    $"\"{exePath}\" 59300",
                    0, // dwCreationFlags
                    IntPtr.Zero,
                    null,
                    ref si,
                    out var pi);

                if (ok)
                {
                    _logger.LogInformation($"Screen capture launched in session {sessionId} (PID {pi.dwProcessId})");
                    _captureProcess = Process.GetProcessById((int)pi.dwProcessId);
                    CloseHandle(pi.hProcess);
                    CloseHandle(pi.hThread);
                }
                else
                {
                    _logger.LogError($"CreateProcessWithTokenW failed. Error code: {Marshal.GetLastWin32Error()}");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError($"LaunchInSession failed: {ex.Message}");
            }
            finally
            {
                if (token != IntPtr.Zero)
                {
                    CloseHandle(token);
                }
            }
        }
    }
}
