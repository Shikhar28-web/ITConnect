using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace ITComputer.WindowsService;

public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private SessionNotificationHandler? _sessionHandler;
    private NamedPipeIpcServer? _ipcServer;
    private ScreenCaptureLauncher? _captureLauncher;

    public Worker(ILogger<Worker> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ITComputer Windows Service execution started");

        _sessionHandler = new SessionNotificationHandler(_logger);
        _ipcServer = new NamedPipeIpcServer(_logger, _sessionHandler);
        _captureLauncher = new ScreenCaptureLauncher(_logger);

        _sessionHandler.OnSessionChanged += (eventId, sessionId) =>
        {
            _logger.LogInformation($"Session event: {eventId} on session {sessionId}");
            
            // Forward event to Electron client
            _ipcServer.SendSessionEvent(eventId, sessionId);

            // Relaunch the capture exe in the active console/RDP session on logon/unlock/connect
            if (eventId == WTS_SESSION_EVENTS.WTS_SESSION_UNLOCK ||
                eventId == WTS_SESSION_EVENTS.WTS_SESSION_LOGON ||
                eventId == WTS_SESSION_EVENTS.WTS_CONSOLE_CONNECT ||
                eventId == WTS_SESSION_EVENTS.WTS_REMOTE_CONNECT)
            {
                _captureLauncher.LaunchInSession(sessionId);
            }
        };

        await Task.WhenAll(
            _ipcServer.StartAsync(stoppingToken),
            _sessionHandler.StartAsync(stoppingToken)
        );
    }
}
