using ITComputer.Core.DTOs;
using ITComputer.Core.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ITComputer.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DevicesController : ControllerBase
{
    private readonly IDeviceService _devices;

    public DevicesController(IDeviceService devices) => _devices = devices;

    [HttpGet]
    public async Task<IActionResult> GetAll() => Ok(await _devices.GetAllDevicesAsync());

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var device = await _devices.GetDeviceByIdAsync(id);
        return device == null ? NotFound() : Ok(device);
    }

    [HttpGet("online")]
    public async Task<IActionResult> GetOnline() => Ok(await _devices.GetOnlineDevicesAsync());

    [HttpGet("offline")]
    public async Task<IActionResult> GetOffline() => Ok(await _devices.GetOfflineDevicesAsync());

    [HttpGet("ip/{ipAddress}")]
    public async Task<IActionResult> GetByIP(string ipAddress)
    {
        var device = await _devices.GetDeviceByIPAsync(ipAddress);
        return device == null ? NotFound() : Ok(device);
    }

    [HttpPost("register")]
    [AllowAnonymous] // Agent registers without auth
    public async Task<IActionResult> Register([FromBody] DeviceRegistrationRequest request)
    {
        var device = await _devices.RegisterDeviceAsync(request);
        return Ok(device);
    }

    [HttpPost("{id}/metrics")]
    [AllowAnonymous] // Agent updates metrics
    public async Task<IActionResult> UpdateMetrics(int id, [FromBody] DeviceMetricsUpdate metrics)
    {
        await _devices.UpdateDeviceMetricsAsync(id, metrics);
        return Ok();
    }

    [HttpPost("{id}/authorize")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> Authorize(int id)
    {
        var result = await _devices.AuthorizeDeviceAsync(id);
        return result ? Ok(new { message = "Device authorized." }) : NotFound();
    }

    [HttpPost("{id}/revoke")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> Revoke(int id)
    {
        var result = await _devices.RevokeDeviceAuthorizationAsync(id);
        return result ? Ok(new { message = "Authorization revoked." }) : NotFound();
    }

    [HttpPost("wol")]
    [Authorize(Roles = "SuperAdmin,Admin,Engineer")]
    public async Task<IActionResult> WakeOnLan([FromBody] WolRequest request)
    {
        await _devices.SendWakeOnLanAsync(request.MacAddress, request.BroadcastIP);
        return Ok(new { message = "Wake-on-LAN packet sent." });
    }
}

public record WolRequest(string MacAddress, string BroadcastIP);

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class SessionsController : ControllerBase
{
    private readonly ISessionService _sessions;

    public SessionsController(ISessionService sessions) => _sessions = sessions;

    [HttpGet]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> GetAll(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to)
        => Ok(await _sessions.GetAllSessionsAsync(from, to));

    [HttpGet("active")]
    public async Task<IActionResult> GetActive() => Ok(await _sessions.GetActiveSessionsAsync());

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var session = await _sessions.GetSessionByIdAsync(id);
        return session == null ? NotFound() : Ok(session);
    }

    [HttpGet("device/{deviceId}")]
    public async Task<IActionResult> GetByDevice(int deviceId)
        => Ok(await _sessions.GetSessionsByDeviceAsync(deviceId));

    [HttpGet("engineer/{engineerId}")]
    public async Task<IActionResult> GetByEngineer(int engineerId)
        => Ok(await _sessions.GetSessionsByEngineerAsync(engineerId));

    [HttpPost("start")]
    [Authorize(Roles = "SuperAdmin,Admin,Engineer")]
    public async Task<IActionResult> Start([FromBody] StartSessionRequest request)
    {
        try
        {
            var engineerId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
            var session = await _sessions.StartSessionAsync(engineerId, request);
            return Ok(session);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("end")]
    [Authorize(Roles = "SuperAdmin,Admin,Engineer")]
    public async Task<IActionResult> End([FromBody] EndSessionRequest request)
    {
        try
        {
            var session = await _sessions.EndSessionAsync(request.SessionId, request);
            return Ok(session);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpGet("{id}/recording")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> GetRecording(int id)
    {
        var bytes = await _sessions.GetRecordingAsync(id);
        return bytes == null
            ? NotFound(new { message = "Recording not found." })
            : File(bytes, "video/webm", $"session_{id}.webm");
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TicketsController : ControllerBase
{
    private readonly ITicketService _tickets;

    public TicketsController(ITicketService tickets) => _tickets = tickets;

    [HttpGet]
    public async Task<IActionResult> GetAll() => Ok(await _tickets.GetAllTicketsAsync());

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var ticket = await _tickets.GetTicketByIdAsync(id);
        return ticket == null ? NotFound() : Ok(ticket);
    }

    [HttpGet("device/{deviceId}")]
    public async Task<IActionResult> GetByDevice(int deviceId)
        => Ok(await _tickets.GetTicketsByDeviceAsync(deviceId));

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateTicketRequest request)
    {
        var ticket = await _tickets.CreateTicketAsync(request);
        return CreatedAtAction(nameof(GetById), new { id = ticket.Id }, ticket);
    }

    [HttpPut("{id}")]
    [Authorize(Roles = "SuperAdmin,Admin,Engineer")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateTicketRequest request)
    {
        try
        {
            return Ok(await _tickets.UpdateTicketAsync(id, request));
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        try
        {
            await _tickets.DeleteTicketAsync(id);
            return NoContent();
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "SuperAdmin,Admin")]
public class AuditLogsController : ControllerBase
{
    private readonly IAuditService _audit;

    public AuditLogsController(IAuditService audit) => _audit = audit;

    [HttpGet]
    public async Task<IActionResult> GetLogs(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? userId,
        [FromQuery] string? action)
        => Ok(await _audit.GetLogsAsync(from, to, userId, action));
}

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "SuperAdmin,Admin,Engineer")]
public class ReportsController : ControllerBase
{
    private readonly IReportService _reports;

    public ReportsController(IReportService reports) => _reports = reports;

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard() => Ok(await _reports.GetDashboardStatsAsync());

    [HttpGet("engineer-performance")]
    public async Task<IActionResult> EngineerPerformance(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to)
        => Ok(await _reports.GetEngineerPerformanceReportAsync(from, to));

    [HttpGet("device-health")]
    public async Task<IActionResult> DeviceHealth(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to)
        => Ok(await _reports.GetDeviceHealthReportAsync(from, to));
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class NotificationsController : ControllerBase
{
    private readonly INotificationService _notifications;

    public NotificationsController(INotificationService notifications) => _notifications = notifications;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] bool unreadOnly = false)
    {
        var userId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
        return Ok(await _notifications.GetUserNotificationsAsync(userId, unreadOnly));
    }

    [HttpPost("{id}/read")]
    public async Task<IActionResult> MarkRead(int id)
    {
        await _notifications.MarkNotificationReadAsync(id);
        return Ok();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllRead()
    {
        var userId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
        await _notifications.MarkAllNotificationsReadAsync(userId);
        return Ok();
    }
}
