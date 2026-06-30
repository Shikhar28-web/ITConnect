using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;

namespace ITComputer.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class FilesController : ControllerBase
{
    private static readonly string TempDir = Path.Combine(Directory.GetCurrentDirectory(), "temp_files");

    static FilesController()
    {
        if (!Directory.Exists(TempDir))
        {
            Directory.CreateDirectory(TempDir);
        }
    }

    [HttpPost("upload")]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest("No file uploaded.");

        var fileId = Guid.NewGuid().ToString();
        var filePath = Path.Combine(TempDir, fileId);

        using (var stream = new FileStream(filePath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        return Ok(new { fileId, fileName = file.FileName });
    }

    [HttpGet("download/{fileId}")]
    public IActionResult Download(string fileId, [FromQuery] string name)
    {
        var filePath = Path.Combine(TempDir, fileId);
        if (!System.IO.File.Exists(filePath))
            return NotFound("File not found or expired.");

        var bytes = System.IO.File.ReadAllBytes(filePath);
        
        try
        {
            System.IO.File.Delete(filePath);
        }
        catch { /* ignore delete error */ }

        return File(bytes, "application/octet-stream", name);
    }

    [HttpPost("upload/chunk")]
    public async Task<IActionResult> UploadChunk(
        [FromForm] string transferId,
        [FromForm] long offset,
        [FromForm] string hash,
        IFormFile chunk)
    {
        if (chunk == null || chunk.Length == 0)
            return BadRequest("Empty chunk");

        string tempPath = Path.Combine(TempDir, $"{transferId}.tmp");

        using var memoryStream = new MemoryStream();
        await chunk.CopyToAsync(memoryStream);
        byte[] data = memoryStream.ToArray();

        using (var sha256 = SHA256.Create())
        {
            byte[] computedBytes = sha256.ComputeHash(data);
            string computedHash = BitConverter.ToString(computedBytes).Replace("-", "").ToLowerInvariant();

            if (!string.Equals(computedHash, hash, StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest("Chunk integrity check failed. Hash mismatch.");
            }
        }

        lock (string.Intern(transferId))
        {
            using var fileStream = new FileStream(tempPath, FileMode.OpenOrCreate, FileAccess.Write, FileShare.ReadWrite);
            fileStream.Seek(offset, SeekOrigin.Begin);
            fileStream.Write(data, 0, data.Length);
        }

        return Ok();
    }

    public class CommitRequest
    {
        public string TransferId { get; set; } = string.Empty;
        public string FileName { get; set; } = string.Empty;
        public string ExpectedHash { get; set; } = string.Empty;
    }

    [HttpPost("upload/commit")]
    public async Task<IActionResult> CommitUpload([FromBody] CommitRequest request)
    {
        string tempPath = Path.Combine(TempDir, $"{request.TransferId}.tmp");
        if (!System.IO.File.Exists(tempPath))
            return NotFound("Temp upload session not found");

        using (var sha256 = SHA256.Create())
        using (var stream = System.IO.File.OpenRead(tempPath))
        {
            byte[] fileHashBytes = sha256.ComputeHash(stream);
            string actualFileHash = BitConverter.ToString(fileHashBytes).Replace("-", "").ToLowerInvariant();

            if (!string.Equals(actualFileHash, request.ExpectedHash, StringComparison.OrdinalIgnoreCase))
            {
                System.IO.File.Delete(tempPath);
                return BadRequest("Total file integrity check failed.");
            }
        }

        string fileId = Guid.NewGuid().ToString();
        string finalPath = Path.Combine(TempDir, fileId);
        System.IO.File.Move(tempPath, finalPath);

        return Ok(new { fileId, fileName = request.FileName });
    }

    [HttpGet("download/chunk/{fileId}")]
    public IActionResult DownloadChunk(string fileId, [FromQuery] long offset, [FromQuery] int size)
    {
        string filePath = Path.Combine(TempDir, fileId);
        if (!System.IO.File.Exists(filePath))
            return NotFound("File not found");

        var fileInfo = new FileInfo(filePath);
        if (offset >= fileInfo.Length)
        {
            return NoContent();
        }

        int bytesToRead = (int)Math.Min(size, fileInfo.Length - offset);
        byte[] buffer = new byte[bytesToRead];

        using (var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            fileStream.Seek(offset, SeekOrigin.Begin);
            int bytesRead = fileStream.Read(buffer, 0, bytesToRead);
            if (bytesRead < bytesToRead)
            {
                Array.Resize(ref buffer, bytesRead);
            }
        }

        using var sha256 = SHA256.Create();
        byte[] hashBytes = sha256.ComputeHash(buffer);
        string hash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();

        Response.Headers.Append("X-Chunk-Hash", hash);
        return File(buffer, "application/octet-stream");
    }

    [HttpDelete("cleanup/{fileId}")]
    public IActionResult Cleanup(string fileId)
    {
        string filePath = Path.Combine(TempDir, fileId);
        if (System.IO.File.Exists(filePath))
        {
            try
            {
                System.IO.File.Delete(filePath);
                return Ok();
            }
            catch (Exception ex)
            {
                return StatusCode(500, ex.Message);
            }
        }
        return NotFound();
    }
}
