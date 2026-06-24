# system_worker.ps1
# A persistent background worker running as SYSTEM that listens on a local TCP port.

$port = 49152
$currentPid = $PID

# Clean up any existing instances of this worker script
try {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessId -ne $currentPid -and $_.CommandLine -like "*system_worker.ps1*"
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {
    # Fallback to WMI if CIM is not available (older Windows versions)
    Get-WmiObject Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessId -ne $currentPid -and $_.CommandLine -like "*system_worker.ps1*"
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Milliseconds 500

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
try {
    $listener.Start()
} catch {
    # If the port is in use, exit as another instance is active
    exit
}

# Compile Win32 Helper for Desktop Switch and Inputs
$source = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class Win32Helper {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, uint dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool BlockInput(bool fBlockIt);

    [DllImport("sas.dll", SetLastError = true)]
    public static extern void SendSAS(bool asUser);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;

    private const uint DESKTOP_WRITEOBJECTS = 0x0080;
    private const uint DESKTOP_READOBJECTS = 0x0001;
    private const uint DESKTOP_CREATEMENU = 0x0004;
    private const uint DESKTOP_HOOKCONTROL = 0x0008;
    private const uint DESKTOP_JOURNALRECORD = 0x0010;
    private const uint DESKTOP_JOURNALPLAYBACK = 0x0020;
    private const uint DESKTOP_ENUMERATE = 0x0040;
    private const uint DESKTOP_SWITCHDESKTOP = 0x0100;

    private const uint ALL_ACCESS = DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | DESKTOP_CREATEMENU | 
                                    DESKTOP_HOOKCONTROL | DESKTOP_JOURNALRECORD | DESKTOP_JOURNALPLAYBACK | 
                                    DESKTOP_ENUMERATE | DESKTOP_SWITCHDESKTOP;

    public static void ExecuteOnInputDesktop(Action action) {
        Thread t = new Thread(() => {
            IntPtr hInput = OpenInputDesktop(0, false, ALL_ACCESS);
            if (hInput != IntPtr.Zero) {
                if (SetThreadDesktop(hInput)) {
                    try {
                        action();
                    } catch {}
                }
                CloseDesktop(hInput);
            } else {
                try { action(); } catch {}
            }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
    }
}
"@

Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing, System.Windows.Forms

while ($true) {
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $writer = New-Object System.IO.StreamWriter($stream)
        $writer.AutoFlush = $true

        while ($client.Connected -and ($line = $reader.ReadLine())) {
            $line = $line.Trim()
            if ($line -eq "") { continue }
            
            $parts = $line.Split(' ')
            $cmd = $parts[0]

            [Win32Helper]::ExecuteOnInputDesktop({
                if ($cmd -eq "m") {
                    [Win32Helper]::SetCursorPos([int]$parts[1], [int]$parts[2])
                }
                elseif ($cmd -eq "c") {
                    [Win32Helper]::SetCursorPos([int]$parts[1], [int]$parts[2])
                    $down = [Win32Helper]::MOUSEEVENTF_LEFTDOWN
                    $up = [Win32Helper]::MOUSEEVENTF_LEFTUP
                    if ([int]$parts[3] -eq 2) {
                        $down = [Win32Helper]::MOUSEEVENTF_RIGHTDOWN
                        $up = [Win32Helper]::MOUSEEVENTF_RIGHTUP
                    } elseif ([int]$parts[3] -eq 1) {
                        $down = [Win32Helper]::MOUSEEVENTF_MIDDLEDOWN
                        $up = [Win32Helper]::MOUSEEVENTF_MIDDLEUP
                    }
                    [Win32Helper]::mouse_event($down, 0, 0, 0, 0)
                    [System.Threading.Thread]::Sleep(15)
                    [Win32Helper]::mouse_event($up, 0, 0, 0, 0)
                }
                elseif ($cmd -eq "d") {
                    [Win32Helper]::SetCursorPos([int]$parts[1], [int]$parts[2])
                    $flag = [Win32Helper]::MOUSEEVENTF_LEFTDOWN
                    if ([int]$parts[3] -eq 2) { $flag = [Win32Helper]::MOUSEEVENTF_RIGHTDOWN }
                    elseif ([int]$parts[3] -eq 1) { $flag = [Win32Helper]::MOUSEEVENTF_MIDDLEDOWN }
                    [Win32Helper]::mouse_event($flag, 0, 0, 0, 0)
                }
                elseif ($cmd -eq "u") {
                    [Win32Helper]::SetCursorPos([int]$parts[1], [int]$parts[2])
                    $flag = [Win32Helper]::MOUSEEVENTF_LEFTUP
                    if ([int]$parts[3] -eq 2) { $flag = [Win32Helper]::MOUSEEVENTF_RIGHTUP }
                    elseif ([int]$parts[3] -eq 1) { $flag = [Win32Helper]::MOUSEEVENTF_MIDDLEUP }
                    [Win32Helper]::mouse_event($flag, 0, 0, 0, 0)
                }
                elseif ($cmd -eq "w") {
                    [Win32Helper]::mouse_event([Win32Helper]::MOUSEEVENTF_WHEEL, 0, 0, [uint]$parts[1], 0)
                }
                elseif ($cmd -eq "b") {
                    [Win32Helper]::BlockInput([int]$parts[1] -eq 1)
                }
                elseif ($cmd -eq "k") {
                    $keyStr = $line.Substring(2)
                    [System.Windows.Forms.SendKeys]::SendWait($keyStr)
                }
                elseif ($cmd -eq "cad") {
                    [Win32Helper]::SendSAS($false)
                }
                elseif ($cmd -eq "capture") {
                    $path = $line.Substring(8)
                    
                    $outDir = [System.IO.Path]::GetDirectoryName($path)
                    if (-not [System.IO.Directory]::Exists($outDir)) {
                        [System.IO.Directory]::CreateDirectory($outDir) | Out-Null
                    }

                    $width = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
                    $height = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height
                    $bmp = New-Object System.Drawing.Bitmap($width, $height)
                    $g = [System.Drawing.Graphics]::FromImage($bmp)
                    $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
                    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
                    $g.Dispose()
                    $bmp.Dispose()
                }
            })
        }
        $client.Close()
    } catch {
        Start-Sleep -Seconds 1
    }
}
