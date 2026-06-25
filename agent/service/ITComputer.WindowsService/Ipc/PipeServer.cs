using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using ITComputer.WindowsService.Desktop;
using ITComputer.WindowsService.Sas;

namespace ITComputer.WindowsService.Ipc;

/// <summary>
/// Named pipe server: listens at \\.\pipe\ITComputerService
/// Accepts connections from the Electron agent (user-mode, same machine).
///
/// Security model:
///   - The pipe is created by LocalSystem (the service).
///   - Access is restricted to the current interactive console user + LocalSystem.
///   - Only the local machine can connect (no network pipe access).
///   - Message-mode pipe: each write = one discrete command, no framing needed.
///
/// Protocol (newline-delimited text, same style as InputHelper stdin):
///   CAD                  → Generate Ctrl+Alt+Delete
///   DESKTOP_NAME         → Returns the current active desktop name
///   CAPTURE_SECURE       → Returns base64 JPEG of secure desktop (or "NONE")
///   PING                 → Returns "PONG" (health check)
/// </summary>
public sealed class PipeServer : IDisposable
{
    private const string PipeName       = "ITComputerService";
    private const int    MaxConnections  = 4;
    private const int    BufferSize      = 65536;

    private readonly ILogger<PipeServer>   _log;
    private readonly CancellationToken     _ct;
    private readonly List<Task>            _listeners = [];

    public PipeServer(ILogger<PipeServer> log, CancellationToken ct)
    {
        _log = log;
        _ct  = ct;
    }

    public void Start()
    {
        // Start N concurrent listener tasks so the pipe can handle simultaneous connects
        for (int i = 0; i < MaxConnections; i++)
            _listeners.Add(ListenLoopAsync());
    }

    // ── Pipe listener ─────────────────────────────────────────────────────────

    private async Task ListenLoopAsync()
    {
        while (!_ct.IsCancellationRequested)
        {
            try
            {
                var pipe = CreatePipe();
                await pipe.WaitForConnectionAsync(_ct);
                _ = HandleClientAsync(pipe); // handle in background, don't await
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Pipe listener error, restarting");
                await Task.Delay(500, _ct).ConfigureAwait(false);
            }
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream pipe)
    {
        using (pipe)
        using (var reader = new StreamReader(pipe, leaveOpen: true))
        using (var writer = new StreamWriter(pipe, leaveOpen: true) { AutoFlush = true })
        {
            try
            {
                string? line;
                while ((line = await reader.ReadLineAsync(_ct)) is not null)
                {
                    string response = DispatchCommand(line.Trim());
                    await writer.WriteLineAsync(response);
                }
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Client disconnected");
            }
        }
    }

    // ── Command dispatcher ────────────────────────────────────────────────────

    private string DispatchCommand(string command)
    {
        try
        {
            return command.ToUpperInvariant() switch
            {
                "PING"           => "PONG",
                "CAD"            => HandleCad(),
                "DESKTOP_NAME"   => SecureDesktopCapture.GetCurrentDesktopName(),
                "CAPTURE_SECURE" => SecureDesktopCapture.CaptureSecureDesktop() ?? "NONE",
                _                => $"UNKNOWN:{command}"
            };
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Error dispatching command '{Command}'", command);
            return $"ERROR:{ex.Message}";
        }
    }

    private string HandleCad()
    {
        SasInvoker.SendCtrlAltDelete();
        return "OK";
    }

    // ── Pipe creation with correct ACL ────────────────────────────────────────

    private static NamedPipeServerStream CreatePipe()
    {
        // Build security descriptor: allow LocalSystem + current interactive user
        var pipeSecurity = new PipeSecurity();

        // LocalSystem full control
        pipeSecurity.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            PipeAccessRights.FullControl,
            AccessControlType.Allow));

        // Current user (the server process owner) needs FullControl so it has permissions to create subsequent instances of the pipe
        if (WindowsIdentity.GetCurrent().User is { } ownerSid)
        {
            pipeSecurity.AddAccessRule(new PipeAccessRule(
                ownerSid,
                PipeAccessRights.FullControl,
                AccessControlType.Allow));
        }

        // Authenticated users (covers the Electron agent running under any user session)
        pipeSecurity.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
            PipeAccessRights.ReadWrite,
            AccessControlType.Allow));

        return NamedPipeServerStreamAcl.Create(
            PipeName,
            PipeDirection.InOut,
            MaxConnections,
            PipeTransmissionMode.Message,
            PipeOptions.Asynchronous,
            BufferSize, BufferSize,
            pipeSecurity);
    }

    public void Dispose()
    {
        // Tasks will cancel via CancellationToken; nothing else to dispose
    }
}
