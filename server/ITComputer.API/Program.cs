using System.Text;
using ITComputer.API.Hubs;
using ITComputer.API.Middleware;
using ITComputer.API.Services;
using ITComputer.Core.Interfaces;
using ITComputer.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// ─── Serilog ────────────────────────────────────────────────────────────────
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .WriteTo.File("logs/itcomputer-.log", rollingInterval: RollingInterval.Day)
    .CreateLogger();
builder.Host.UseSerilog();

// ─── Database ────────────────────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(
        builder.Configuration.GetConnectionString("DefaultConnection")));

// ─── Authentication (JWT) ────────────────────────────────────────────────────
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("JWT Key not configured.");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.Zero
        };

        // Support JWT via SignalR query string
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) &&
                    (path.StartsWithSegments("/hubs")))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            },
            OnTokenValidated = context =>
            {
                var claimsIdentity = context.Principal?.Identity as System.Security.Claims.ClaimsIdentity;
                if (claimsIdentity != null)
                {
                    var nameIdClaim = claimsIdentity.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier);
                    if (nameIdClaim != null && !claimsIdentity.HasClaim(c => c.Type == "sub"))
                    {
                        claimsIdentity.AddClaim(new System.Security.Claims.Claim("sub", nameIdClaim.Value));
                    }
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// ─── SignalR ─────────────────────────────────────────────────────────────────
builder.Services.AddSignalR(opts =>
{
    opts.EnableDetailedErrors = builder.Environment.IsDevelopment();
    opts.MaximumReceiveMessageSize = 50 * 1024 * 1024; // 50MB for file chunks
});

// ─── CORS ────────────────────────────────────────────────────────────────────
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.SetIsOriginAllowed(origin => true)
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials());
});

// ─── Services ────────────────────────────────────────────────────────────────
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<IDeviceService, DeviceService>();
builder.Services.AddScoped<ISessionService, SessionService>();
builder.Services.AddScoped<INotificationService, NotificationService>();
builder.Services.AddScoped<IAuditService, AuditService>();
builder.Services.AddScoped<ITicketService, TicketService>();
builder.Services.AddScoped<IReportService, ReportService>();

// ─── Controllers + Swagger ───────────────────────────────────────────────────
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "ITComputer Remote Support API",
        Version = "v1",
        Description = "Enterprise Remote Support System API"
    });

    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        In = ParameterLocation.Header,
        Description = "Enter: Bearer {token}",
        Name = "Authorization",
        Type = SecuritySchemeType.ApiKey
    });

    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

// ─── HTTP Client for WoL ─────────────────────────────────────────────────────
builder.Services.AddHttpClient();

var app = builder.Build();

// ─── Auto-migrate on startup ─────────────────────────────────────────────────
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.EnsureCreatedAsync();

    // Auto-migrate SQLite schema
    try
    {
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Users\" ADD COLUMN \"Location\" TEXT DEFAULT ''");
    }
    catch {}

    try
    {
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""DeviceGroups"" (
                ""Id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                ""Name"" TEXT NOT NULL,
                ""DeviceIds"" TEXT NOT NULL DEFAULT '[]',
                ""AllowedUserIds"" TEXT NOT NULL DEFAULT '[]'
            );
        ");
    }
    catch {}
}

// ─── Middleware Pipeline ─────────────────────────────────────────────────────
// Always enable Swagger for debugging and API interaction
app.UseSwagger();
app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "ITComputer API v1"));

app.UseMiddleware<GlobalExceptionMiddleware>();
app.UseSerilogRequestLogging();
app.UseHttpsRedirection();
app.UseCors("AllowAll");
app.UseWebSockets();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

// ─── SignalR Hubs ─────────────────────────────────────────────────────────────
app.MapHub<RemoteControlHub>("/hubs/remote-control");
app.MapHub<NotificationHub>("/hubs/notifications");
app.MapHub<ChatHub>("/hubs/chat");

app.Run();
