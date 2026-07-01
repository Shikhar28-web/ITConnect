using System.Net;
using System.Net.Sockets;
using ITComputer.Core.DTOs;
using ITComputer.Core.Interfaces;
using ITComputer.Core.Models;
using ITComputer.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ITComputer.API.Services;

public class DeviceService : IDeviceService
{
    private readonly AppDbContext _db;
    private readonly INotificationService _notifications;
    private readonly ILogger<DeviceService> _logger;

    public DeviceService(AppDbContext db, INotificationService notifications, ILogger<DeviceService> logger)
    {
        _db = db;
        _notifications = notifications;
        _logger = logger;
    }

    public async Task<IEnumerable<DeviceDto>> GetAllDevicesAsync()
    {
        var devices = await _db.Devices
            .Include(d => d.Metrics)
            .OrderBy(d => d.Hostname)
            .ToListAsync();
        return devices.Select(MapDto);
    }

    public async Task<DeviceDto?> GetDeviceByIdAsync(int id)
    {
        var device = await _db.Devices.Include(d => d.Metrics).FirstOrDefaultAsync(d => d.Id == id);
        return device == null ? null : MapDto(device);
    }

    public async Task<DeviceDto?> GetDeviceByIPAsync(string ipAddress)
    {
        var device = await _db.Devices.Include(d => d.Metrics)
            .FirstOrDefaultAsync(d => d.IPAddress == ipAddress);
        return device == null ? null : MapDto(device);
    }

    public async Task<DeviceDto> RegisterDeviceAsync(DeviceRegistrationRequest request)
    {
        var existingByName = await _db.Devices.FirstOrDefaultAsync(d => d.Hostname == request.Hostname);
        var existingByMac = await _db.Devices.FirstOrDefaultAsync(d => d.MACAddress == request.MACAddress);

        if (existingByName != null && existingByMac != null && existingByName.Id != existingByMac.Id)
        {
            // Deduplicate (e.g. LAN vs WiFi duplicate registrations). Remove MAC-matched row to avoid unique constraint clash.
            // Before deleting the MAC-matched device, migrate all related entities to the name-matched device to satisfy foreign key constraints.
            
            // 1. Migrate Sessions
            var sessions = await _db.RemoteSessions.Where(s => s.DeviceId == existingByMac.Id).ToListAsync();
            foreach (var session in sessions)
            {
                session.DeviceId = existingByName.Id;
            }

            // 2. Migrate Tickets
            var tickets = await _db.SupportTickets.Where(t => t.DeviceId == existingByMac.Id).ToListAsync();
            foreach (var ticket in tickets)
            {
                ticket.DeviceId = existingByName.Id;
            }

            // 3. Migrate Software Deployments
            var deployments = await _db.SoftwareDeployments.Where(d => d.DeviceId == existingByMac.Id).ToListAsync();
            foreach (var deployment in deployments)
            {
                deployment.DeviceId = existingByName.Id;
            }

            // 4. Migrate Notifications
            var notifications = await _db.Notifications.Where(n => n.DeviceId == existingByMac.Id).ToListAsync();
            foreach (var notification in notifications)
            {
                notification.DeviceId = existingByName.Id;
            }

            // 5. Migrate or delete Device Metrics (One-to-One)
            var macMetrics = await _db.DeviceMetrics.FirstOrDefaultAsync(m => m.DeviceId == existingByMac.Id);
            if (macMetrics != null)
            {
                var nameMetrics = await _db.DeviceMetrics.FirstOrDefaultAsync(m => m.DeviceId == existingByName.Id);
                if (nameMetrics != null)
                {
                    _db.DeviceMetrics.Remove(macMetrics);
                }
                else
                {
                    macMetrics.DeviceId = existingByName.Id;
                }
            }

            await _db.SaveChangesAsync();

            // Now we can safely remove the MAC-matched device
            _db.Devices.Remove(existingByMac);
            await _db.SaveChangesAsync();
        }

        var existing = existingByName ?? existingByMac;

        if (existing != null)
        {
            // Update existing registration details
            existing.Hostname = request.Hostname;
            existing.IPAddress = request.IPAddress;
            existing.MACAddress = request.MACAddress;
            existing.OS = ParseOS(request.OS);
            existing.OSVersion = request.OSVersion;
            existing.AgentVersion = request.AgentVersion;
            existing.LastSeenAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return MapDto(existing);
        }

        var device = new Device
        {
            Hostname = request.Hostname,
            IPAddress = request.IPAddress,
            MACAddress = request.MACAddress,
            OS = ParseOS(request.OS),
            OSVersion = request.OSVersion,
            AgentVersion = request.AgentVersion,
            Status = DeviceStatus.Offline,
            RegisteredAt = DateTime.UtcNow
        };

        _db.Devices.Add(device);
        await _db.SaveChangesAsync();
        _logger.LogInformation("New device registered: {Hostname} ({IP})", device.Hostname, device.IPAddress);
        return MapDto(device);
    }

    public async Task UpdateDeviceMetricsAsync(int deviceId, DeviceMetricsUpdate metrics)
    {
        var existing = await _db.DeviceMetrics.FirstOrDefaultAsync(m => m.DeviceId == deviceId);
        if (existing == null)
        {
            existing = new DeviceMetrics { DeviceId = deviceId };
            _db.DeviceMetrics.Add(existing);
        }

        existing.CpuUsage = metrics.CpuUsage;
        existing.RamUsage = metrics.RamUsage;
        existing.RamTotal = metrics.RamTotal;
        existing.DiskUsage = metrics.DiskUsage;
        existing.DiskTotal = metrics.DiskTotal;
        existing.CPUModel = metrics.CPUModel;
        existing.LogicalCores = metrics.LogicalCores;
        existing.UptimeSeconds = metrics.UptimeSeconds;
        existing.MonitorCount = metrics.MonitorCount;
        existing.RecordedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        // Alert if CPU > 90%
        if (metrics.CpuUsage > 90)
            await _notifications.SendNotificationAsync("HighCPU",
                "High CPU Alert",
                $"Device CPU usage is at {metrics.CpuUsage:F1}%",
                NotificationSeverity.Warning, deviceId);

        // Alert if disk > 90%
        if (metrics.DiskTotal > 0 && (metrics.DiskUsage / metrics.DiskTotal) > 0.90)
            await _notifications.SendNotificationAsync("LowDisk",
                "Low Disk Space Alert",
                $"Device disk is {metrics.DiskUsage / metrics.DiskTotal * 100:F1}% full",
                NotificationSeverity.Warning, deviceId);
    }

    public async Task SetDeviceOnlineAsync(int deviceId, string connectionId)
    {
        var device = await _db.Devices.FindAsync(deviceId);
        if (device == null) return;

        var wasOffline = device.Status == DeviceStatus.Offline;
        device.Status = DeviceStatus.Online;
        device.SignalRConnectionId = connectionId;
        device.LastSeenAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        if (wasOffline)
            await _notifications.SendNotificationAsync("DeviceOnline",
                "Device Online", $"{device.Hostname} is now online",
                NotificationSeverity.Info, deviceId);
    }

    public async Task SetDeviceOfflineAsync(int deviceId)
    {
        var device = await _db.Devices.FindAsync(deviceId);
        if (device == null) return;

        device.Status = DeviceStatus.Offline;
        device.SignalRConnectionId = null;
        device.LastSeenAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _notifications.SendNotificationAsync("DeviceOffline",
            "Device Offline", $"{device.Hostname} went offline",
            NotificationSeverity.Warning, deviceId);
    }

    public async Task<bool> AuthorizeDeviceAsync(int deviceId)
    {
        var device = await _db.Devices.FindAsync(deviceId);
        if (device == null) return false;
        device.IsAuthorized = true;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> RevokeDeviceAuthorizationAsync(int deviceId)
    {
        var device = await _db.Devices.FindAsync(deviceId);
        if (device == null) return false;
        device.IsAuthorized = false;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task SendWakeOnLanAsync(string macAddress, string broadcastIP)
    {
        try
        {
            // Build magic packet
            var macBytes = macAddress.Split(new[] { ':', '-' })
                .Select(x => Convert.ToByte(x, 16)).ToArray();

            var packet = new byte[102];
            // 6 bytes of 0xFF
            for (int i = 0; i < 6; i++) packet[i] = 0xFF;
            // 16 repetitions of MAC
            for (int i = 1; i <= 16; i++)
                Buffer.BlockCopy(macBytes, 0, packet, i * 6, 6);

            using var client = new UdpClient();
            client.EnableBroadcast = true;
            await client.SendAsync(packet, packet.Length, new IPEndPoint(IPAddress.Parse(broadcastIP), 9));
            _logger.LogInformation("WoL magic packet sent to {MAC}", macAddress);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send WoL packet to {MAC}", macAddress);
            throw;
        }
    }

    public async Task<IEnumerable<DeviceDto>> GetOnlineDevicesAsync()
    {
        var devices = await _db.Devices.Include(d => d.Metrics)
            .Where(d => d.Status == DeviceStatus.Online || d.Status == DeviceStatus.InSession)
            .OrderBy(d => d.Hostname).ToListAsync();
        return devices.Select(MapDto);
    }

    public async Task<IEnumerable<DeviceDto>> GetOfflineDevicesAsync()
    {
        var devices = await _db.Devices.Include(d => d.Metrics)
            .Where(d => d.Status == DeviceStatus.Offline)
            .OrderBy(d => d.Hostname).ToListAsync();
        return devices.Select(MapDto);
    }

    private static DeviceOS ParseOS(string os) => os.ToLower() switch
    {
        var s when s.Contains("windows 11") => DeviceOS.Windows11,
        var s when s.Contains("windows 10") => DeviceOS.Windows10,
        var s when s.Contains("server") => DeviceOS.WindowsServer,
        var s when s.Contains("mac") => DeviceOS.MacOS,
        _ => DeviceOS.Unknown
    };

    private static DeviceDto MapDto(Device d) => new(
        d.Id, d.Hostname, d.IPAddress, d.MACAddress,
        d.OS.ToString(), d.OSVersion, d.AgentVersion,
        d.Status.ToString(), d.IsAuthorized,
        d.Location, d.Department, d.AssignedUser, d.LastSeenAt,
        d.Metrics == null ? null : new DeviceMetricsDto(
            d.Metrics.CpuUsage, d.Metrics.RamUsage, d.Metrics.RamTotal,
            d.Metrics.DiskUsage, d.Metrics.DiskTotal,
            d.Metrics.CPUModel, d.Metrics.LogicalCores,
            d.Metrics.UptimeSeconds, d.Metrics.MonitorCount,
            d.Metrics.RecordedAt),
        d.AntivirusStatus, d.AntivirusName, d.WakeOnLanEnabled);
}
