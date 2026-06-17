namespace ITComputer.Core.Models;

public enum DeviceOS
{
    Windows10,
    Windows11,
    WindowsServer,
    MacOS,
    Unknown
}

public enum DeviceStatus
{
    Online,
    Offline,
    InSession,
    Maintenance,
    Unauthorized
}

public class Device
{
    public int Id { get; set; }
    public string Hostname { get; set; } = string.Empty;
    public string IPAddress { get; set; } = string.Empty;
    public string MACAddress { get; set; } = string.Empty;
    public DeviceOS OS { get; set; } = DeviceOS.Unknown;
    public string OSVersion { get; set; } = string.Empty;
    public string AgentVersion { get; set; } = string.Empty;
    public DeviceStatus Status { get; set; } = DeviceStatus.Offline;
    public bool IsAuthorized { get; set; } = false;
    public string Location { get; set; } = string.Empty;
    public string Department { get; set; } = string.Empty;
    public string AssignedUser { get; set; } = string.Empty;
    public DateTime RegisteredAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastSeenAt { get; set; }
    public string? SignalRConnectionId { get; set; }
    public bool WakeOnLanEnabled { get; set; } = false;
    public bool BlackoutMode { get; set; } = false;
    public string? AntivirusStatus { get; set; }
    public string? AntivirusName { get; set; }
    public string Tags { get; set; } = string.Empty; // JSON array of tags

    // Navigation
    public ICollection<RemoteSession> Sessions { get; set; } = new List<RemoteSession>();
    public ICollection<SupportTicket> Tickets { get; set; } = new List<SupportTicket>();
    public ICollection<SoftwareDeployment> SoftwareDeployments { get; set; } = new List<SoftwareDeployment>();
    public DeviceMetrics? Metrics { get; set; }
}

public class DeviceMetrics
{
    public int Id { get; set; }
    public int DeviceId { get; set; }
    public double CpuUsage { get; set; }
    public double RamUsage { get; set; }
    public double RamTotal { get; set; }
    public double DiskUsage { get; set; }
    public double DiskTotal { get; set; }
    public string CPUModel { get; set; } = string.Empty;
    public int LogicalCores { get; set; }
    public long UptimeSeconds { get; set; }
    public int MonitorCount { get; set; }
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;

    public Device? Device { get; set; }
}
