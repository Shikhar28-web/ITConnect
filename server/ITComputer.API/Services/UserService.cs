using ITComputer.Core.DTOs;
using ITComputer.Core.Interfaces;
using ITComputer.Core.Models;
using ITComputer.Data;
using Microsoft.EntityFrameworkCore;

namespace ITComputer.API.Services;

public class UserService : IUserService
{
    private readonly AppDbContext _db;

    public UserService(AppDbContext db) => _db = db;

    public async Task<IEnumerable<UserDto>> GetAllUsersAsync()
    {
        var users = await _db.Users.OrderBy(u => u.FullName).ToListAsync();
        return users.Select(MapDto);
    }

    public async Task<UserDto?> GetUserByIdAsync(int id)
    {
        var user = await _db.Users.FindAsync(id);
        return user == null ? null : MapDto(user);
    }

    public async Task<UserDto> CreateUserAsync(CreateUserRequest request)
    {
        if (await _db.Users.AnyAsync(u => u.Username == request.Username))
            throw new InvalidOperationException($"Username '{request.Username}' is already taken.");

        if (await _db.Users.AnyAsync(u => u.Email == request.Email))
            throw new InvalidOperationException($"Email '{request.Email}' is already registered.");

        var user = new User
        {
            Username = request.Username,
            Email = request.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            FullName = request.FullName,
            Department = request.Department,
            Role = request.Role,
            Location = request.Location,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        return MapDto(user);
    }

    public async Task<UserDto> UpdateUserAsync(int id, UpdateUserRequest request)
    {
        var user = await _db.Users.FindAsync(id)
            ?? throw new KeyNotFoundException($"User {id} not found.");

        if (request.Email != null) user.Email = request.Email;
        if (request.FullName != null) user.FullName = request.FullName;
        if (request.Department != null) user.Department = request.Department;
        if (request.Role.HasValue) user.Role = request.Role.Value;
        if (request.IsActive.HasValue) user.IsActive = request.IsActive.Value;
        if (request.Location != null) user.Location = request.Location;

        await _db.SaveChangesAsync();
        return MapDto(user);
    }

    public async Task DeleteUserAsync(int id)
    {
        var user = await _db.Users.FindAsync(id)
            ?? throw new KeyNotFoundException($"User {id} not found.");

        user.IsActive = false; // Soft delete
        await _db.SaveChangesAsync();
    }

    public async Task<bool> UserExistsAsync(string username) =>
        await _db.Users.AnyAsync(u => u.Username == username);

    private static UserDto MapDto(User u) => new(
        u.Id, u.Username, u.Email, u.FullName,
        u.Department, u.Role.ToString(), u.IsActive,
        u.MFAEnabled, u.LastLoginAt, u.AvatarUrl, u.Location);
}
