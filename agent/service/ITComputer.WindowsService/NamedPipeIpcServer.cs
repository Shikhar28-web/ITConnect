using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace ITComputer.WindowsService;

public class NamedPipeIpcServer
{
    private const string PipeName = "ITComputer.ServiceIpc";
    private readonly ILogger _logger;
    private StreamWriter? _pipeWriter;
    private readonly object _writeLock = new();

    [DllImport("sas.dll", SetLastError = true)]
    private static extern void SendSAS(bool asUser);

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    private readonly ScreenCaptureLauncher _launcher;

    public NamedPipeIpcServer(ILogger logger, SessionNotificationHandler handler, ScreenCaptureLauncher launcher)
    {
        _logger = logger;
        _launcher = launcher;
    }

    public async Task StartAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Create named pipe server allowing anyone or just local processes to connect
                using var pipe = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                _logger.LogInformation("Waiting for Electron Agent to connect via Named Pipe...");
                await pipe.WaitForConnectionAsync(ct);
                _logger.LogInformation("Electron Agent connected via Named Pipe.");

                using var reader = new StreamReader(pipe);
                var writer = new StreamWriter(pipe) { AutoFlush = true };

                lock (_writeLock)
                {
                    _pipeWriter = writer;
                }

                string? line;
                while ((line = await reader.ReadLineAsync(ct)) != null)
                {
                    _logger.LogInformation($"Received pipe command: {line}");
                    if (line.Trim() == "SAS")
                    {
                        _logger.LogInformation("Invoking SendSAS (SYSTEM level)...");
                        try
                        {
                            SendSAS(false);
                            _logger.LogInformation("SendSAS completed.");

                            // Immediately launch capture on the secure desktop
                            uint sessionId = WTSGetActiveConsoleSessionId();
                            if (sessionId != 0xFFFFFFFF)
                            {
                                _logger.LogInformation($"Launching capture helper on Winlogon for session {sessionId}...");
                                _ = Task.Run(async () =>
                                {
                                    await Task.Delay(500); // Allow desktop transition to finalize
                                    _launcher.LaunchInSession((int)sessionId, "winsta0\\Winlogon");
                                });
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError($"SendSAS failed: {ex.Message}");
                        }
                    }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"Named pipe server error or client disconnected: {ex.Message}");
            }
            finally
            {
                lock (_writeLock)
                {
                    _pipeWriter = null;
                }
            }

            await Task.Delay(1000, ct);
        }
    }

    public void SendSessionEvent(WTS_SESSION_EVENTS eventId, int sessionId)
    {
        lock (_writeLock)
        {
            if (_pipeWriter != null)
            {
                try
                {
                    // e.g. "WTS_SESSION_LOCK 1"
                    _pipeWriter.WriteLine($"{eventId} {sessionId}");
                    _logger.LogInformation($"Sent WTS session event to client: {eventId} {sessionId}");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning($"Failed to send WTS session event via Named Pipe: {ex.Message}");
                }
            }
        }
    }
}
