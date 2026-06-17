namespace ITComputer.Core.Models;

public enum SessionStatus
{
    Connecting,
    Active,
    Paused,
    Ended,
    Failed
}

public class RemoteSession
{
    public int Id { get; set; }
    public int EngineerId { get; set; }
    public int DeviceId { get; set; }
    public int? TicketId { get; set; }
    public SessionStatus Status { get; set; } = SessionStatus.Connecting;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EndedAt { get; set; }
    public string? RecordingPath { get; set; }
    public bool IsRecorded { get; set; } = false;
    public bool BlackoutMode { get; set; } = false;
    public bool PrivacyMode { get; set; } = false;
    public string? Notes { get; set; }
    public string InitiatorIP { get; set; } = string.Empty;
    public long BytesTransferred { get; set; } = 0;
    public int CommandsExecuted { get; set; } = 0;

    // Navigation
    public User? Engineer { get; set; }
    public Device? Device { get; set; }
    public SupportTicket? Ticket { get; set; }
    public ICollection<ChatMessage> ChatMessages { get; set; } = new List<ChatMessage>();
    public ICollection<FileTransfer> FileTransfers { get; set; } = new List<FileTransfer>();
    public SessionRecording? Recording { get; set; }
}

public class SessionRecording
{
    public int Id { get; set; }
    public int SessionId { get; set; }
    public string FilePath { get; set; } = string.Empty;
    public long FileSizeBytes { get; set; }
    public int DurationSeconds { get; set; }
    public string EncryptionKeyHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsExported { get; set; } = false;

    public RemoteSession? Session { get; set; }
}

public class SessionLog
{
    public int Id { get; set; }
    public int SessionId { get; set; }
    public string EventType { get; set; } = string.Empty; // MouseClick, KeyPress, FileTransfer, etc.
    public string Details { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    public RemoteSession? Session { get; set; }
}
