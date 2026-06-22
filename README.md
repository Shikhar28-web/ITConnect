# ITComputer — Enterprise Internal Remote Support System

> Similar to AnyDesk/UltraViewer, built for internal LAN/WiFi company use.

## Architecture

```
server/          → ASP.NET Core 8 Web API + SignalR + SQL Server
agent/           → Remote Agent (Electron + React) — runs on employee machines
console/         → Admin Console (Electron + React) — runs on IT engineer machines
```

---

## Quick Start

### 1. Backend Setup

```bash
cd server

# Restore packages
dotnet restore ITComputer.sln

# Configure database (edit appsettings.json with your SQL Server connection string)
# Default: Server=localhost;Database=ITComputerDB;Trusted_Connection=True;...

# Run migrations + start server
cd ITComputer.API
dotnet run
```

**API runs at:** `http://localhost:5000` | `https://localhost:5001`  
**Swagger UI:** `http://localhost:5000/swagger`

**Default Admin:** `admin` / `Admin@123!`

---

### 2. Remote Agent Setup (Employee Machines)

```bash
cd agent
npm install
npm run electron:dev     # Development
npm run electron:build   # Build installer
```

**Point the agent at your central API server** (do NOT run `dotnet run` on employee PCs):

Edit `agent/config.json` and set your admin/server IP:

```json
{
  "serverUrl": "http://192.168.1.100:5000"
}
```

Or set the environment variable: `SERVER_URL=http://192.168.1.100:5000`

The agent will:
- Register itself with the server on startup
- Run in system tray
- Listen for connection requests from IT engineers
- Handle screen blackout, input injection, and file transfers

---

### 3. Admin Console Setup (IT Engineer Machines)

```bash
cd console
npm install
npm run electron:dev     # Development
npm run electron:build   # Build installer
```

---

## Features Implemented

| Feature | Status |
|---------|--------|
| Remote Desktop Control (WebRTC H.264) | ✅ |
| Mouse/Keyboard Injection | ✅ |
| Screen Blackout Mode + Company Logo | ✅ |
| Privacy Mode | ✅ |
| JWT Authentication + MFA (TOTP) | ✅ |
| Device Authorization | ✅ |
| Role-Based Access Control | ✅ |
| Live Chat (SignalR) | ✅ |
| Remote Terminal (PowerShell/CMD/Bash) | ✅ |
| Remote File Explorer | ✅ |
| Process Manager (view/kill) | ✅ |
| Remote Registry Editor (Windows) | ✅ |
| Screen Annotation Tools | ✅ |
| Clipboard Sync | ✅ |
| Wake-on-LAN | ✅ |
| Remote Reboot/Shutdown/Logoff | ✅ |
| Session Recording | ✅ |
| Support Ticket Integration | ✅ |
| Audit Logs (Tamper-Evident Chain) | ✅ |
| Real-time Notifications (SignalR) | ✅ |
| Monitoring Dashboard | ✅ |
| Device Metrics (CPU/RAM/Disk) | ✅ |
| Engineer Performance Reports | ✅ |
| Device Health Reports | ✅ |
| User Management | ✅ |
| Session History | ✅ |
| AES-256 WebRTC Encryption | ✅ |
| TLS 1.3 (via HTTPS) | ✅ |

---

## Database

SQL Server — auto-migrated on startup.

Tables: `Users`, `Devices`, `DeviceMetrics`, `RemoteSessions`, `SessionRecordings`, `SessionLogs`, `SupportTickets`, `FileTransfers`, `ChatMessages`, `Notifications`, `SoftwareDeployments`, `AuditLogs`

---

## Security

- **TLS 1.3** — All API traffic
- **AES-256** — WebRTC data channels
- **JWT** — 8-hour access tokens + 30-day refresh
- **TOTP MFA** — Google Authenticator compatible
- **RBAC** — SuperAdmin / Admin / Engineer / ReadOnly
- **Device Authorization** — Devices must be approved before connection
- **Audit Logs** — SHA-256 integrity chain (tamper-evident)
- **Session Recording** — Encrypted at rest

---

## Deployment

### Windows Installer
```bash
cd agent && npm run electron:build    # Creates agent-setup.exe
cd console && npm run electron:build  # Creates console-setup.exe
```

### Server Deployment
```bash
cd server/ITComputer.API
dotnet publish -c Release -o ./publish
# Deploy ./publish to IIS or as Windows Service
```

---

## API Documentation

Swagger: `http://localhost:5000/swagger`

Key endpoints:
- `POST /api/auth/login` — Login
- `GET /api/devices` — All devices
- `POST /api/sessions/start` — Start remote session
- `GET /api/reports/dashboard` — Dashboard stats
- `WS /hubs/remote-control` — WebRTC signaling
- `WS /hubs/notifications` — Real-time alerts
- `WS /hubs/chat` — Session chat

---

## Support

Contact the IT Department for issues with this system.
