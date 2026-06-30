using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using System.Collections.Generic;
using System.Text.Json;
using ITComputer.WindowsService.FileTransfer;

namespace ITComputer.WindowsService;

public class NamedPipeIpcServer
{
    private const string PipeName = "ITComputer.ServiceIpc";
    private readonly ILogger _logger;
    private StreamWriter? _pipeWriter;
    private readonly object _writeLock = new();

    private readonly FileExplorerService _explorer = new();
    private readonly Dictionary<string, DownloadManager> _downloads = new();
    private readonly Dictionary<string, UploadManager> _uploads = new();

    [DllImport("sas.dll", SetLastError = true)]
    private static extern void SendSAS(bool asUser);

    public NamedPipeIpcServer(ILogger logger, SessionNotificationHandler handler)
    {
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                _logger.LogInformation("Waiting for Electron Agent to connect via Named Pipe...");
                await pipe.WaitForConnectionAsync(ct);
                _logger.LogInformation("Electron Agent connected via Named Pipe.");

                using var reader = new StreamReader(pipe);
                var writer = new StreamWriter(pipe) { AutoFlush = true };

                lock (_writeLock)
                {
                    _pipeWriter = writer;
                }

                string? line;
                while ((line = await reader.ReadLineAsync(ct)) != null)
                {
                    _logger.LogInformation($"Received pipe command length: {line.Length}");
                    try
                    {
                        var response = ProcessCommand(line);
                        if (response != null)
                        {
                            await writer.WriteLineAsync(response.AsMemory(), ct);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError($"Error executing IPC command: {ex.Message}");
                        await writer.WriteLineAsync($"ERROR|{ex.Message}".AsMemory(), ct);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"Named pipe server error or client disconnected: {ex.Message}");
            }
            finally
            {
                lock (_writeLock)
                {
                    _pipeWriter = null;
                }
            }

            await Task.Delay(1000, ct);
        }
    }

    private string? ProcessCommand(string line)
    {
        string trimmed = line.Trim();
        if (trimmed == "SAS")
        {
            _logger.LogInformation("Invoking SendSAS (SYSTEM level)...");
            SendSAS(false);
            return "OK";
        }

        var parts = trimmed.Split('|');
        if (parts.Length == 0) return "ERROR|Empty command";

        string cmd = parts[0];

        if (cmd == "DRIVES")
        {
            var drives = _explorer.GetDrives();
            return "OK|" + JsonSerializer.Serialize(drives);
        }

        if (cmd == "DIR")
        {
            if (parts.Length < 2) return "ERROR|Missing path";
            string path = parts[1];
            var listing = _explorer.ListDirectory(path);
            return "OK|" + JsonSerializer.Serialize(listing);
        }

        if (cmd == "READ")
        {
            // READ|[transferId]|[path]|[offset]|[size]
            if (parts.Length < 5) return "ERROR|Missing parameters for READ";
            string transferId = parts[1];
            string path = parts[2];
            long offset = long.Parse(parts[3]);
            int size = int.Parse(parts[4]);

            if (!_downloads.TryGetValue(transferId, out var dm))
            {
                dm = new DownloadManager(path);
                _downloads[transferId] = dm;
            }

            string hash;
            byte[] chunk = dm.ReadChunk(offset, size, out hash);
            if (chunk.Length == 0)
            {
                dm.Dispose();
                _downloads.Remove(transferId);
                return "EOF";
            }

            string base64 = Convert.ToBase64String(chunk);
            return $"OK|{hash}|{base64}";
        }

        if (cmd == "WRITE")
        {
            // WRITE|[transferId]|[path]|[offset]|[expectedHash]|[base64Data]
            if (parts.Length < 6) return "ERROR|Missing parameters for WRITE";
            string transferId = parts[1];
            string path = parts[2];
            long offset = long.Parse(parts[3]);
            string expectedHash = parts[4];
            string base64Data = parts[5];

            if (!_uploads.TryGetValue(transferId, out var um))
            {
                um = new UploadManager(path, transferId);
                _uploads[transferId] = um;
            }

            byte[] data = Convert.FromBase64String(base64Data);
            um.WriteChunk(offset, data, expectedHash);
            return "OK";
        }

        if (cmd == "COMMIT")
        {
            // COMMIT|[transferId]|[expectedFileHash]
            if (parts.Length < 3) return "ERROR|Missing parameters for COMMIT";
            string transferId = parts[1];
            string expectedFileHash = parts[2];

            if (_uploads.TryGetValue(transferId, out var um))
            {
                um.Commit(expectedFileHash);
                um.Dispose();
                _uploads.Remove(transferId);
                return "OK";
            }
            return "ERROR|Upload session not found";
        }

        if (cmd == "CANCEL")
        {
            // CANCEL|[transferId]
            if (parts.Length < 2) return "ERROR|Missing transferId";
            string transferId = parts[1];

            if (_uploads.TryGetValue(transferId, out var um))
            {
                um.Cancel();
                um.Dispose();
                _uploads.Remove(transferId);
            }
            return "OK";
        }

        return "ERROR|Unknown command";
    }

    public void SendSessionEvent(WTS_SESSION_EVENTS eventId, int sessionId)
    {
        lock (_writeLock)
        {
            if (_pipeWriter != null)
            {
                try
                {
                    // e.g. "WTS_SESSION_LOCK 1"
                    _pipeWriter.WriteLine($"{eventId} {sessionId}");
                    _logger.LogInformation($"Sent WTS session event to client: {eventId} {sessionId}");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning($"Failed to send WTS session event via Named Pipe: {ex.Message}");
                }
            }
        }
    }
}
