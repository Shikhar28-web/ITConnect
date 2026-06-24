Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class SAS {
    // SendSAS from sas.dll - works when SoftwareSASGeneration = 3 in registry
    [DllImport("sas.dll", SetLastError = true)]
    public static extern void SendSAS(bool asUser);

    // Fallback: simulate Ctrl+Alt+Del via keybd_event
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

    public const byte VK_CONTROL = 0x11;
    public const byte VK_MENU    = 0x12; // Alt
    public const byte VK_DELETE  = 0x2E;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
}
"@

try {
    # Primary: Use SendSAS (works when SoftwareSASGeneration = 3)
    [SAS]::SendSAS($false)
    Write-Host "SendSAS executed successfully."
} catch {
    Write-Warning "SendSAS failed: $($_.Exception.Message)"
    # Fallback: use keybd_event to simulate Ctrl+Alt+Del
    try {
        [SAS]::keybd_event([SAS]::VK_CONTROL, 0, 0, 0)
        [SAS]::keybd_event([SAS]::VK_MENU, 0, 0, 0)
        [SAS]::keybd_event([SAS]::VK_DELETE, 0, [SAS]::KEYEVENTF_EXTENDEDKEY, 0)
        [System.Threading.Thread]::Sleep(100)
        [SAS]::keybd_event([SAS]::VK_DELETE, 0, [SAS]::KEYEVENTF_EXTENDEDKEY -bor [SAS]::KEYEVENTF_KEYUP, 0)
        [SAS]::keybd_event([SAS]::VK_MENU, 0, [SAS]::KEYEVENTF_KEYUP, 0)
        [SAS]::keybd_event([SAS]::VK_CONTROL, 0, [SAS]::KEYEVENTF_KEYUP, 0)
        Write-Host "Fallback keybd_event CAD executed."
    } catch {
        Write-Error "Both SendSAS and fallback failed: $($_.Exception.Message)"
    }
}
