using ITComputer.Core.DTOs;
using ITComputer.Core.Models;
using ITComputer.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ITComputer.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DeviceGroupsController : ControllerBase
{
    private readonly AppDbContext _db;

    public DeviceGroupsController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var userId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
        var role = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

        var groups = await _db.DeviceGroups.ToListAsync();

        if (role == "SuperAdmin")
        {
            return Ok(groups.Select(MapDto));
        }

        // Regular users: only see groups where they are in AllowedUserIds
        var filtered = groups.Where(g =>
        {
            try
            {
                var allowed = JsonSerializer.Deserialize<List<int>>(g.AllowedUserIds) ?? new List<int>();
                return allowed.Contains(userId);
            }
            catch { return false; }
        });

        return Ok(filtered.Select(MapDto));
    }

    [HttpPost]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> Create([FromBody] CreateGroupRequest request)
    {
        var group = new DeviceGroup
        {
            Name = request.Name,
            DeviceIds = "[]",
            AllowedUserIds = "[]"
        };
        _db.DeviceGroups.Add(group);
        await _db.SaveChangesAsync();
        return Ok(MapDto(group));
    }

    [HttpPut("{id}")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateGroupRequest request)
    {
        var group = await _db.DeviceGroups.FindAsync(id);
        if (group == null) return NotFound();

        if (request.Name != null) group.Name = request.Name;
        if (request.DeviceIds != null) group.DeviceIds = JsonSerializer.Serialize(request.DeviceIds);
        if (request.AllowedUserIds != null) group.AllowedUserIds = JsonSerializer.Serialize(request.AllowedUserIds);

        await _db.SaveChangesAsync();
        return Ok(MapDto(group));
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var group = await _db.DeviceGroups.FindAsync(id);
        if (group == null) return NotFound();

        _db.DeviceGroups.Remove(group);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private static DeviceGroupDto MapDto(DeviceGroup g)
    {
        List<int> deviceIds;
        List<int> allowedUserIds;
        try
        {
            deviceIds = JsonSerializer.Deserialize<List<int>>(g.DeviceIds) ?? new List<int>();
        }
        catch
        {
            deviceIds = new List<int>();
        }

        try
        {
            allowedUserIds = JsonSerializer.Deserialize<List<int>>(g.AllowedUserIds) ?? new List<int>();
        }
        catch
        {
            allowedUserIds = new List<int>();
        }

        return new DeviceGroupDto(g.Id, g.Name, deviceIds, allowedUserIds);
    }
}
