namespace ITComputer.Core.Models;

public enum UserRole
{
    SuperAdmin,
    Admin,
    Engineer,
    ReadOnly
}

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string Department { get; set; } = string.Empty;
    public UserRole Role { get; set; } = UserRole.Engineer;
    public bool IsActive { get; set; } = true;
    public bool MFAEnabled { get; set; } = false;
    public string? MFASecret { get; set; }
    public string? RefreshToken { get; set; }
    public DateTime? RefreshTokenExpiry { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
    public string? LastLoginIP { get; set; }
    public string? AvatarUrl { get; set; }
    public string? PhoneNumber { get; set; }

    // Navigation
    public ICollection<RemoteSession> EngineerSessions { get; set; } = new List<RemoteSession>();
    public ICollection<AuditLog> AuditLogs { get; set; } = new List<AuditLog>();
    public ICollection<SupportTicket> AssignedTickets { get; set; } = new List<SupportTicket>();
}
