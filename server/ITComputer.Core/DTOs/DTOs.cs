using ITComputer.Core.Models;

namespace ITComputer.Core.DTOs;

// ─── Auth DTOs ────────────────────────────────────────────────────────────────

public record LoginRequest(string Username, string Password, string? MFACode);

public record LoginResponse(
    string AccessToken,
    string RefreshToken,
    DateTime Expiry,
    UserDto User,
    bool RequiresMFA);

public record RefreshTokenRequest(string RefreshToken);

public record MFASetupResponse(string QrCodeBase64, string Secret);

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

// ─── User DTOs ────────────────────────────────────────────────────────────────

public record UserDto(
    int Id,
    string Username,
    string Email,
    string FullName,
    string Department,
    string Role,
    bool IsActive,
    bool MFAEnabled,
    DateTime? LastLoginAt,
    string? AvatarUrl,
    string Location);

public record CreateUserRequest(
    string Username,
    string Email,
    string Password,
    string FullName,
    string Department,
    UserRole Role,
    string Location);

public record UpdateUserRequest(
    string? Email,
    string? FullName,
    string? Department,
    UserRole? Role,
    bool? IsActive,
    string? Location);

// ─── Group DTOs ───────────────────────────────────────────────────────────────

public record CreateGroupRequest(string Name);
public record UpdateGroupRequest(string? Name, List<int>? DeviceIds, List<int>? AllowedUserIds);
public record DeviceGroupDto(int Id, string Name, List<int> DeviceIds, List<int> AllowedUserIds);

// ─── Device DTOs ─────────────────────────────────────────────────────────────

public record DeviceDto(
    int Id,
    string Hostname,
    string IPAddress,
    string MACAddress,
    string OS,
    string OSVersion,
    string AgentVersion,
    string Status,
    bool IsAuthorized,
    string Location,
    string Department,
    string AssignedUser,
    DateTime? LastSeenAt,
    DeviceMetricsDto? Metrics,
    string? AntivirusStatus,
    string? AntivirusName,
    bool WakeOnLanEnabled);

public record DeviceMetricsDto(
    double CpuUsage,
    double RamUsage,
    double RamTotal,
    double DiskUsage,
    double DiskTotal,
    string CPUModel,
    int LogicalCores,
    long UptimeSeconds,
    int MonitorCount,
    DateTime RecordedAt);

public record DeviceRegistrationRequest(
    string Hostname,
    string IPAddress,
    string MACAddress,
    string OS,
    string OSVersion,
    string AgentVersion);

public record DeviceMetricsUpdate(
    double CpuUsage,
    double RamUsage,
    double RamTotal,
    double DiskUsage,
    double DiskTotal,
    string CPUModel,
    int LogicalCores,
    long UptimeSeconds,
    int MonitorCount);

// ─── Session DTOs ─────────────────────────────────────────────────────────────

public record SessionDto(
    int Id,
    string EngineerName,
    string DeviceHostname,
    string DeviceIP,
    string Status,
    DateTime StartedAt,
    DateTime? EndedAt,
    bool IsRecorded,
    bool BlackoutMode,
    bool PrivacyMode,
    string? Notes,
    int? TicketId);

public record StartSessionRequest(int DeviceId, int? TicketId, bool Record = true);

public record EndSessionRequest(int SessionId, string? Notes);

// ─── Ticket DTOs ─────────────────────────────────────────────────────────────

public record TicketDto(
    int Id,
    string TicketNumber,
    string Title,
    string Description,
    int DeviceId,
    string DeviceHostname,
    string? AssignedTo,
    string Status,
    string Priority,
    string Category,
    string ReporterName,
    DateTime CreatedAt,
    DateTime? ResolvedAt,
    DateTime? DueDate,
    string? Resolution);

public record CreateTicketRequest(
    string Title,
    string Description,
    int DeviceId,
    string Category,
    string ReporterName,
    string ReporterEmail,
    TicketPriority Priority,
    DateTime? DueDate);

public record UpdateTicketRequest(
    TicketStatus? Status,
    int? AssignedToId,
    TicketPriority? Priority,
    string? Resolution,
    DateTime? DueDate);

// ─── Signaling DTOs ──────────────────────────────────────────────────────────

public record SignalingMessage(
    string Type,     // offer, answer, candidate, connect, disconnect
    string From,
    string To,
    string Payload); // JSON-serialized SDP or ICE candidate

// ─── Chat DTOs ───────────────────────────────────────────────────────────────

public record ChatMessageDto(
    int Id,
    string SenderName,
    bool IsEngineer,
    string Message,
    string? AttachmentName,
    DateTime SentAt,
    bool IsRead);

public record SendMessageRequest(int SessionId, string Message, string? AttachmentPath, string? AttachmentName);

// ─── Notification DTOs ───────────────────────────────────────────────────────

public record NotificationDto(
    int Id,
    string Title,
    string Message,
    string Severity,
    string Type,
    int? DeviceId,
    bool IsRead,
    DateTime CreatedAt);

// ─── Dashboard DTOs ──────────────────────────────────────────────────────────

public record DashboardStats(
    int TotalDevices,
    int OnlineDevices,
    int OfflineDevices,
    int ActiveSessions,
    int OpenTickets,
    int CriticalTickets,
    double AvgCpuUsage,
    double AvgRamUsage,
    IEnumerable<DeviceDto> RecentlyOnline,
    IEnumerable<SessionDto> ActiveSessionsList);

// ─── Report DTOs ─────────────────────────────────────────────────────────────

public record EngineerPerformanceReport(
    string EngineerName,
    int TotalSessions,
    int TotalTicketsResolved,
    double AvgSessionDurationMinutes,
    DateTime PeriodStart,
    DateTime PeriodEnd);

public record DeviceHealthReport(
    string Hostname,
    double AvgCpuUsage,
    double AvgRamUsage,
    int IncidentCount,
    int SessionCount,
    DateTime PeriodStart,
    DateTime PeriodEnd);
