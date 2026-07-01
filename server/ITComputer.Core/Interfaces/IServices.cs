using ITComputer.Core.DTOs;
using ITComputer.Core.Models;

namespace ITComputer.Core.Interfaces;

public interface IAuthService
{
    Task<LoginResponse> LoginAsync(LoginRequest request, string ipAddress);
    Task<LoginResponse> RefreshTokenAsync(string refreshToken, string ipAddress);
    Task LogoutAsync(int userId);
    Task<MFASetupResponse> SetupMFAAsync(int userId);
    Task<bool> VerifyMFAAsync(int userId, string code);
    Task<bool> DisableMFAAsync(int userId, string code);
    Task ChangePasswordAsync(int userId, ChangePasswordRequest request);
    Task<string> GeneratePasswordResetTokenAsync(string email);
    Task ResetPasswordAsync(string token, string newPassword);
}

public interface IUserService
{
    Task<IEnumerable<UserDto>> GetAllUsersAsync();
    Task<UserDto?> GetUserByIdAsync(int id);
    Task<UserDto> CreateUserAsync(CreateUserRequest request);
    Task<UserDto> UpdateUserAsync(int id, UpdateUserRequest request);
    Task DeleteUserAsync(int id);
    Task<bool> UserExistsAsync(string username);
}

public interface IDeviceService
{
    Task<IEnumerable<DeviceDto>> GetAllDevicesAsync();
    Task<DeviceDto?> GetDeviceByIdAsync(int id);
    Task<DeviceDto?> GetDeviceByIPAsync(string ipAddress);
    Task<DeviceDto> RegisterDeviceAsync(DeviceRegistrationRequest request);
    Task UpdateDeviceMetricsAsync(int deviceId, DeviceMetricsUpdate metrics);
    Task SetDeviceOnlineAsync(int deviceId, string connectionId);
    Task SetDeviceOfflineAsync(int deviceId);
    Task<bool> AuthorizeDeviceAsync(int deviceId);
    Task<bool> RevokeDeviceAuthorizationAsync(int deviceId);
    Task SendWakeOnLanAsync(string macAddress, string broadcastIP);
    Task<IEnumerable<DeviceDto>> GetOnlineDevicesAsync();
    Task<IEnumerable<DeviceDto>> GetOfflineDevicesAsync();
}

public interface ISessionService
{
    Task<SessionDto> StartSessionAsync(int engineerId, StartSessionRequest request);
    Task<SessionDto> EndSessionAsync(int sessionId, EndSessionRequest request);
    Task<SessionDto?> GetSessionByIdAsync(int id);
    Task<IEnumerable<SessionDto>> GetSessionsByDeviceAsync(int deviceId);
    Task<IEnumerable<SessionDto>> GetSessionsByEngineerAsync(int engineerId);
    Task<IEnumerable<SessionDto>> GetActiveSessionsAsync();
    Task SetBlackoutModeAsync(int sessionId, bool enabled);
    Task SetPrivacyModeAsync(int sessionId, bool enabled);
    Task LogSessionEventAsync(int sessionId, string eventType, string details);
    Task<byte[]?> GetRecordingAsync(int sessionId);
    Task<IEnumerable<SessionDto>> GetAllSessionsAsync(DateTime? from, DateTime? to);
}

public interface IFileService
{
    Task<FileTransfer> InitiateTransferAsync(int sessionId, string fileName, long fileSize, string destination, string direction);
    Task UpdateTransferProgressAsync(int transferId, long bytesTransferred);
    Task CompleteTransferAsync(int transferId);
    Task FailTransferAsync(int transferId, string error);
    Task<IEnumerable<FileTransfer>> GetSessionTransfersAsync(int sessionId);
    Task<string> SaveUploadedFileAsync(Stream fileStream, string fileName);
    Task<Stream> GetDownloadStreamAsync(string filePath);
}

public interface INotificationService
{
    Task SendNotificationAsync(string type, string title, string message, NotificationSeverity severity, int? deviceId = null, int? userId = null);
    Task<IEnumerable<NotificationDto>> GetUserNotificationsAsync(int userId, bool unreadOnly = false);
    Task MarkNotificationReadAsync(int notificationId);
    Task MarkAllNotificationsReadAsync(int userId);
}

public interface ITicketService
{
    Task<IEnumerable<TicketDto>> GetAllTicketsAsync();
    Task<TicketDto?> GetTicketByIdAsync(int id);
    Task<TicketDto> CreateTicketAsync(CreateTicketRequest request);
    Task<TicketDto> UpdateTicketAsync(int id, UpdateTicketRequest request);
    Task DeleteTicketAsync(int id);
    Task<IEnumerable<TicketDto>> GetTicketsByDeviceAsync(int deviceId);
    Task<IEnumerable<TicketDto>> GetTicketsByEngineerAsync(int engineerId);
}

public interface IAuditService
{
    Task LogAsync(int? userId, string username, string action, string target, string details, string ipAddress, string userAgent, bool isSuccess = true, string? failureReason = null);
    Task<IEnumerable<AuditLog>> GetLogsAsync(DateTime? from, DateTime? to, string? userId, string? action);
}

public interface IReportService
{
    Task<IEnumerable<EngineerPerformanceReport>> GetEngineerPerformanceReportAsync(DateTime from, DateTime to);
    Task<IEnumerable<DeviceHealthReport>> GetDeviceHealthReportAsync(DateTime from, DateTime to);
    Task<DashboardStats> GetDashboardStatsAsync(HashSet<int>? allowedDeviceIds);
}
