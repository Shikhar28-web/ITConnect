using System;
using System.IO;
using System.Security.Cryptography;

namespace ITComputer.WindowsService.FileTransfer;

public class DownloadManager : IDisposable
{
    private FileStream? _fileStream;
    private readonly string _filePath;

    public DownloadManager(string path)
    {
        _filePath = PathValidator.NormalizeAndValidate(path);
        if (!File.Exists(_filePath))
            throw new FileNotFoundException($"File not found: {_filePath}");
    }

    public byte[] ReadChunk(long offset, int size, out string chunkHash)
    {
        if (_fileStream == null)
        {
            _fileStream = new FileStream(_filePath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, true);
        }

        if (offset >= _fileStream.Length)
        {
            chunkHash = string.Empty;
            return Array.Empty<byte>();
        }

        _fileStream.Seek(offset, SeekOrigin.Begin);
        int bytesToRead = (int)Math.Min(size, _fileStream.Length - offset);
        byte[] buffer = new byte[bytesToRead];
        int bytesRead = _fileStream.Read(buffer, 0, bytesToRead);

        if (bytesRead < bytesToRead)
        {
            Array.Resize(ref buffer, bytesRead);
        }

        using var sha256 = SHA256.Create();
        byte[] hashBytes = sha256.ComputeHash(buffer);
        chunkHash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();

        return buffer;
    }

    public void Dispose()
    {
        _fileStream?.Dispose();
    }
}
