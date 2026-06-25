using ITComputer.WindowsService;

var builder = Host.CreateApplicationBuilder(args);

// Run as a Windows Service (integrates with SCM: SERVICE_RUNNING, pause, stop)
builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "ITComputerService";
});

builder.Services.AddHostedService<Worker>();

// Log to Windows Event Log (visible in Event Viewer → Application)
builder.Logging.AddEventLog(settings =>
{
    settings.SourceName = "ITComputerService";
    settings.LogName    = "Application";
});

// Also log to console (useful when running interactively for debugging)
builder.Logging.AddConsole();
builder.Logging.SetMinimumLevel(LogLevel.Information);

var host = builder.Build();
await host.RunAsync();
