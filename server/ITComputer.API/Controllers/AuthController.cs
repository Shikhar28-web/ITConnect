using ITComputer.Core.DTOs;
using ITComputer.Core.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ITComputer.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _auth;

    public AuthController(IAuthService auth) => _auth = auth;

    /// <summary>Login with username, password, and optional MFA code</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        try
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var result = await _auth.LoginAsync(request, ip);
            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { message = ex.Message });
        }
    }

    /// <summary>Refresh access token using refresh token</summary>
    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<IActionResult> Refresh([FromBody] RefreshTokenRequest request)
    {
        try
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var result = await _auth.RefreshTokenAsync(request.RefreshToken, ip);
            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { message = ex.Message });
        }
    }

    /// <summary>Logout and invalidate refresh token</summary>
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        var userId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
        await _auth.LogoutAsync(userId);
        return Ok(new { message = "Logged out successfully." });
    }

    /// <summary>Setup MFA — returns QR code</summary>
    [HttpPost("mfa/setup")]
    [Authorize]
    public async Task<IActionResult> SetupMFA()
    {
        var userId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
        var result = await _auth.SetupMFAAsync(userId);
        return Ok(result);
    }

    /// <summary>Verify and enable MFA with TOTP code</summary>
    [HttpPost("mfa/verify")]
    [Authorize]
    public async Task<IActionResult> VerifyMFA([FromBody] string code)
    {
        var userId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
        var success = await _auth.VerifyMFAAsync(userId, code);
        return success ? Ok(new { message = "MFA enabled." }) : BadRequest(new { message = "Invalid code." });
    }

    /// <summary>Disable MFA</summary>
    [HttpPost("mfa/disable")]
    [Authorize]
    public async Task<IActionResult> DisableMFA([FromBody] string code)
    {
        var userId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
        var success = await _auth.DisableMFAAsync(userId, code);
        return success ? Ok(new { message = "MFA disabled." }) : BadRequest(new { message = "Invalid code." });
    }

    /// <summary>Change password</summary>
    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
    {
        try
        {
            var userId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
            await _auth.ChangePasswordAsync(userId, request);
            return Ok(new { message = "Password changed successfully." });
        }
        catch (UnauthorizedAccessException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly IUserService _users;

    public UsersController(IUserService users) => _users = users;

    [HttpGet]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> GetAll() => Ok(await _users.GetAllUsersAsync());

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var user = await _users.GetUserByIdAsync(id);
        return user == null ? NotFound() : Ok(user);
    }

    [HttpPost]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest request)
    {
        try
        {
            var user = await _users.CreateUserAsync(request);
            return CreatedAtAction(nameof(GetById), new { id = user.Id }, user);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpPut("{id}")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateUserRequest request)
    {
        try
        {
            return Ok(await _users.UpdateUserAsync(id, request));
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = "SuperAdmin")]
    public async Task<IActionResult> Delete(int id)
    {
        try
        {
            await _users.DeleteUserAsync(id);
            return NoContent();
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpGet("me")]
    public async Task<IActionResult> GetMe()
    {
        var userId = int.Parse(User.FindFirst("sub")?.Value ?? "0");
        var user = await _users.GetUserByIdAsync(userId);
        return user == null ? NotFound() : Ok(user);
    }
}
