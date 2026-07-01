using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using ITComputer.Core.DTOs;
using ITComputer.Core.Interfaces;
using ITComputer.Core.Models;
using ITComputer.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using OtpNet;
using QRCoder;

namespace ITComputer.API.Services;

public class AuthService : IAuthService
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly IAuditService _audit;

    public AuthService(AppDbContext db, IConfiguration config, IAuditService audit)
    {
        _db = db;
        _config = config;
        _audit = audit;
    }

    public async Task<LoginResponse> LoginAsync(LoginRequest request, string ipAddress)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u =>
            u.Username == request.Username && u.IsActive);

        if (user == null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            await _audit.LogAsync(null, request.Username, "Login", "Authentication",
                "Invalid credentials", ipAddress, "", false, "Invalid username or password");
            throw new UnauthorizedAccessException("Invalid username or password.");
        }

        if (user.MFAEnabled)
        {
            if (string.IsNullOrEmpty(request.MFACode))
            {
                return new LoginResponse("", "", DateTime.UtcNow,
                    MapUserDto(user), RequiresMFA: true);
            }

            if (!VerifyTOTP(user.MFASecret!, request.MFACode))
            {
                await _audit.LogAsync(user.Id, user.Username, "Login", "Authentication",
                    "Invalid MFA code", ipAddress, "", false, "Invalid MFA code");
                throw new UnauthorizedAccessException("Invalid MFA code.");
            }
        }

        var accessToken = GenerateJwt(user);
        var refreshToken = GenerateRefreshToken();
        var expiry = DateTime.UtcNow.AddHours(8);

        user.RefreshToken = refreshToken;
        user.RefreshTokenExpiry = DateTime.UtcNow.AddDays(30);
        user.LastLoginAt = DateTime.UtcNow;
        user.LastLoginIP = ipAddress;
        await _db.SaveChangesAsync();

        await _audit.LogAsync(user.Id, user.Username, "Login", "Authentication",
            "Successful login", ipAddress, "", true);

        return new LoginResponse(accessToken, refreshToken, expiry, MapUserDto(user), false);
    }

    public async Task<LoginResponse> RefreshTokenAsync(string refreshToken, string ipAddress)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u =>
            u.RefreshToken == refreshToken &&
            u.RefreshTokenExpiry > DateTime.UtcNow &&
            u.IsActive);

        if (user == null)
            throw new UnauthorizedAccessException("Invalid or expired refresh token.");

        var newAccessToken = GenerateJwt(user);
        var newRefreshToken = GenerateRefreshToken();

        user.RefreshToken = newRefreshToken;
        user.RefreshTokenExpiry = DateTime.UtcNow.AddDays(30);
        await _db.SaveChangesAsync();

        return new LoginResponse(newAccessToken, newRefreshToken,
            DateTime.UtcNow.AddHours(8), MapUserDto(user), false);
    }

    public async Task LogoutAsync(int userId)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user != null)
        {
            user.RefreshToken = null;
            user.RefreshTokenExpiry = null;
            await _db.SaveChangesAsync();
        }
    }

    public async Task<MFASetupResponse> SetupMFAAsync(int userId)
    {
        var user = await _db.Users.FindAsync(userId)
            ?? throw new KeyNotFoundException("User not found.");

        var secretKey = KeyGeneration.GenerateRandomKey(20);
        var base32Secret = Base32Encoding.ToString(secretKey);
        user.MFASecret = base32Secret;
        await _db.SaveChangesAsync();

        var otpUri = $"otpauth://totp/ITComputer:{user.Username}?secret={base32Secret}&issuer=ITComputer";
        string qrBase64;
        try
        {
            using var qrGenerator = new QRCodeGenerator();
            var qrData = qrGenerator.CreateQrCode(otpUri, QRCodeGenerator.ECCLevel.Q);
            using var qrCode = new PngByteQRCode(qrData);
            var qrBytes = qrCode.GetGraphic(10);
            qrBase64 = Convert.ToBase64String(qrBytes);
        }
        catch
        {
            // Fallback: return base32 secret if QR generation fails
            qrBase64 = string.Empty;
        }

        return new MFASetupResponse(qrBase64, base32Secret);
    }

    public async Task<bool> VerifyMFAAsync(int userId, string code)
    {
        var user = await _db.Users.FindAsync(userId)
            ?? throw new KeyNotFoundException("User not found.");

        if (string.IsNullOrEmpty(user.MFASecret)) return false;

        var result = VerifyTOTP(user.MFASecret, code);
        if (result)
        {
            user.MFAEnabled = true;
            await _db.SaveChangesAsync();
        }
        return result;
    }

    public async Task<bool> DisableMFAAsync(int userId, string code)
    {
        var user = await _db.Users.FindAsync(userId)
            ?? throw new KeyNotFoundException("User not found.");

        if (!VerifyTOTP(user.MFASecret!, code)) return false;

        user.MFAEnabled = false;
        user.MFASecret = null;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task ChangePasswordAsync(int userId, ChangePasswordRequest request)
    {
        var user = await _db.Users.FindAsync(userId)
            ?? throw new KeyNotFoundException("User not found.");

        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.PasswordHash))
            throw new UnauthorizedAccessException("Current password is incorrect.");

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        user.RefreshToken = null; // Force re-login
        await _db.SaveChangesAsync();
    }

    public async Task<string> GeneratePasswordResetTokenAsync(string email)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email)
            ?? throw new KeyNotFoundException("No account found with that email.");

        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        // In production: store token with expiry and send email
        return token;
    }

    public async Task ResetPasswordAsync(string token, string newPassword)
    {
        // In production: validate token, find user, reset password
        await Task.CompletedTask;
        throw new NotImplementedException("Password reset via email not configured.");
    }

    // ─── Private Helpers ──────────────────────────────────────────────────────

    private string GenerateJwt(User user)
    {
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_config["Jwt:Key"] ?? throw new InvalidOperationException("JWT Key not configured")));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.UniqueName, user.Username),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim("email", user.Email),
            new Claim("fullName", user.FullName),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(8),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static string GenerateRefreshToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
    }

    private static bool VerifyTOTP(string base32Secret, string code)
    {
        try
        {
            var secretBytes = Base32Encoding.ToBytes(base32Secret);
            var totp = new Totp(secretBytes);
            return totp.VerifyTotp(code, out _, VerificationWindow.RfcSpecifiedNetworkDelay);
        }
        catch { return false; }
    }

    private static UserDto MapUserDto(User user) => new(
        user.Id, user.Username, user.Email, user.FullName,
        user.Department, user.Role.ToString(), user.IsActive,
        user.MFAEnabled, user.LastLoginAt, user.AvatarUrl, user.Location);
}
