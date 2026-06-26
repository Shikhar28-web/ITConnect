using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = Host.CreateDefaultBuilder(args)
    .UseWindowsService(options => options.ServiceName = "ITComputer Agent Service")
    .ConfigureServices(services => services.AddHostedService<ITComputer.WindowsService.Worker>())
    .Build();

await host.RunAsync();
