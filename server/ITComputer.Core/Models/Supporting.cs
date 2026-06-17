namespace ITComputer.Core.Models;

public enum FileTransferDirection
{
    Upload,   // Engineer → Device
    Download  // Device → Engineer
}

public enum FileTransferStatus
{
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled
}

public class FileTransfer
{
    public int Id { get; set; }
    public int SessionId { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string SourcePath { get; set; } = string.Empty;
    public string DestinationPath { get; set; } = string.Empty;
    public long FileSizeBytes { get; set; }
    public long BytesTransferred { get; set; }
    public FileTransferDirection Direction { get; set; }
    public FileTransferStatus Status { get; set; } = FileTransferStatus.Pending;
    public string? ErrorMessage { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }

    public RemoteSession? Session { get; set; }
}

public class ChatMessage
{
    public int Id { get; set; }
    public int SessionId { get; set; }
    public string SenderName { get; set; } = string.Empty;
    public bool IsEngineer { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? AttachmentPath { get; set; }
    public string? AttachmentName { get; set; }
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public bool IsRead { get; set; } = false;

    public RemoteSession? Session { get; set; }
}

public enum NotificationSeverity
{
    Info,
    Warning,
    Critical
}

public class Notification
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public NotificationSeverity Severity { get; set; } = NotificationSeverity.Info;
    public string Type { get; set; } = string.Empty; // DeviceOffline, HighCPU, etc.
    public int? DeviceId { get; set; }
    public int? UserId { get; set; }
    public bool IsRead { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReadAt { get; set; }
}

public enum DeploymentStatus
{
    Pending,
    InProgress,
    Success,
    Failed,
    Rollback
}

public class SoftwareDeployment
{
    public int Id { get; set; }
    public int DeviceId { get; set; }
    public int InitiatedById { get; set; }
    public string SoftwareName { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string InstallerPath { get; set; } = string.Empty;
    public string? SilentArgs { get; set; }
    public DeploymentStatus Status { get; set; } = DeploymentStatus.Pending;
    public string? Output { get; set; }
    public string? ErrorOutput { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public bool IsUninstall { get; set; } = false;

    public Device? Device { get; set; }
    public User? InitiatedBy { get; set; }
}

public class AuditLog
{
    public int Id { get; set; }
    public int? UserId { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty; // Login, StartSession, FileTransfer, etc.
    public string Target { get; set; } = string.Empty; // Device hostname, Username, etc.
    public string Details { get; set; } = string.Empty; // JSON details
    public string IPAddress { get; set; } = string.Empty;
    public string UserAgent { get; set; } = string.Empty;
    public bool IsSuccess { get; set; } = true;
    public string? FailureReason { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string IntegrityHash { get; set; } = string.Empty; // Tamper-evident chain

    public User? User { get; set; }
}
