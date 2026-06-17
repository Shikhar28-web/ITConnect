namespace ITComputer.Core.Models;

public enum TicketStatus
{
    Open,
    InProgress,
    OnHold,
    Resolved,
    Closed
}

public enum TicketPriority
{
    Low,
    Medium,
    High,
    Critical
}

public class SupportTicket
{
    public int Id { get; set; }
    public string TicketNumber { get; set; } = string.Empty; // e.g. TKT-2024-001
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public int DeviceId { get; set; }
    public int? AssignedToId { get; set; }
    public TicketStatus Status { get; set; } = TicketStatus.Open;
    public TicketPriority Priority { get; set; } = TicketPriority.Medium;
    public string Category { get; set; } = string.Empty;
    public string ReporterName { get; set; } = string.Empty;
    public string ReporterEmail { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ResolvedAt { get; set; }
    public DateTime? DueDate { get; set; }
    public string? Resolution { get; set; }

    // Navigation
    public Device? Device { get; set; }
    public User? AssignedTo { get; set; }
    public ICollection<RemoteSession> Sessions { get; set; } = new List<RemoteSession>();
}
