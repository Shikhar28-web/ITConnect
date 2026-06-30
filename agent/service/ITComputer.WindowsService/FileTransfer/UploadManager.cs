using System;
using System.IO;
using System.Security.Cryptography;

namespace ITComputer.WindowsService.FileTransfer;

public class UploadManager : IDisposable
{
    private FileStream? _fileStream;
    private readonly string _filePath;
    private readonly string _tempPath;

    public UploadManager(string destinationPath, string transferId)
    {
        _filePath = PathValidator.NormalizeAndValidate(destinationPath);
        
        string tempDir = Path.Combine(Path.GetTempPath(), "ITConnectTransfers");
        if (!Directory.Exists(tempDir))
        {
            Directory.CreateDirectory(tempDir);
        }
        _tempPath = Path.Combine(tempDir, $"{transferId}.tmp");
    }

    public void WriteChunk(long offset, byte[] data, string expectedHash)
    {
        using var sha256 = SHA256.Create();
        byte[] hashBytes = sha256.ComputeHash(data);
        string actualHash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();

        if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Chunk hash mismatch! Data may be corrupted during transit.");
        }

        if (_fileStream == null)
        {
            _fileStream = new FileStream(_tempPath, FileMode.OpenOrCreate, FileAccess.Write, FileShare.None, 4096, true);
        }

        _fileStream.Seek(offset, SeekOrigin.Begin);
        _fileStream.Write(data, 0, data.Length);
    }

    public void Commit(string expectedFileHash)
    {
        _fileStream?.Dispose();
        _fileStream = null;

        if (!File.Exists(_tempPath))
            throw new FileNotFoundException("Temporary upload file was not found.");

        using (var sha256 = SHA256.Create())
        using (var stream = File.OpenRead(_tempPath))
        {
            byte[] fileHashBytes = sha256.ComputeHash(stream);
            string actualFileHash = BitConverter.ToString(fileHashBytes).Replace("-", "").ToLowerInvariant();

            if (!string.Equals(actualFileHash, expectedFileHash, StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(_tempPath);
                throw new InvalidDataException("Total file integrity verification failed.");
            }
        }

        string? targetDir = Path.GetDirectoryName(_filePath);
        if (targetDir != null && !Directory.Exists(targetDir))
        {
            Directory.CreateDirectory(targetDir);
        }

        if (File.Exists(_filePath))
        {
            File.Delete(_filePath);
        }
        File.Move(_tempPath, _filePath);
    }

    public void Cancel()
    {
        _fileStream?.Dispose();
        _fileStream = null;

        if (File.Exists(_tempPath))
        {
            try
            {
                File.Delete(_tempPath);
            }
            catch { }
        }
    }

    public void Dispose()
    {
        _fileStream?.Dispose();
    }
}
