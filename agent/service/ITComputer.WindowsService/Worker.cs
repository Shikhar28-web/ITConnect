using ITComputer.WindowsService.Ipc;

namespace ITComputer.WindowsService;

/// <summary>
/// Background worker that starts the Named Pipe server and keeps it alive
/// for the lifetime of the Windows Service.
/// </summary>
public sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _log;
    private PipeServer? _pipeServer;

    public Worker(ILogger<Worker> log) => _log = log;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("ITComputer Windows Service starting (PID {Pid})", Environment.ProcessId);

        _pipeServer = new PipeServer(
            _log.CreateLogger<PipeServer>(),
            stoppingToken);

        _pipeServer.Start();
        _log.LogInformation("Named pipe server started at \\\\.\\pipe\\ITComputerService");

        // Keep running until the SCM sends a stop signal
        await Task.Delay(Timeout.Infinite, stoppingToken).ConfigureAwait(false);
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _log.LogInformation("ITComputer Windows Service stopping");
        _pipeServer?.Dispose();
        await base.StopAsync(cancellationToken);
    }
}

// Extension to create a typed logger from a generic one
file static class LoggerExtensions
{
    public static ILogger<T> CreateLogger<T>(this ILogger logger)
    {
        if (logger is ILogger<T> typed) return typed;
        return new TypedLogger<T>(logger);
    }

    private sealed class TypedLogger<T>(ILogger inner) : ILogger<T>
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull
            => inner.BeginScope(state);
        public bool IsEnabled(LogLevel l) => inner.IsEnabled(l);
        public void Log<TState>(LogLevel l, EventId id, TState s, Exception? e,
            Func<TState, Exception?, string> f) => inner.Log(l, id, s, e, f);
    }
}
