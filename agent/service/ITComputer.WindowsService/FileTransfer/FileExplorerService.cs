using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace ITComputer.WindowsService.FileTransfer;

public class FileExplorerService
{
    public List<string> GetDrives()
    {
        return DriveInfo.GetDrives()
            .Where(d => d.IsReady)
            .Select(d => d.Name)
            .ToList();
    }

    public List<FileEntry> ListDirectory(string rawPath)
    {
        string safePath = PathValidator.NormalizeAndValidate(rawPath);
        if (!Directory.Exists(safePath))
            throw new DirectoryNotFoundException($"Directory not found: {safePath}");

        var entries = new List<FileEntry>();

        foreach (string entryPath in Directory.EnumerateFileSystemEntries(safePath))
        {
            try
            {
                var isDirectory = Directory.Exists(entryPath);
                var info = new FileInfo(entryPath);

                entries.Add(new FileEntry
                {
                    Name = Path.GetFileName(entryPath),
                    Path = entryPath,
                    IsDirectory = isDirectory,
                    Size = isDirectory ? 0 : info.Length,
                    LastModified = info.LastWriteTimeUtc
                });
            }
            catch (Exception)
            {
                // Skip entries we cannot access
            }
        }

        return entries;
    }
}

public class FileEntry
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public bool IsDirectory { get; set; }
    public long Size { get; set; }
    public DateTime LastModified { get; set; }
}
