using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace ITComputer.WindowsService;

public class NamedPipeIpcServer
{
    private const string PipeName = "ITComputer.ServiceIpc";
    private readonly ILogger _logger;

    private readonly List<AgentConnection> _agents = new();
    private readonly object _agentsLock = new();

    private TcpListener? _tcpListener;
    private TcpClient? _captureClient;
    private NetworkStream? _captureStream;
    private readonly object _captureLock = new();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int WTSGetActiveConsoleSessionId();

    [DllImport("sas.dll", SetLastError = true)]
    private static extern void SendSAS(bool asUser);

    private class AgentConnection
    {
        public int SessionId { get; set; } = -1;
        public NamedPipeServerStream Pipe { get; }
        public StreamWriter Writer { get; }

        public AgentConnection(NamedPipeServerStream pipe, StreamWriter writer)
        {
            Pipe = pipe;
            Writer = writer;
        }
    }

    public NamedPipeIpcServer(ILogger logger, SessionNotificationHandler handler)
    {
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken ct)
    {
        // Start TCP listener for ITComputer.ScreenCapture.exe
        _ = Task.Run(() => StartTcpListenerAsync(ct), ct);

        // Start Named Pipe listener for Electron Agents
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var pipe = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                await pipe.WaitForConnectionAsync(ct);
                _ = Task.Run(() => HandleAgentAsync(pipe, ct), ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error accepting named pipe client: {ex.Message}");
                await Task.Delay(1000, ct);
            }
        }
    }

    private async Task HandleAgentAsync(NamedPipeServerStream pipe, CancellationToken ct)
    {
        _logger.LogInformation("New Electron Agent connected via Named Pipe.");
        using var reader = new StreamReader(pipe, Encoding.UTF8);
        using var writer = new StreamWriter(pipe, Encoding.UTF8) { AutoFlush = true };

        var conn = new AgentConnection(pipe, writer);

        lock (_agentsLock)
        {
            _agents.Add(conn);
        }

        try
        {
            string? line;
            while (!ct.IsCancellationRequested && (line = await reader.ReadLineAsync(ct)) != null)
            {
                line = line.Trim();
                if (line.StartsWith("session:"))
                {
                    if (int.TryParse(line.Substring(8), out var sessId))
                    {
                        conn.SessionId = sessId;
                        _logger.LogInformation($"Agent in Session {sessId} identified.");
                    }
                }
                else if (line == "SAS")
                {
                    _logger.LogInformation("Invoking SendSAS (SYSTEM level)...");
                    try
                    {
                        SendSAS(false);
                        _logger.LogInformation("SendSAS completed.");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError($"SendSAS failed: {ex.Message}");
                    }
                }
                else if (line.StartsWith("input:"))
                {
                    string command = line.Substring(6);
                    _logger.LogInformation($"Relaying input command to ScreenCapture helper: {command}");
                    SendToCaptureHelper(command);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning($"Agent connection error in session {conn.SessionId}: {ex.Message}");
        }
        finally
        {
            lock (_agentsLock)
            {
                _agents.Remove(conn);
            }
            try { pipe.Close(); } catch { }
            _logger.LogInformation($"Agent connection from Session {conn.SessionId} closed.");
        }
    }

    private void SendToCaptureHelper(string command)
    {
        lock (_captureLock)
        {
            if (_captureStream != null)
            {
                try
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(command + "\n");
                    _captureStream.Write(bytes, 0, bytes.Length);
                    _captureStream.Flush();
                }
                catch (Exception ex)
                {
                    _logger.LogWarning($"Failed to write to capture helper: {ex.Message}");
                }
            }
            else
            {
                _logger.LogWarning("No active ScreenCapture helper connected to receive inputs.");
            }
        }
    }

    private async Task StartTcpListenerAsync(CancellationToken ct)
    {
        try
        {
            _tcpListener = new TcpListener(IPAddress.Loopback, 59300);
            _tcpListener.Start();
            _logger.LogInformation("[Service TCP] Listening for ScreenCapture on port 59300...");

            while (!ct.IsCancellationRequested)
            {
                var client = await _tcpListener.AcceptTcpClientAsync(ct);
                _logger.LogInformation("[Service TCP] ScreenCapture helper connected!");

                lock (_captureLock)
                {
                    _captureClient?.Close();
                    _captureClient = client;
                    _captureStream = client.GetStream();
                }

                _ = Task.Run(() => HandleCaptureClientAsync(client, ct), ct);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError($"[Service TCP] TCP Listener crashed: {ex.Message}");
        }
    }

    private async Task HandleCaptureClientAsync(TcpClient client, CancellationToken ct)
    {
        using var stream = client.GetStream();
        using var reader = new StreamReader(stream, Encoding.UTF8);

        try
        {
            string? line;
            while (!ct.IsCancellationRequested && (line = await reader.ReadLineAsync(ct)) != null)
            {
                // Relay desktop: and frame: lines to the active Electron Agent
                if (line.StartsWith("desktop:") || line.StartsWith("frame:"))
                {
                    SendToActiveAgent(line);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning($"[Service TCP] Capture client disconnected: {ex.Message}");
        }
        finally
        {
            lock (_captureLock)
            {
                if (_captureClient == client)
                {
                    _captureClient = null;
                    _captureStream = null;
                }
            }
        }
    }

    private void SendToActiveAgent(string data)
    {
        AgentConnection? targetAgent = null;
        int activeSession = WTSGetActiveConsoleSessionId();

        lock (_agentsLock)
        {
            // First, try to find the agent in the active console session
            targetAgent = _agents.FirstOrDefault(a => a.SessionId == activeSession);
            
            // Fallback: use the most recently connected/any available agent
            if (targetAgent == null)
            {
                targetAgent = _agents.LastOrDefault();
            }
        }

        if (targetAgent != null)
        {
            try
            {
                targetAgent.Writer.WriteLine(data);
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"Failed to send data to agent in session {targetAgent.SessionId}: {ex.Message}");
            }
        }
    }

    public void SendSessionEvent(WTS_SESSION_EVENTS eventId, int sessionId)
    {
        lock (_agentsLock)
        {
            foreach (var agent in _agents)
            {
                try
                {
                    agent.Writer.WriteLine($"{eventId} {sessionId}");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning($"Failed to send WTS session event to session {agent.SessionId}: {ex.Message}");
                }
            }
        }
    }
}
