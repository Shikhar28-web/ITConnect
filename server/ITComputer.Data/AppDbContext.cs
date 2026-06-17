using ITComputer.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace ITComputer.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<DeviceMetrics> DeviceMetrics => Set<DeviceMetrics>();
    public DbSet<RemoteSession> RemoteSessions => Set<RemoteSession>();
    public DbSet<SessionRecording> SessionRecordings => Set<SessionRecording>();
    public DbSet<SessionLog> SessionLogs => Set<SessionLog>();
    public DbSet<SupportTicket> SupportTickets => Set<SupportTicket>();
    public DbSet<FileTransfer> FileTransfers => Set<FileTransfer>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<SoftwareDeployment> SoftwareDeployments => Set<SoftwareDeployment>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // User
        modelBuilder.Entity<User>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Username).IsUnique();
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Username).HasMaxLength(100).IsRequired();
            e.Property(x => x.Email).HasMaxLength(256).IsRequired();
            e.Property(x => x.PasswordHash).IsRequired();
            e.Property(x => x.FullName).HasMaxLength(200);
            e.Property(x => x.Department).HasMaxLength(100);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(50);
        });

        // Device
        modelBuilder.Entity<Device>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.MACAddress).IsUnique();
            e.HasIndex(x => x.IPAddress);
            e.Property(x => x.Hostname).HasMaxLength(255).IsRequired();
            e.Property(x => x.IPAddress).HasMaxLength(45).IsRequired();
            e.Property(x => x.MACAddress).HasMaxLength(17).IsRequired();
            e.Property(x => x.OS).HasConversion<string>().HasMaxLength(50);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(50);
            e.Property(x => x.Tags).HasMaxLength(2000).HasDefaultValue("[]");
        });

        // DeviceMetrics (one-to-one with Device)
        modelBuilder.Entity<DeviceMetrics>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Device)
             .WithOne(x => x.Metrics)
             .HasForeignKey<DeviceMetrics>(x => x.DeviceId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        // RemoteSession
        modelBuilder.Entity<RemoteSession>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Engineer)
             .WithMany(x => x.EngineerSessions)
             .HasForeignKey(x => x.EngineerId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Device)
             .WithMany(x => x.Sessions)
             .HasForeignKey(x => x.DeviceId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Ticket)
             .WithMany(x => x.Sessions)
             .HasForeignKey(x => x.TicketId)
             .OnDelete(DeleteBehavior.SetNull);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(50);
        });

        // SessionRecording (one-to-one with Session)
        modelBuilder.Entity<SessionRecording>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Session)
             .WithOne(x => x.Recording)
             .HasForeignKey<SessionRecording>(x => x.SessionId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        // SessionLog
        modelBuilder.Entity<SessionLog>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Session)
             .WithMany()
             .HasForeignKey(x => x.SessionId)
             .OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.EventType).HasMaxLength(100);
        });

        // SupportTicket
        modelBuilder.Entity<SupportTicket>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.TicketNumber).IsUnique();
            e.Property(x => x.TicketNumber).HasMaxLength(50).IsRequired();
            e.Property(x => x.Title).HasMaxLength(500).IsRequired();
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(50);
            e.Property(x => x.Priority).HasConversion<string>().HasMaxLength(50);
            e.HasOne(x => x.Device)
             .WithMany(x => x.Tickets)
             .HasForeignKey(x => x.DeviceId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.AssignedTo)
             .WithMany(x => x.AssignedTickets)
             .HasForeignKey(x => x.AssignedToId)
             .OnDelete(DeleteBehavior.SetNull);
        });

        // FileTransfer
        modelBuilder.Entity<FileTransfer>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Session)
             .WithMany(x => x.FileTransfers)
             .HasForeignKey(x => x.SessionId)
             .OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.Direction).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(50);
        });

        // ChatMessage
        modelBuilder.Entity<ChatMessage>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Session)
             .WithMany(x => x.ChatMessages)
             .HasForeignKey(x => x.SessionId)
             .OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.SenderName).HasMaxLength(200);
        });

        // Notification
        modelBuilder.Entity<Notification>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Title).HasMaxLength(500);
            e.Property(x => x.Type).HasMaxLength(100);
            e.Property(x => x.Severity).HasConversion<string>().HasMaxLength(50);
        });

        // SoftwareDeployment
        modelBuilder.Entity<SoftwareDeployment>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Device)
             .WithMany(x => x.SoftwareDeployments)
             .HasForeignKey(x => x.DeviceId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.InitiatedBy)
             .WithMany()
             .HasForeignKey(x => x.InitiatedById)
             .OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(50);
        });

        // AuditLog
        modelBuilder.Entity<AuditLog>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.User)
             .WithMany(x => x.AuditLogs)
             .HasForeignKey(x => x.UserId)
             .OnDelete(DeleteBehavior.SetNull);
            e.Property(x => x.Action).HasMaxLength(200).IsRequired();
            e.Property(x => x.Target).HasMaxLength(500);
            e.Property(x => x.Username).HasMaxLength(100);
            e.Property(x => x.IPAddress).HasMaxLength(45);
            e.HasIndex(x => x.Timestamp);
            e.HasIndex(x => x.UserId);
        });

        // Seed default SuperAdmin
        modelBuilder.Entity<User>().HasData(new User
        {
            Id = 1,
            Username = "admin",
            Email = "admin@company.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Admin@123!"),
            FullName = "System Administrator",
            Department = "IT",
            Role = UserRole.SuperAdmin,
            IsActive = true,
            CreatedAt = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc)
        });
    }
}
