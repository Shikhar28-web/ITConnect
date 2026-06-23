using System.Security.Claims;
using ITComputer.Core.Interfaces;
using Microsoft.AspNetCore.SignalR;

namespace ITComputer.API.Hubs;

/// <summary>
/// Handles WebRTC signaling between the Admin Console and Remote Agent.
/// Also handles screen control commands (mouse, keyboard, clipboard).
/// Agents connect anonymously with ?deviceId=; engineers connect with JWT.
/// </summary>
public class RemoteControlHub : Hub
{
    private readonly ISessionService _sessions;
    private readonly IDeviceService _devices;
    private static readonly Dictionary<string, string> _deviceConnections = new();
    private static readonly Dictionary<string, string> _engineerConnections = new();

    public RemoteControlHub(ISessionService sessions, IDeviceService devices)
    {
        _sessions = sessions;
        _devices = devices;
    }

    public override async Task OnConnectedAsync()
    {
        var deviceIdStr = Context.GetHttpContext()?.Request.Query["deviceId"].ToString();

        if (!string.IsNullOrEmpty(deviceIdStr) && int.TryParse(deviceIdStr, out var deviceId))
        {
            var device = await _devices.GetDeviceByIdAsync(deviceId);
            if (device != null)
            {
                _deviceConnections[deviceIdStr] = Context.ConnectionId;
                await Groups.AddToGroupAsync(Context.ConnectionId, $"device_{deviceIdStr}");
                await _devices.SetDeviceOnlineAsync(deviceId, Context.ConnectionId);
            }
        }
        else if (Context.User?.Identity?.IsAuthenticated == true)
        {
            var userId = Context.User.FindFirst("sub")?.Value;
            if (userId != null)
                _engineerConnections[userId] = Context.ConnectionId;
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var deviceIdStr = _deviceConnections.FirstOrDefault(kv => kv.Value == Context.ConnectionId).Key;
        if (deviceIdStr != null)
        {
            _deviceConnections.Remove(deviceIdStr);
            if (int.TryParse(deviceIdStr, out var deviceId))
                await _devices.SetDeviceOfflineAsync(deviceId);
        }

        var engineerId = _engineerConnections.FirstOrDefault(kv => kv.Value == Context.ConnectionId).Key;
        if (engineerId != null) _engineerConnections.Remove(engineerId);

        await base.OnDisconnectedAsync(exception);
    }

    private void EnsureEngineer()
    {
        if (Context.User?.Identity?.IsAuthenticated != true)
            throw new HubException("Unauthorized");

        var role = Context.User.FindFirst(ClaimTypes.Role)?.Value;
        if (role is not ("SuperAdmin" or "Admin" or "Engineer"))
            throw new HubException("Unauthorized");
    }

    /// <summary>Engineer → Agent: Send WebRTC offer</summary>
    public async Task SendOffer(string deviceId, string sdp)
    {
        EnsureEngineer();
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
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("MouseMove", x, y);
    }

    /// <summary>Engineer → Agent: Mouse click event</summary>
    public async Task SendMouseClick(string deviceId, int x, int y, int button)
    {
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("MouseClick", x, y, button);
    }

    /// <summary>Engineer → Agent: Keyboard event</summary>
    public async Task SendKeyEvent(string deviceId, string key, bool isDown, bool ctrl, bool alt, bool shift)
    {
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("KeyEvent", key, isDown, ctrl, alt, shift);
    }

    /// <summary>Engineer → Agent: Set blackout mode</summary>
    public async Task SetBlackout(string deviceId, int sessionId, bool enabled, string? progressInfo)
    {
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
        {
            await _sessions.SetBlackoutModeAsync(sessionId, enabled);
            await Clients.Client(agentConnId).SendAsync("SetBlackout", enabled, progressInfo);
        }
    }

    /// <summary>Engineer → Agent: Set privacy mode</summary>
    public async Task SetPrivacyMode(string deviceId, int sessionId, bool enabled)
    {
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
        {
            await _sessions.SetPrivacyModeAsync(sessionId, enabled);
            await Clients.Client(agentConnId).SendAsync("SetPrivacyMode", enabled);
        }
    }

    /// <summary>Engineer → Agent: Clipboard sync</summary>
    public async Task SyncClipboard(string deviceId, string text)
    {
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("ClipboardSync", text);
    }

    /// <summary>Engineer → Agent: Request clipboard content</summary>
    public async Task RequestClipboard(string deviceId)
    {
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("RequestClipboard", Context.ConnectionId);
    }

    /// <summary>Agent → Engineer: Return clipboard content</summary>
    public async Task ReturnClipboard(string engineerConnId, string text)
    {
        await Clients.Client(engineerConnId).SendAsync("ClipboardData", text);
    }

    /// <summary>Engineer → Agent: Execute remote command</summary>
    public async Task ExecuteCommand(string deviceId, int sessionId, string shell, string command)
    {
        EnsureEngineer();
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
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("ReceiveAnnotation", annotationJson);
    }

    /// <summary>Remote reboot/shutdown command</summary>
    public async Task SendPowerCommand(string deviceId, int sessionId, string command)
    {
        EnsureEngineer();
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
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("ListDirectory", path, Context.ConnectionId);
    }

    /// <summary>Agent → Engineer: Directory listing result</summary>
    public async Task SendDirectoryListing(string engineerConnId, string jsonListing)
    {
        await Clients.Client(engineerConnId).SendAsync("DirectoryListing", jsonListing);
    }

    /// <summary>Engineer → Agent: Request a file download</summary>
    public async Task RequestFileDownload(string deviceId, string filePath)
    {
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("RequestFileDownload", filePath, Context.ConnectionId);
    }

    /// <summary>Agent → Engineer: Notify file is available for download</summary>
    public async Task FileDownloadReady(string engineerConnId, string fileId, string fileName)
    {
        await Clients.Client(engineerConnId).SendAsync("FileDownloadReady", fileId, fileName);
    }

    /// <summary>Process management: list processes</summary>
    public async Task GetProcessList(string deviceId)
    {
        EnsureEngineer();
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
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("KillProcess", pid);
    }

    /// <summary>Registry: read key</summary>
    public async Task ReadRegistry(string deviceId, string keyPath)
    {
        EnsureEngineer();
        if (_deviceConnections.TryGetValue(deviceId, out var agentConnId))
            await Clients.Client(agentConnId).SendAsync("ReadRegistry", keyPath, Context.ConnectionId);
    }

    /// <summary>Registry: write value</summary>
    public async Task WriteRegistry(string deviceId, string keyPath, string valueName, string value, string valueType)
    {
        EnsureEngineer();
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
