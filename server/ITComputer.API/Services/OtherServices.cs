using ITComputer.Core.DTOs;
using ITComputer.Core.Interfaces;
using ITComputer.Core.Models;
using ITComputer.Data;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ITComputer.API.Services;

public class NotificationService : INotificationService
{
    private readonly AppDbContext _db;
    private readonly IHubContext<Hubs.NotificationHub> _hub;

    public NotificationService(AppDbContext db, IHubContext<Hubs.NotificationHub> hub)
    {
        _db = db;
        _hub = hub;
    }

    public async Task SendNotificationAsync(string type, string title, string message,
        NotificationSeverity severity, int? deviceId = null, int? userId = null)
    {
        var notification = new Notification
        {
            Type = type,
            Title = title,
            Message = message,
            Severity = severity,
            DeviceId = deviceId,
            UserId = userId,
            CreatedAt = DateTime.UtcNow
        };

        _db.Notifications.Add(notification);
        await _db.SaveChangesAsync();

        // Push via SignalR
        var dto = MapDto(notification);
        await _hub.Clients.All.SendAsync("ReceiveNotification", dto);
    }

    public async Task<IEnumerable<NotificationDto>> GetUserNotificationsAsync(int userId, bool unreadOnly = false)
    {
        var query = _db.Notifications.AsQueryable();
        if (unreadOnly) query = query.Where(n => !n.IsRead);

        var notifications = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(100)
            .ToListAsync();

        return notifications.Select(MapDto);
    }

    public async Task MarkNotificationReadAsync(int notificationId)
    {
        var notification = await _db.Notifications.FindAsync(notificationId);
        if (notification == null) return;
        notification.IsRead = true;
        notification.ReadAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    public async Task MarkAllNotificationsReadAsync(int userId)
    {
        var unread = await _db.Notifications
            .Where(n => !n.IsRead)
            .ToListAsync();

        foreach (var n in unread)
        {
            n.IsRead = true;
            n.ReadAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
    }

    private static NotificationDto MapDto(Notification n) => new(
        n.Id, n.Title, n.Message,
        n.Severity.ToString(), n.Type,
        n.DeviceId, n.IsRead, n.CreatedAt);
}

public class AuditService : IAuditService
{
    private readonly AppDbContext _db;

    public AuditService(AppDbContext db) => _db = db;

    public async Task LogAsync(int? userId, string username, string action, string target,
        string details, string ipAddress, string userAgent,
        bool isSuccess = true, string? failureReason = null)
    {
        // Compute integrity hash based on previous entry for tamper-evident chain
        var lastHash = (await _db.AuditLogs.OrderByDescending(l => l.Id)
            .Select(l => l.IntegrityHash).FirstOrDefaultAsync()) ?? "GENESIS";

        var content = $"{userId}|{username}|{action}|{target}|{details}|{DateTime.UtcNow:O}|{lastHash}";
        var hash = Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(content)));

        var log = new AuditLog
        {
            UserId = userId,
            Username = username,
            Action = action,
            Target = target,
            Details = details,
            IPAddress = ipAddress,
            UserAgent = userAgent,
            IsSuccess = isSuccess,
            FailureReason = failureReason,
            Timestamp = DateTime.UtcNow,
            IntegrityHash = hash
        };

        _db.AuditLogs.Add(log);
        await _db.SaveChangesAsync();
    }

    public async Task<IEnumerable<AuditLog>> GetLogsAsync(
        DateTime? from, DateTime? to, string? userId, string? action)
    {
        var query = _db.AuditLogs.Include(l => l.User).AsQueryable();

        if (from.HasValue) query = query.Where(l => l.Timestamp >= from.Value);
        if (to.HasValue) query = query.Where(l => l.Timestamp <= to.Value);
        if (!string.IsNullOrEmpty(userId) && int.TryParse(userId, out var uid))
            query = query.Where(l => l.UserId == uid);
        if (!string.IsNullOrEmpty(action))
            query = query.Where(l => l.Action.Contains(action));

        return await query.OrderByDescending(l => l.Timestamp).Take(500).ToListAsync();
    }
}

public class TicketService : ITicketService
{
    private readonly AppDbContext _db;

    public TicketService(AppDbContext db) => _db = db;

    public async Task<IEnumerable<TicketDto>> GetAllTicketsAsync()
    {
        var tickets = await _db.SupportTickets
            .Include(t => t.Device)
            .Include(t => t.AssignedTo)
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync();
        return tickets.Select(MapDto);
    }

    public async Task<TicketDto?> GetTicketByIdAsync(int id)
    {
        var ticket = await _db.SupportTickets
            .Include(t => t.Device)
            .Include(t => t.AssignedTo)
            .FirstOrDefaultAsync(t => t.Id == id);
        return ticket == null ? null : MapDto(ticket);
    }

    public async Task<TicketDto> CreateTicketAsync(CreateTicketRequest request)
    {
        var count = await _db.SupportTickets.CountAsync();
        var ticket = new SupportTicket
        {
            TicketNumber = $"TKT-{DateTime.UtcNow.Year}-{count + 1:D4}",
            Title = request.Title,
            Description = request.Description,
            DeviceId = request.DeviceId,
            Category = request.Category,
            ReporterName = request.ReporterName,
            ReporterEmail = request.ReporterEmail,
            Priority = request.Priority,
            DueDate = request.DueDate,
            Status = TicketStatus.Open,
            CreatedAt = DateTime.UtcNow
        };

        _db.SupportTickets.Add(ticket);
        await _db.SaveChangesAsync();

        await _db.Entry(ticket).Reference(t => t.Device).LoadAsync();
        return MapDto(ticket);
    }

    public async Task<TicketDto> UpdateTicketAsync(int id, UpdateTicketRequest request)
    {
        var ticket = await _db.SupportTickets
            .Include(t => t.Device)
            .Include(t => t.AssignedTo)
            .FirstOrDefaultAsync(t => t.Id == id)
            ?? throw new KeyNotFoundException("Ticket not found.");

        if (request.Status.HasValue)
        {
            ticket.Status = request.Status.Value;
            if (request.Status.Value == TicketStatus.Resolved)
                ticket.ResolvedAt = DateTime.UtcNow;
        }
        if (request.AssignedToId.HasValue) ticket.AssignedToId = request.AssignedToId;
        if (request.Priority.HasValue) ticket.Priority = request.Priority.Value;
        if (request.Resolution != null) ticket.Resolution = request.Resolution;
        if (request.DueDate.HasValue) ticket.DueDate = request.DueDate;

        await _db.SaveChangesAsync();
        return MapDto(ticket);
    }

    public async Task DeleteTicketAsync(int id)
    {
        var ticket = await _db.SupportTickets.FindAsync(id)
            ?? throw new KeyNotFoundException("Ticket not found.");
        _db.SupportTickets.Remove(ticket);
        await _db.SaveChangesAsync();
    }

    public async Task<IEnumerable<TicketDto>> GetTicketsByDeviceAsync(int deviceId)
    {
        var tickets = await _db.SupportTickets
            .Include(t => t.Device)
            .Include(t => t.AssignedTo)
            .Where(t => t.DeviceId == deviceId)
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync();
        return tickets.Select(MapDto);
    }

    public async Task<IEnumerable<TicketDto>> GetTicketsByEngineerAsync(int engineerId)
    {
        var tickets = await _db.SupportTickets
            .Include(t => t.Device)
            .Include(t => t.AssignedTo)
            .Where(t => t.AssignedToId == engineerId)
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync();
        return tickets.Select(MapDto);
    }

    private static TicketDto MapDto(SupportTicket t) => new(
        t.Id, t.TicketNumber, t.Title, t.Description,
        t.DeviceId, t.Device?.Hostname ?? "",
        t.AssignedTo?.FullName, t.Status.ToString(),
        t.Priority.ToString(), t.Category,
        t.ReporterName, t.CreatedAt, t.ResolvedAt,
        t.DueDate, t.Resolution);
}

public class ReportService : IReportService
{
    private readonly AppDbContext _db;
    private readonly IDeviceService _deviceService;
    private readonly ISessionService _sessionService;

    public ReportService(AppDbContext db, IDeviceService deviceService, ISessionService sessionService)
    {
        _db = db;
        _deviceService = deviceService;
        _sessionService = sessionService;
    }

    public async Task<IEnumerable<EngineerPerformanceReport>> GetEngineerPerformanceReportAsync(DateTime from, DateTime to)
    {
        var sessions = await _db.RemoteSessions
            .Include(s => s.Engineer)
            .Where(s => s.StartedAt >= from && s.StartedAt <= to && s.Status == SessionStatus.Ended)
            .ToListAsync();

        var tickets = await _db.SupportTickets
            .Where(t => t.ResolvedAt >= from && t.ResolvedAt <= to && t.Status == TicketStatus.Resolved)
            .ToListAsync();

        return sessions
            .GroupBy(s => s.EngineerId)
            .Select(g =>
            {
                var eng = g.First().Engineer;
                var resolvedTickets = tickets.Count(t => t.AssignedToId == g.Key);
                var avgDuration = g
                    .Where(s => s.EndedAt.HasValue)
                    .Select(s => (s.EndedAt!.Value - s.StartedAt).TotalMinutes)
                    .DefaultIfEmpty(0)
                    .Average();

                return new EngineerPerformanceReport(
                    eng?.FullName ?? "Unknown",
                    g.Count(),
                    resolvedTickets,
                    Math.Round(avgDuration, 2),
                    from, to);
            });
    }

    public async Task<IEnumerable<DeviceHealthReport>> GetDeviceHealthReportAsync(DateTime from, DateTime to)
    {
        var devices = await _db.Devices.Include(d => d.Sessions).ToListAsync();
        return devices.Select(d => new DeviceHealthReport(
            d.Hostname,
            d.Metrics?.CpuUsage ?? 0,
            d.Metrics?.RamUsage ?? 0,
            d.Sessions.Count(s => s.StartedAt >= from && s.StartedAt <= to),
            d.Sessions.Count(s => s.StartedAt >= from && s.StartedAt <= to),
            from, to));
    }

    public async Task<DashboardStats> GetDashboardStatsAsync(HashSet<int>? allowedDeviceIds)
    {
        IQueryable<Device> devicesQuery = _db.Devices;
        IQueryable<RemoteSession> sessionsQuery = _db.RemoteSessions;
        IQueryable<SupportTicket> ticketsQuery = _db.SupportTickets;
        IQueryable<DeviceMetrics> metricsQuery = _db.DeviceMetrics;

        if (allowedDeviceIds != null)
        {
            devicesQuery = devicesQuery.Where(d => allowedDeviceIds.Contains(d.Id));
            sessionsQuery = sessionsQuery.Where(s => allowedDeviceIds.Contains(s.DeviceId));
            ticketsQuery = ticketsQuery.Where(t => allowedDeviceIds.Contains(t.DeviceId));
            metricsQuery = metricsQuery.Where(m => allowedDeviceIds.Contains(m.DeviceId));
        }

        var totalDevices = await devicesQuery.CountAsync();
        var onlineDevices = await devicesQuery.CountAsync(d =>
            d.Status == DeviceStatus.Online || d.Status == DeviceStatus.InSession);
        var offlineDevices = totalDevices - onlineDevices;
        var activeSessions = await sessionsQuery.CountAsync(s =>
            s.Status == SessionStatus.Active || s.Status == SessionStatus.Connecting);
        var openTickets = await ticketsQuery.CountAsync(t =>
            t.Status == TicketStatus.Open || t.Status == TicketStatus.InProgress);
        var criticalTickets = await ticketsQuery.CountAsync(t =>
            t.Priority == TicketPriority.Critical && t.Status != TicketStatus.Resolved);

        var avgCpu = await metricsQuery.AnyAsync()
            ? await metricsQuery.AverageAsync(m => m.CpuUsage) : 0;
        var avgRam = await metricsQuery.AnyAsync()
            ? await metricsQuery.AverageAsync(m => m.RamUsage / m.RamTotal * 100) : 0;

        var recentOnline = await _deviceService.GetOnlineDevicesAsync();
        if (allowedDeviceIds != null)
        {
            recentOnline = recentOnline.Where(d => allowedDeviceIds.Contains(d.Id));
        }

        var activeSessionsList = await _sessionService.GetActiveSessionsAsync();
        if (allowedDeviceIds != null)
        {
            activeSessionsList = activeSessionsList.Where(s => allowedDeviceIds.Contains(s.DeviceId));
        }

        return new DashboardStats(
            totalDevices, onlineDevices, offlineDevices,
            activeSessions, openTickets, criticalTickets,
            Math.Round(avgCpu, 1), Math.Round(avgRam, 1),
            recentOnline.Take(10), activeSessionsList.Take(10));
    }
}
