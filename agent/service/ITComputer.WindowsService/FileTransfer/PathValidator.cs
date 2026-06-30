using System;
using System.IO;

namespace ITComputer.WindowsService.FileTransfer;

public static class PathValidator
{
    public static string NormalizeAndValidate(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new ArgumentException("Path cannot be empty.");

        // Normalize path separators
        string normalized = path.Replace('/', Path.DirectorySeparatorChar);

        // Resolve absolute path to remove directory traversal (e.g. C:\..\Windows)
        string fullPath = Path.GetFullPath(normalized);

        // Basic check for drive validity
        string? root = Path.GetPathRoot(fullPath);
        if (string.IsNullOrEmpty(root))
            throw new ArgumentException("Path must contain a drive letter root (e.g., C:\\).");

        return fullPath;
    }

    public static bool IsSafePath(string path)
    {
        try
        {
            NormalizeAndValidate(path);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
