using System;
using System.Linq;
using ITComputer.Data;
using Microsoft.EntityFrameworkCore;
using Xunit;
using Xunit.Abstractions;

namespace ITComputer.Tests;

public class DbCheck
{
    private readonly ITestOutputHelper _output;

    public DbCheck(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public void PrintUsers()
    {
        var dbPath = System.IO.Path.GetFullPath(System.IO.Path.Combine(AppContext.BaseDirectory, "../../../../ITComputer.API/ITComputerDB.sqlite"));
        _output.WriteLine($"Database file exists at {dbPath}: {System.IO.File.Exists(dbPath)}");
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={dbPath}")
            .Options;

        using var db = new AppDbContext(options);
        var logs = db.AuditLogs.OrderByDescending(l => l.Timestamp).ToList();
        _output.WriteLine($"Total audit logs found: {logs.Count}");
        foreach (var log in logs)
        {
            _output.WriteLine($"Time: {log.Timestamp}, User: {log.Username}, Action: {log.Action}, Target: {log.Target}, Success: {log.IsSuccess}, Details: {log.Details}, IP: {log.IPAddress}, Reason: {log.FailureReason}");
        }
    }
}
