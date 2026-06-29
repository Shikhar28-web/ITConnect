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

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

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

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool LookupPrivilegeValue(string? lpSystemName, string lpName, out LUID lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool AdjustTokenPrivileges(
        IntPtr TokenHandle,
        bool DisableAllPrivileges,
        ref TOKEN_PRIVILEGES NewState,
        uint BufferLength,
        IntPtr PreviousState,
        IntPtr ReturnLength);

    [StructLayout(LayoutKind.Sequential)]
    private struct LUID
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_PRIVILEGES
    {
        public uint PrivilegeCount;
        public LUID Luid;
        public uint Attributes;
    }

    private readonly ILogger _logger;
    private Process? _captureProcess;
    private readonly object _processLock = new();

    public ScreenCaptureLauncher(ILogger logger)
    {
        _logger = logger;
    }

    private bool EnableDebugPrivilege()
    {
        IntPtr hToken = IntPtr.Zero;
        try
        {
            Process currentProcess = Process.GetCurrentProcess();
            if (!OpenProcessToken(currentProcess.Handle, 0x0020 | 0x0008, out hToken)) // TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY
            {
                return false;
            }

            LUID luid;
            if (!LookupPrivilegeValue(null, "SeDebugPrivilege", out luid))
            {
                return false;
            }

            TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
            tp.PrivilegeCount = 1;
            tp.Luid = luid;
            tp.Attributes = 0x00000002; // SE_PRIVILEGE_ENABLED

            if (!AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero))
            {
                return false;
            }

            return Marshal.GetLastWin32Error() != 1443; // ERROR_NOT_ALL_ASSIGNED
        }
        catch
        {
            return false;
        }
        finally
        {
            if (hToken != IntPtr.Zero)
            {
                CloseHandle(hToken);
            }
        }
    }

    private IntPtr GetSystemTokenForSession(int sessionId)
    {
        bool privEnabled = EnableDebugPrivilege();
        _logger.LogInformation($"SeDebugPrivilege enablement status: {privEnabled}");

        var processes = Process.GetProcessesByName("winlogon");
        foreach (var p in processes)
        {
            if (p.SessionId == sessionId)
            {
                IntPtr hProcess = OpenProcess(0x0400 | 0x1000, false, p.Id); // PROCESS_QUERY_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION
                if (hProcess == IntPtr.Zero)
                {
                    // Try with standard access if full query info fails
                    hProcess = OpenProcess(0x0400, false, p.Id);
                }

                if (hProcess != IntPtr.Zero)
                {
                    if (OpenProcessToken(hProcess, 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0020, out var hToken)) // TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY
                    {
                        CloseHandle(hProcess);
                        IntPtr duplicatedToken = IntPtr.Zero;
                        if (DuplicateTokenEx(hToken, 0xf01ff, IntPtr.Zero, 2, 1, out duplicatedToken)) // TOKEN_ALL_ACCESS, SecurityImpersonation, TokenPrimary
                        {
                            CloseHandle(hToken);
                            return duplicatedToken;
                        }
                        _logger.LogWarning($"DuplicateTokenEx failed. Error: {Marshal.GetLastWin32Error()}");
                        CloseHandle(hToken);
                    }
                    else
                    {
                        _logger.LogWarning($"OpenProcessToken failed for winlogon in session {sessionId}. Error: {Marshal.GetLastWin32Error()}");
                        CloseHandle(hProcess);
                    }
                }
                else
                {
                    _logger.LogWarning($"OpenProcess failed for winlogon PID {p.Id} in session {sessionId}. Error: {Marshal.GetLastWin32Error()}");
                }
            }
        }
        return IntPtr.Zero;
    }

    public void LaunchInSession(int sessionId)
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
                IntPtr token = GetSystemTokenForSession(sessionId);
                bool isSystem = token != IntPtr.Zero;

                if (!isSystem)
                {
                    _logger.LogWarning($"Failed to get SYSTEM token for session {sessionId}. Falling back to WTSQueryUserToken...");
                    if (!WTSQueryUserToken((uint)sessionId, out token))
                    {
                        _logger.LogWarning($"WTSQueryUserToken failed for session {sessionId}. This is expected if no user is logged on.");
                        return;
                    }
                }
                else
                {
                    _logger.LogInformation($"Successfully retrieved SYSTEM token from winlogon for session {sessionId}");
                }

                var baseDir = AppContext.BaseDirectory;
                // Look in the same folder as the service first
                var exePath = System.IO.Path.Combine(baseDir, "ITComputer.ScreenCapture.exe");
                if (!System.IO.File.Exists(exePath))
                {
                    // Try the publish folder first
                    exePath = System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, "../../../native/ITComputer.ScreenCapture/bin/Release/net10.0-windows/win-x64/publish/ITComputer.ScreenCapture.exe"));
                }
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
                    lpDesktop = "winsta0\\default"
                };

                _logger.LogInformation($"Launching capture exe in session {sessionId} (as {(isSystem ? "SYSTEM" : "USER")}): {exePath}");
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
