using ITComputer.Core.DTOs;
using ITComputer.Core.Interfaces;
using ITComputer.Core.Models;
using ITComputer.Data;
using Microsoft.EntityFrameworkCore;

namespace ITComputer.API.Services;

public class SessionService : ISessionService
{
    private readonly AppDbContext _db;
    private readonly IAuditService _audit;

    public SessionService(AppDbContext db, IAuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<SessionDto> StartSessionAsync(int engineerId, StartSessionRequest request)
    {
        var device = await _db.Devices.FindAsync(request.DeviceId)
            ?? throw new KeyNotFoundException("Device not found.");

        if (!device.IsAuthorized)
            throw new InvalidOperationException("Device is not authorized for remote access.");

        // Mark device as in session
        device.Status = DeviceStatus.InSession;

        var session = new RemoteSession
        {
            EngineerId = engineerId,
            DeviceId = request.DeviceId,
            TicketId = request.TicketId,
            Status = SessionStatus.Connecting,
            StartedAt = DateTime.UtcNow,
            IsRecorded = request.Record
        };

        _db.RemoteSessions.Add(session);
        await _db.SaveChangesAsync();

        var engineer = await _db.Users.FindAsync(engineerId);
        await _audit.LogAsync(engineerId, engineer?.Username ?? "", "StartSession",
            device.Hostname, $"Session {session.Id} started", "", "");

        return MapDto(session, engineer, device);
    }

    public async Task<SessionDto> EndSessionAsync(int sessionId, EndSessionRequest request)
    {
        var session = await _db.RemoteSessions
            .Include(s => s.Device)
            .Include(s => s.Engineer)
            .FirstOrDefaultAsync(s => s.Id == sessionId)
            ?? throw new KeyNotFoundException("Session not found.");

        session.Status = SessionStatus.Ended;
        session.EndedAt = DateTime.UtcNow;
        session.Notes = request.Notes;

        // Restore device status
        if (session.Device != null)
        {
            session.Device.Status = DeviceStatus.Online;
            session.Device.BlackoutMode = false;
        }

        await _db.SaveChangesAsync();

        await _audit.LogAsync(session.EngineerId, session.Engineer?.Username ?? "",
            "EndSession", session.Device?.Hostname ?? "",
            $"Session {sessionId} ended. Duration: {(session.EndedAt - session.StartedAt)?.TotalMinutes:F1} min", "", "");

        return MapDto(session, session.Engineer, session.Device!);
    }

    public async Task<SessionDto?> GetSessionByIdAsync(int id)
    {
        var session = await _db.RemoteSessions
            .Include(s => s.Engineer)
            .Include(s => s.Device)
            .FirstOrDefaultAsync(s => s.Id == id);
        return session == null ? null : MapDto(session, session.Engineer, session.Device!);
    }

    public async Task<IEnumerable<SessionDto>> GetSessionsByDeviceAsync(int deviceId)
    {
        var sessions = await _db.RemoteSessions
            .Include(s => s.Engineer)
            .Include(s => s.Device)
            .Where(s => s.DeviceId == deviceId)
            .OrderByDescending(s => s.StartedAt)
            .ToListAsync();
        return sessions.Select(s => MapDto(s, s.Engineer, s.Device!));
    }

    public async Task<IEnumerable<SessionDto>> GetSessionsByEngineerAsync(int engineerId)
    {
        var sessions = await _db.RemoteSessions
            .Include(s => s.Engineer)
            .Include(s => s.Device)
            .Where(s => s.EngineerId == engineerId)
            .OrderByDescending(s => s.StartedAt)
            .ToListAsync();
        return sessions.Select(s => MapDto(s, s.Engineer, s.Device!));
    }

    public async Task<IEnumerable<SessionDto>> GetActiveSessionsAsync()
    {
        var sessions = await _db.RemoteSessions
            .Include(s => s.Engineer)
            .Include(s => s.Device)
            .Where(s => s.Status == SessionStatus.Active || s.Status == SessionStatus.Connecting)
            .OrderByDescending(s => s.StartedAt)
            .ToListAsync();
        return sessions.Select(s => MapDto(s, s.Engineer, s.Device!));
    }

    public async Task<IEnumerable<SessionDto>> GetAllSessionsAsync(DateTime? from, DateTime? to)
    {
        var query = _db.RemoteSessions
            .Include(s => s.Engineer)
            .Include(s => s.Device)
            .AsQueryable();

        if (from.HasValue) query = query.Where(s => s.StartedAt >= from.Value);
        if (to.HasValue) query = query.Where(s => s.StartedAt <= to.Value);

        var sessions = await query.OrderByDescending(s => s.StartedAt).ToListAsync();
        return sessions.Select(s => MapDto(s, s.Engineer, s.Device!));
    }

    public async Task SetBlackoutModeAsync(int sessionId, bool enabled)
    {
        var session = await _db.RemoteSessions.Include(s => s.Device)
            .FirstOrDefaultAsync(s => s.Id == sessionId)
            ?? throw new KeyNotFoundException("Session not found.");

        session.BlackoutMode = enabled;
        if (session.Device != null)
            session.Device.BlackoutMode = enabled;

        await _db.SaveChangesAsync();
    }

    public async Task SetPrivacyModeAsync(int sessionId, bool enabled)
    {
        var session = await _db.RemoteSessions.FindAsync(sessionId)
            ?? throw new KeyNotFoundException("Session not found.");
        session.PrivacyMode = enabled;
        await _db.SaveChangesAsync();
    }

    public async Task LogSessionEventAsync(int sessionId, string eventType, string details)
    {
        _db.SessionLogs.Add(new SessionLog
        {
            SessionId = sessionId,
            EventType = eventType,
            Details = details,
            Timestamp = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
    }

    public async Task<byte[]?> GetRecordingAsync(int sessionId)
    {
        var recording = await _db.SessionRecordings.FirstOrDefaultAsync(r => r.SessionId == sessionId);
        if (recording == null || !File.Exists(recording.FilePath)) return null;
        return await File.ReadAllBytesAsync(recording.FilePath);
    }

    private static SessionDto MapDto(RemoteSession s, User? engineer, Device device) => new(
        s.Id,
        s.DeviceId,
        engineer?.FullName ?? "Unknown",
        device.Hostname,
        device.IPAddress,
        s.Status.ToString(),
        s.StartedAt,
        s.EndedAt,
        s.IsRecorded,
        s.BlackoutMode,
        s.PrivacyMode,
        s.Notes,
        s.TicketId);
}
