using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ITComputer.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous] // Allow agent to upload and engineer to download
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
        
        // Clean up file after reading to avoid filling disk (since it's a one-off transfer)
        try
        {
            System.IO.File.Delete(filePath);
        }
        catch { /* ignore delete error */ }

        return File(bytes, "application/octet-stream", name);
    }
}
