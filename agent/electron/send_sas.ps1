Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SAS {
    [DllImport("sas.dll", SetLastError = true)]
    public static extern void SendSAS(bool asUser);
}
"@
[SAS]::SendSAS($false)
