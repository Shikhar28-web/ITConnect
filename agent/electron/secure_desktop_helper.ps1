param(
    [int]$Port = 59300
)

# Logging function
function Log-Message {
    param([string]$Message)
    try {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -Path "C:\Users\Public\secure_desktop_debug.log" -Value "[$timestamp] $Message"
    } catch {}
}

# Clean old log
try {
    Remove-Item "C:\Users\Public\secure_desktop_debug.log" -ErrorAction SilentlyContinue
} catch {}

Log-Message "Helper script started. Port: $Port"

# Load assemblies for PowerShell runspace
try {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    Log-Message "Loaded System.Drawing and System.Windows.Forms"
} catch {
    Log-Message "Error loading assemblies: $_"
}

# Add C# helper class for Win32 API interactions with explicit assembly references for compilation
try {
    Add-Type -ReferencedAssemblies "System.Drawing", "System.Windows.Forms" -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

public class Win32 {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, [Out] StringBuilder pvInfo, uint nLength, out uint lpnLengthNeeded);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowDC(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, uint dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool BlockInput(bool fBlockIt);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;

    private const int SRCCOPY = 0x00CC0020;
    private const int CAPTUREBLT = 0x40000000;

    public static string GetActiveDesktopName(ref bool canSwitch) {
        canSwitch = false;
        IntPtr hDesktop = OpenInputDesktop(0, false, 0x0181); // DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | DESKTOP_SWITCHDESKTOP
        if (hDesktop == IntPtr.Zero) return "unknown";

        StringBuilder sb = new StringBuilder(256);
        uint needed;
        string name = "unknown";
        if (GetUserObjectInformation(hDesktop, 2, sb, (uint)sb.Capacity, out needed)) {
            name = sb.ToString();
        }

        canSwitch = SetThreadDesktop(hDesktop);
        CloseDesktop(hDesktop);
        return name;
    }

    public static byte[] CaptureScreen(int width, int height, long quality) {
        IntPtr hDesktop = OpenInputDesktop(0, false, 0x0181);
        if (hDesktop != IntPtr.Zero) {
            SetThreadDesktop(hDesktop);
            CloseDesktop(hDesktop);
        }

        IntPtr hwnd = GetDesktopWindow();
        IntPtr hdcSrc = GetWindowDC(hwnd);

        using (Bitmap bmp = new Bitmap(width, height)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                IntPtr hdcDest = g.GetHdc();
                BitBlt(hdcDest, 0, 0, width, height, hdcSrc, 0, 0, SRCCOPY | CAPTUREBLT);
                g.ReleaseHdc(hdcDest);
            }
            ReleaseDC(hwnd, hdcSrc);

            using (MemoryStream ms = new MemoryStream()) {
                ImageCodecInfo jpgEncoder = GetEncoder(ImageFormat.Jpeg);
                if (jpgEncoder == null) return new byte[0];
                System.Drawing.Imaging.Encoder myEncoder = System.Drawing.Imaging.Encoder.Quality;
                EncoderParameters myEncoderParameters = new EncoderParameters(1);
                EncoderParameter myEncoderParameter = new EncoderParameter(myEncoder, quality);
                myEncoderParameters.Param[0] = myEncoderParameter;

                bmp.Save(ms, jpgEncoder, myEncoderParameters);
                return ms.ToArray();
            }
        }
    }

    private static ImageCodecInfo GetEncoder(ImageFormat format) {
        ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
        foreach (ImageCodecInfo codec in codecs) {
            if (codec.FormatID == format.Guid) {
                return codec;
            }
        }
        return null;
    }

    public static void Move(int x, int y) {
        SetCursorPos(x, y);
    }

    public static void Click(int x, int y, int button) {
        SetCursorPos(x, y);
        uint down = MOUSEEVENTF_LEFTDOWN;
        uint up = MOUSEEVENTF_LEFTUP;
        if (button == 2) {
            down = MOUSEEVENTF_RIGHTDOWN;
            up = MOUSEEVENTF_RIGHTUP;
        } else if (button == 1) {
            down = MOUSEEVENTF_MIDDLEDOWN;
            up = MOUSEEVENTF_MIDDLEUP;
        }
        mouse_event(down, 0, 0, 0, 0);
        System.Threading.Thread.Sleep(15);
        mouse_event(up, 0, 0, 0, 0);
    }

    public static void MouseDown(int x, int y, int button) {
        SetCursorPos(x, y);
        uint flag = MOUSEEVENTF_LEFTDOWN;
        if (button == 2) flag = MOUSEEVENTF_RIGHTDOWN;
        else if (button == 1) flag = MOUSEEVENTF_MIDDLEDOWN;
        mouse_event(flag, 0, 0, 0, 0);
    }

    public static void MouseUp(int x, int y, int button) {
        SetCursorPos(x, y);
        uint flag = MOUSEEVENTF_LEFTUP;
        if (button == 2) flag = MOUSEEVENTF_RIGHTUP;
        else if (button == 1) flag = MOUSEEVENTF_MIDDLEUP;
        mouse_event(flag, 0, 0, 0, 0);
    }

    public static void MouseWheel(int delta) {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, 0);
    }
}
"@
    Log-Message "Win32 C# type added successfully"
} catch {
    Log-Message "Error adding Win32 C# type: $_"
}

# Connect to the Electron TCP server in a robust retry loop
while ($true) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        Log-Message "Connecting to 127.0.0.1:$Port"
        $client.Connect("127.0.0.1", $Port)
        Log-Message "Connected to TCP server successfully"
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $writer = New-Object System.IO.StreamWriter($stream)
        $writer.AutoFlush = $true

        # Get primary screen size
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        $width = $screen.Bounds.Width
        $height = $screen.Bounds.Height
        Log-Message "Primary screen bounds: Width=$width, Height=$height"

        # Start main loop
        while ($client.Connected) {
            try {
                # 1. Non-blocking input reading from socket
                while ($stream.DataAvailable) {
                    $line = $reader.ReadLine()
                    if ($line) {
                        Log-Message "Received input command: $line"
                        # Ensure the calling thread switches to the input desktop before executing injection
                        $canSwitch = $false
                        [Win32]::GetActiveDesktopName([ref]$canSwitch)

                        $parts = $line.Split(' ')
                        if ($parts[0] -eq 'm') {
                            $rx = [Math]::Round(([int]$parts[1] / 10000.0) * ($width - 1))
                            $ry = [Math]::Round(([int]$parts[2] / 10000.0) * ($height - 1))
                            [Win32]::Move($rx, $ry)
                        } elseif ($parts[0] -eq 'c') {
                            $rx = [Math]::Round(([int]$parts[1] / 10000.0) * ($width - 1))
                            $ry = [Math]::Round(([int]$parts[2] / 10000.0) * ($height - 1))
                            [Win32]::Click($rx, $ry, [int]$parts[3])
                        } elseif ($parts[0] -eq 'd') {
                            $rx = [Math]::Round(([int]$parts[1] / 10000.0) * ($width - 1))
                            $ry = [Math]::Round(([int]$parts[2] / 10000.0) * ($height - 1))
                            [Win32]::MouseDown($rx, $ry, [int]$parts[3])
                        } elseif ($parts[0] -eq 'u') {
                            $rx = [Math]::Round(([int]$parts[1] / 10000.0) * ($width - 1))
                            $ry = [Math]::Round(([int]$parts[2] / 10000.0) * ($height - 1))
                            [Win32]::MouseUp($rx, $ry, [int]$parts[3])
                        } elseif ($parts[0] -eq 'w') {
                            [Win32]::MouseWheel([int]$parts[1])
                        } elseif ($parts[0] -eq 'k') {
                            $keyStr = $line.Substring(2)
                            [System.Windows.Forms.SendKeys]::SendWait($keyStr)
                        }
                    }
                }

                # 2. Check active desktop
                $canSwitch = $false
                $name = [Win32]::GetActiveDesktopName([ref]$canSwitch)

                # Send active desktop name to Electron
                $writer.WriteLine("desktop:$name")

                # 3. Capture screen if we are on a secure/Winlogon desktop
                if ($name -ne "Default" -and $name -ne "unknown") {
                    Log-Message "Active desktop is secure: $name. Capturing..."
                    $bytes = [Win32]::CaptureScreen($width, $height, 60)
                    if ($bytes -and $bytes.Length -gt 0) {
                        Log-Message "Capture succeeded, bytes: $($bytes.Length)"
                        $base64 = [Convert]::ToBase64String($bytes)
                        $writer.WriteLine("frame:$base64")
                    } else {
                        Log-Message "Capture returned 0 bytes"
                    }
                }
            } catch {
                Log-Message "Error in main loop iteration: $_"
                # If it's a connection/socket write failure, exit inner loop to trigger reconnect
                if ($_.Exception.Message -like "*transport connection*" -or $_.Exception.Message -like "*forcibly closed*") {
                    break
                }
            }
            
            Start-Sleep -Milliseconds 250
        }
        Log-Message "Socket connection closed"
    } catch {
        Log-Message "Socket connection failed: $_"
    } finally {
        if ($client) { $client.Close() }
    }

    # Wait 5 seconds before retrying connection
    Start-Sleep -Seconds 5
}

