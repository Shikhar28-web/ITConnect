using System.Text.Json;
using ITComputer.Core.DTOs;
using ITComputer.Core.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace ITComputer.API.Hubs;

/// <summary>
/// Handles WebRTC signaling between the Admin Console and Remote Agent.
/// Also handles screen control commands (mouse, keyboard, clipboard).
/// </summary>
[Authorize]
public class RemoteControlHub : Hub
{
    private readonly ISessionService _sessions;
    private readonly IAuditService _audit;
    private static readonly Dictionary<string, string> _deviceConnections = new();
    private static readonly Dictionary<string, string> _engineerConnections = new();

    public RemoteControlHub(ISessionService sessions, IAuditService audit)
    {
        _sessions = sessions;
        _audit = audit;
    }

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User?.FindFirst("sub")?.Value ?? "anonymous";
        var role = Context.User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value;

        if (role == "Agent")
        {
            var deviceId = Context.GetHttpContext()?.Request.Query["deviceId"].ToString();
            if (!string.IsNullOrEmpty(deviceId))
            {
                _deviceConnections[deviceId] = Context.ConnectionId;
                await Groups.AddToGroupAsync(Context.ConnectionId, $"device_{deviceId}");
            }
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var deviceId = _deviceConnections.FirstOrDefault(kv => kv.Value == Context.ConnectionId).Key;
        if (deviceId != null) _deviceConnections.Remove(deviceId);

        var engineerId = _engineerConnections.FirstOrDefault(kv => kv.Value == Context.ConnectionId).Key;
        if (engineerId != null) _engineerConnections.Remove(engineerId);

        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>Engineer → Agent: Send WebRTC offer</summary>
    public async Task SendOffer(string deviceId, string sdp)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
        {
            await Clients.Client(agentConnId).SendAsync("ReceiveOffer", Context.ConnectionId, sdp);
        }
    }

    /// <summary>Agent → Engineer: Send WebRTC answer</summary>
    public async Task SendAnswer(string engineerConnId, string sdp)
    {
        await Clients.Client(engineerConnId).SendAsync("ReceiveAnswer", sdp);
    }

    /// <summary>Send ICE candidate to peer</summary>
    public async Task SendIceCandidate(string targetConnId, string candidate)
    {
        await Clients.Client(targetConnId).SendAsync("ReceiveIceCandidate", candidate);
    }

    /// <summary>Engineer → Agent: Mouse move event</summary>
    public async Task SendMouseMove(string deviceId, int x, int y)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("MouseMove", x, y);
    }

    /// <summary>Engineer → Agent: Mouse click event</summary>
    public async Task SendMouseClick(string deviceId, int x, int y, int button)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("MouseClick", x, y, button);
    }

    /// <summary>Engineer → Agent: Keyboard event</summary>
    public async Task SendKeyEvent(string deviceId, string key, bool isDown, bool ctrl, bool alt, bool shift)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("KeyEvent", key, isDown, ctrl, alt, shift);
    }

    /// <summary>Engineer → Agent: Set blackout mode</summary>
    public async Task SetBlackout(string deviceId, int sessionId, bool enabled, string? progressInfo)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
        {
            await _sessions.SetBlackoutModeAsync(sessionId, enabled);
            await Clients.Client(agentConnId).SendAsync("SetBlackout", enabled, progressInfo);
        }
    }

    /// <summary>Engineer → Agent: Set privacy mode</summary>
    public async Task SetPrivacyMode(string deviceId, int sessionId, bool enabled)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
        {
            await _sessions.SetPrivacyModeAsync(sessionId, enabled);
            await Clients.Client(agentConnId).SendAsync("SetPrivacyMode", enabled);
        }
    }

    /// <summary>Engineer → Agent: Clipboard sync</summary>
    public async Task SyncClipboard(string deviceId, string text)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("ClipboardSync", text);
    }

    /// <summary>Agent → Engineer: Return clipboard content</summary>
    public async Task ReturnClipboard(string engineerConnId, string text)
    {
        await Clients.Client(engineerConnId).SendAsync("ClipboardData", text);
    }

    /// <summary>Engineer → Agent: Execute remote command</summary>
    public async Task ExecuteCommand(string deviceId, int sessionId, string shell, string command)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
        {
            await _sessions.LogSessionEventAsync(sessionId, "CommandExecution",
                $"Shell: {shell}, Command: {command}");
            await Clients.Client(agentConnId).SendAsync("ExecuteCommand", shell, command, Context.ConnectionId);
        }
    }

    /// <summary>Agent → Engineer: Command output</summary>
    public async Task SendCommandOutput(string engineerConnId, string output, bool isError)
    {
        await Clients.Client(engineerConnId).SendAsync("CommandOutput", output, isError);
    }

    /// <summary>Screen annotation relay</summary>
    public async Task SendAnnotation(string deviceId, string annotationJson)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("ReceiveAnnotation", annotationJson);
    }

    /// <summary>Remote reboot/shutdown command</summary>
    public async Task SendPowerCommand(string deviceId, int sessionId, string command)
    {
        // command: restart | shutdown | logoff | safemode
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
        {
            await _sessions.LogSessionEventAsync(sessionId, "PowerCommand", command);
            await Clients.Client(agentConnId).SendAsync("PowerCommand", command);
        }
    }

    /// <summary>Remote file explorer: list directory</summary>
    public async Task ListDirectory(string deviceId, string path)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("ListDirectory", path, Context.ConnectionId);
    }

    /// <summary>Agent → Engineer: Directory listing result</summary>
    public async Task SendDirectoryListing(string engineerConnId, string jsonListing)
    {
        await Clients.Client(engineerConnId).SendAsync("DirectoryListing", jsonListing);
    }

    /// <summary>Process management: list processes</summary>
    public async Task GetProcessList(string deviceId)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("GetProcessList", Context.ConnectionId);
    }

    /// <summary>Agent → Engineer: Process list</summary>
    public async Task SendProcessList(string engineerConnId, string jsonProcesses)
    {
        await Clients.Client(engineerConnId).SendAsync("ProcessList", jsonProcesses);
    }

    /// <summary>Kill remote process</summary>
    public async Task KillProcess(string deviceId, int pid)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("KillProcess", pid);
    }

    /// <summary>Registry: read key</summary>
    public async Task ReadRegistry(string deviceId, string keyPath)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("ReadRegistry", keyPath, Context.ConnectionId);
    }

    /// <summary>Registry: write value</summary>
    public async Task WriteRegistry(string deviceId, string keyPath, string valueName, string value, string valueType)
    {
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("WriteRegistry", keyPath, valueName, value, valueType);
    }

    /// <summary>Agent → Engineer: Registry data</summary>
    public async Task SendRegistryData(string engineerConnId, string jsonData)
    {
        await Clients.Client(engineerConnId).SendAsync("RegistryData", jsonData);
    }

    public static string? GetDeviceConnectionId(string deviceId) =>
        _deviceConnections.TryGetValue(deviceId, out var id) ? id : null;
}
