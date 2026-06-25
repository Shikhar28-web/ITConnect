using ITComputer.WindowsService.Interop;

namespace ITComputer.WindowsService.Sas;

/// <summary>
/// Generates the Secure Attention Sequence (Ctrl+Alt+Delete) from LocalSystem.
///
/// Why only a Windows Service can do this:
///   SendSAS() from sas.dll requires the caller to hold the SE_TCB_PRIVILEGE
///   ("Act as part of the operating system") which is only granted to LocalSystem.
///   Calling it from a user-mode Electron process fails silently or returns
///   ACCESS_DENIED on hardened systems, even if the registry key
///   HKLM\...\Policies\System\SoftwareSASGeneration is set.
///
///   TeamViewer, RustDesk, and AnyDesk all invoke SAS from their privileged
///   service component — this implementation follows the same pattern.
/// </summary>
public static class SasInvoker
{
    /// <summary>
    /// Sends Ctrl+Alt+Delete on behalf of the active console session user.
    /// This causes Windows to display the secure attention screen (lock screen,
    /// password prompt, Task Manager prompt, etc.).
    /// </summary>
    public static void SendCtrlAltDelete()
    {
        try
        {
            // asUser = true: SAS is delivered to the interactive user's session
            NativeApi.SendSAS(asUser: true);
        }
        catch (Exception ex)
        {
            // Log but don't crash the service
            Console.Error.WriteLine($"[SasInvoker] SendSAS failed: {ex.Message}");
        }
    }
}
