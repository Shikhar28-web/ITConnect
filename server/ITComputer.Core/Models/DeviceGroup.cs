namespace ITComputer.Core.Models;

public class DeviceGroup
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string DeviceIds { get; set; } = "[]"; // JSON array of device IDs (ints)
    public string AllowedUserIds { get; set; } = "[]"; // JSON array of user IDs (ints)
}
