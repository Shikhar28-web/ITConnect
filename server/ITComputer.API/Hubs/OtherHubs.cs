using ITComputer.Core.DTOs;
using ITComputer.Core.Interfaces;
using ITComputer.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace ITComputer.API.Hubs;

[Authorize]
public class NotificationHub : Hub
{
    private readonly INotificationService _notifications;

    public NotificationHub(INotificationService notifications) => _notifications = notifications;

    public override async Task OnConnectedAsync()
    {
        var role = Context.User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value;
        if (role is "Admin" or "SuperAdmin" or "Engineer")
            await Groups.AddToGroupAsync(Context.ConnectionId, "engineers");

        await base.OnConnectedAsync();
    }

    public async Task GetUnreadNotifications()
    {
        var userIdStr = Context.User?.FindFirst("sub")?.Value;
        if (!int.TryParse(userIdStr, out var userId)) return;
        var notifications = await _notifications.GetUserNotificationsAsync(userId, unreadOnly: true);
        await Clients.Caller.SendAsync("UnreadNotifications", notifications);
    }

    public async Task MarkRead(int notificationId)
    {
        await _notifications.MarkNotificationReadAsync(notificationId);
    }

    public async Task MarkAllRead()
    {
        var userIdStr = Context.User?.FindFirst("sub")?.Value;
        if (!int.TryParse(userIdStr, out var userId)) return;
        await _notifications.MarkAllNotificationsReadAsync(userId);
    }
}

[Authorize]
public class ChatHub : Hub
{
    private readonly AppDbContext _db;

    public ChatHub(AppDbContext db) => _db = db;

    public async Task JoinSession(int sessionId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"chat_{sessionId}");
    }

    public async Task LeaveSession(int sessionId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"chat_{sessionId}");
    }

    public async Task SendMessage(int sessionId, string message, string? attachmentName)
    {
        var userIdStr = Context.User?.FindFirst("sub")?.Value;
        var username = Context.User?.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value ?? "User";
        var isEngineer = Context.User?.IsInRole("Engineer") == true ||
                         Context.User?.IsInRole("Admin") == true ||
                         Context.User?.IsInRole("SuperAdmin") == true;

        var chatMsg = new Core.Models.ChatMessage
        {
            SessionId = sessionId,
            SenderName = username,
            IsEngineer = isEngineer,
            Message = message,
            AttachmentName = attachmentName,
            SentAt = DateTime.UtcNow
        };

        _db.ChatMessages.Add(chatMsg);
        await _db.SaveChangesAsync();

        await Clients.Group($"chat_{sessionId}").SendAsync("ReceiveMessage", new ChatMessageDto(
            chatMsg.Id, chatMsg.SenderName, chatMsg.IsEngineer,
            chatMsg.Message, chatMsg.AttachmentName,
            chatMsg.SentAt, chatMsg.IsRead));
    }

    public async Task SendTypingIndicator(int sessionId, bool isTyping)
    {
        var username = Context.User?.FindFirst("name")?.Value ?? "User";
        await Clients.OthersInGroup($"chat_{sessionId}")
            .SendAsync("TypingIndicator", username, isTyping);
    }
}
