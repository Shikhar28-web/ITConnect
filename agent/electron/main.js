const { app, BrowserWindow, Tray, Menu, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const { createServer } = require('http');
const axios = require('axios/dist/node/axios.cjs');

// Disable SSL/TLS validation for self-signed certificates in local/LAN environments
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-features', 'WebRtcUseDxgiCapturer,AllowWgcScreenCapturer,AllowWgcWindowCapturer,AllowWgcDesktopCapture,AllowWgcWindowCapture');

// ─── Config ──────────────────────────────────────────────────────────────────
function loadServerUrl() {
  let url = 'http://127.0.0.1:5000';
  if (process.env.SERVER_URL) {
    url = process.env.SERVER_URL;
  } else {
    const configPath = path.join(__dirname, '../config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.serverUrl) url = config.serverUrl;
      } catch (e) {
        console.warn('Failed to read config.json:', e.message);
      }
    }
  }
  if (url.includes('localhost')) {
    url = url.replace('localhost', '127.0.0.1');
  }
  return url;
}

const SERVER_URL = loadServerUrl();
const isDev = !app.isPackaged;

console.log('Connecting to server:', SERVER_URL);

let tray = null;
let mainWindow = null;
let blackoutWindows = [];
let blackoutAlwaysOnTopInterval = null;
let blackoutIgnoreTimeout = null;
let lockWindows = [];
let lockActive = false;
let privacyModeActive = false;
let inputWorker = null;
let signalRConnection = null;
let deviceId = null;
let currentEngineerConnId = null;
let secureDesktopServer = null;
let secureDesktopSocket = null;
let secureDesktopHelperProcess = null;

// UI Status tracking
let uiStatus = { connected: false, message: 'Connecting to server...', sessionActive: false, engineerName: '' };

function updateUiStatus(connected, message, sessionActive = undefined, engineerName = '') {
  uiStatus.connected = connected;
  uiStatus.message = message;
  if (sessionActive !== undefined) {
    uiStatus.sessionActive = sessionActive;
    uiStatus.engineerName = engineerName;
    try {
      if (sessionActive) {
        mainWindow?.setSize(850, 600, true);
      } else {
        mainWindow?.setSize(480, 600, true);
      }
    } catch {}
  }
  try {
    mainWindow?.webContents.send('agent-status', uiStatus);
  } catch (err) {
    // Ignore if window is not ready/destroyed
  }
}

app.isQuitting = false;
app.on('before-quit', () => {
  app.isQuitting = true;
});

// ─── App Ready ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    // Automatically enable Software SAS Generation (Ctrl+Alt+Delete simulation policy) in the registry
    exec('reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v SoftwareSASGeneration /t REG_DWORD /d 3 /f', (err) => {
      if (err) console.warn('Failed to set SoftwareSASGeneration in registry:', err.message);
      else console.log('Successfully enabled SoftwareSASGeneration in registry');
    });

    // Automatically disable Secure Desktop for UAC prompts so they can be captured and clicked remotely
    exec('reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v PromptOnSecureDesktop /t REG_DWORD /d 0 /f', (err) => {
      if (err) console.warn('Failed to disable PromptOnSecureDesktop in registry:', err.message);
      else console.log('Successfully disabled PromptOnSecureDesktop in registry');
    });

    startSecureDesktopServer();
    launchSecureDesktopHelper();
    connectServicePipe();
  }
  startInputWorker();
  createTray();
  createMainWindow();
  if (!tray) {
    mainWindow?.show();
    mainWindow?.setSkipTaskbar(false);
  }
  await registerDevice();
  await connectSignalR();
  startClipboardMonitor();
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Keep running in background
});

app.on('quit', () => {
  destroyLockWindow();
  if (process.platform === 'win32') {
    stopSecureDesktopHelper();
  }
  if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
    try {
      inputWorker.stdin.write("r\n");
      inputWorker.stdin.end();
    } catch (e) { }
  }
});

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.startsWith('https://localhost') ||
    url.startsWith('https://127.0.0.1') ||
    url.includes('192.168.') ||
    url.includes('10.') ||
    url.includes('172.')) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
  try {
    const iconPath = path.join(__dirname, '../public/tray-icon.png');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
      { label: 'IT Support Agent', enabled: false },
      { type: 'separator' },
      { label: 'Status: Connected', id: 'status', enabled: false },
      { type: 'separator' },
      { label: 'Show Window', click: () => mainWindow?.show() },
      { label: 'About', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.exit(0); } }
    ]);

    tray.setToolTip('IT Support Agent - Running');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow?.show());
  } catch (err) {
    console.warn('Failed to create system tray icon (icon file is probably missing):', err.message);
  }
}

// ─── Main Window (hidden, shows on click) ────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    show: isDev,
    skipTaskbar: !isDev,
    frame: true,
    resizable: false,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  mainWindow.loadURL(startUrl);
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

// ─── Input Worker (Persistent PowerShell Session) ──────────────────────────────
function startInputWorker() {
  if (process.platform !== 'win32') return;

  const initScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class Win32Input {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, uint dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool BlockInput(bool fBlockIt);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;

    public static void Move(int x, int y) {
        SetCursorPos(x, y);
    }

    public static void Click(int x, int y, int button) {
        SetCursorPos(x, y);
        uint down = MOUSEEVENTF_LEFTDOWN;
        uint up = MOUSEEVENTF_LEFTUP;
        if (button == 2) {
            down = MOUSEEVENTF_RIGHTDOWN;
            up = MOUSEEVENTF_RIGHTUP;
        } else if (button == 1) {
            down = MOUSEEVENTF_MIDDLEDOWN;
            up = MOUSEEVENTF_MIDDLEUP;
        }
        mouse_event(down, 0, 0, 0, 0);
        System.Threading.Thread.Sleep(15);
        mouse_event(up, 0, 0, 0, 0);
    }

    public static void MouseDown(int x, int y, int button) {
        SetCursorPos(x, y);
        uint flag = MOUSEEVENTF_LEFTDOWN;
        if (button == 2) flag = MOUSEEVENTF_RIGHTDOWN;
        else if (button == 1) flag = MOUSEEVENTF_MIDDLEDOWN;
        mouse_event(flag, 0, 0, 0, 0);
    }

    public static void MouseUp(int x, int y, int button) {
        SetCursorPos(x, y);
        uint flag = MOUSEEVENTF_LEFTUP;
        if (button == 2) flag = MOUSEEVENTF_RIGHTUP;
        else if (button == 1) flag = MOUSEEVENTF_MIDDLEUP;
        mouse_event(flag, 0, 0, 0, 0);
    }

    public static void MouseWheel(int delta) {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, 0);
    }

    [DllImport("user32.dll")]
    public static extern IntPtr CreateCursor(IntPtr hInst, int xHotSpot, int yHotSpot, int nWidth, int nHeight, byte[] pvANDPlane, byte[] pvXORPlane);

    [DllImport("user32.dll")]
    public static extern bool SetSystemCursor(IntPtr hcur, uint id);

    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern uint SetWindowDisplayAffinity(IntPtr hwnd, uint dwAffinity);

    public const uint SPI_SETCURSORS = 0x0057;
    public const uint WDA_EXCLUDEFROMCAPTURE = 0x11;

    public static readonly uint[] CursorIds = { 32512, 32513, 32514, 32515, 32516, 32642, 32643, 32644, 32645, 32646, 32648, 32649, 32650, 32651 };

    public static void HideGlobalCursor() {
        int cx = GetSystemMetrics(13); // SM_CXCURSOR
        int cy = GetSystemMetrics(14); // SM_CYCURSOR
        if (cx <= 0) cx = 32;
        if (cy <= 0) cy = 32;

        int widthInBytes = ((cx + 15) / 16) * 2;
        int numBytes = widthInBytes * cy;

        byte[] andPlane = new byte[numBytes];
        for (int i = 0; i < numBytes; i++) andPlane[i] = 0xFF;
        byte[] xorPlane = new byte[numBytes];
        for (int i = 0; i < numBytes; i++) xorPlane[i] = 0x00;
        
        foreach (uint id in CursorIds) {
            IntPtr blank = CreateCursor(IntPtr.Zero, 0, 0, cx, cy, andPlane, xorPlane);
            if (blank != IntPtr.Zero) {
                SetSystemCursor(blank, id);
            }
        }
    }

    public static void RestoreGlobalCursor() {
        SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
    }

    public static void ExcludeFromCapture(IntPtr hwnd) {
        SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);

    public const uint ES_CONTINUOUS = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED = 0x00000001;
    public const uint ES_DISPLAY_REQUIRED = 0x00000002;
    public const uint ES_AWAYMODE_REQUIRED = 0x00000040;

    public static void KeepAwake(bool enable) {
        if (enable) {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED | ES_AWAYMODE_REQUIRED);
        } else {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}
"@
Add-Type -AssemblyName System.Windows.Forms

while ($line = [Console]::ReadLine()) {
    try {
        $line = $line.Replace("\`r", "")
        $parts = $line.Split(' ')
        if ($parts[0] -eq 'm') {
            [Win32Input]::Move([int]$parts[1], [int]$parts[2])
        } elseif ($parts[0] -eq 'c') {
            [Win32Input]::Click([int]$parts[1], [int]$parts[2], [int]$parts[3])
        } elseif ($parts[0] -eq 'd') {
            [Win32Input]::MouseDown([int]$parts[1], [int]$parts[2], [int]$parts[3])
        } elseif ($parts[0] -eq 'u') {
            [Win32Input]::MouseUp([int]$parts[1], [int]$parts[2], [int]$parts[3])
        } elseif ($parts[0] -eq 'w') {
            [Win32Input]::MouseWheel([int]$parts[1])
        } elseif ($parts[0] -eq 'b') {
            [Win32Input]::BlockInput([int]$parts[1] -eq 1)
        } elseif ($parts[0] -eq 'h') {
            [Win32Input]::HideGlobalCursor()
        } elseif ($parts[0] -eq 'r') {
            [Win32Input]::RestoreGlobalCursor()
        } elseif ($parts[0] -eq 'k') {
            $keyStr = $line.Substring(2)
            [System.Windows.Forms.SendKeys]::SendWait($keyStr)
        } elseif ($parts[0] -eq 'e') {
            $hwnd = [IntPtr][long]$parts[1]
            [Win32Input]::ExcludeFromCapture($hwnd)
        } elseif ($parts[0] -eq 'a') {
            [Win32Input]::KeepAwake([int]$parts[1] -eq 1)
        }
    } catch {
        # ignore error
    }
}
[Win32Input]::RestoreGlobalCursor()
`;

  inputWorker = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-']);
  inputWorker.stdin.write(initScript + '\n');

  inputWorker.on('error', (err) => {
    console.error('Input worker error:', err);
  });

  inputWorker.on('close', (code) => {
    console.log(`Input worker exited with code ${code}`);
    inputWorker = null;
    if (!app.isQuitting) {
      console.log('Input worker exited unexpectedly. Restarting in 3 seconds...');
      setTimeout(startInputWorker, 3000);
    }
  });
}

function startSecureDesktopServer() {
  const net = require('net');
  secureDesktopServer = net.createServer((socket) => {
    console.log('Secure desktop helper connected via TCP');
    secureDesktopSocket = socket;

    socket.setEncoding('utf8');

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data;
      let lines = buffer.split('\n');
      buffer = lines.pop(); // Keep last incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('desktop:')) {
          const desktopName = trimmed.substring(8);
          if (signalRConnection && signalRConnection.state === 'Connected' && currentEngineerConnId) {
            signalRConnection.invoke('SendActiveDesktop', currentEngineerConnId, desktopName).catch(err => {
              console.error('Failed to send active desktop:', err.message);
            });
          }
        } else if (trimmed.startsWith('frame:')) {
          const base64Frame = trimmed.substring(6);
          if (signalRConnection && signalRConnection.state === 'Connected' && currentEngineerConnId) {
            signalRConnection.invoke('SendSecureDesktopFrame', currentEngineerConnId, base64Frame).catch(err => {
              console.error('Failed to send secure desktop frame:', err.message);
            });
          }
        }
      }
    });

    socket.on('close', () => {
      console.log('Secure desktop helper socket closed');
      secureDesktopSocket = null;
    });

    socket.on('error', (err) => {
      console.error('Secure desktop socket error:', err.message);
    });
  });

  secureDesktopServer.listen(59300, '127.0.0.1', () => {
    console.log('Secure desktop TCP server listening on port 59300');
  });
}

// Connect to Windows Service Named Pipe for SAS and session events
let servicePipe = null;
let servicePipeConnected = false;
const pendingIpcRequests = [];

function sendServiceIpcRequest(command) {
  return new Promise((resolve, reject) => {
    if (!servicePipe || !servicePipeConnected) {
      return reject(new Error('Windows Service named pipe is not connected.'));
    }
    pendingIpcRequests.push({ resolve, reject });
    try {
      servicePipe.write(command + '\n');
    } catch (err) {
      const index = pendingIpcRequests.findIndex(x => x.resolve === resolve);
      if (index !== -1) pendingIpcRequests.splice(index, 1);
      reject(err);
    }
  });
}

function connectServicePipe() {
  if (process.platform !== 'win32') return;
  const net = require('net');
  const pipeName = '\\\\.\\pipe\\ITComputer.ServiceIpc';
  const client = net.createConnection(pipeName);

  client.setEncoding('utf8');
  servicePipe = client;

  let buffer = '';
  client.on('connect', () => {
    if (!servicePipeConnected) {
      console.log('Connected to Windows Service Named Pipe.');
      servicePipeConnected = true;
      stopLocalSecureDesktopHelper();
    }
  });

  client.on('data', (data) => {
    buffer += data;
    let lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('WTS_') || (trimmed.indexOf(' ') !== -1 && trimmed.split(' ')[0].startsWith('WTS_'))) {
        handleServiceEvent(trimmed);
      } else {
        const req = pendingIpcRequests.shift();
        if (req) {
          req.resolve(trimmed);
        }
      }
    }
  });

  client.on('error', (err) => {
    servicePipe = null;
    if (servicePipeConnected) {
      console.warn('Service pipe connection error:', err.message);
    }
  });

  client.on('close', () => {
    servicePipe = null;
    if (servicePipeConnected) {
      console.log('Service pipe connection closed');
      servicePipeConnected = false;
    }
    while (pendingIpcRequests.length > 0) {
      const req = pendingIpcRequests.shift();
      req.resolve('ERROR|Pipe disconnected');
    }
    setTimeout(connectServicePipe, 5000);
  });
}

function handleServiceEvent(line) {
  // Session change events from Windows Service
  const knownEvents = ['WTS_SESSION_LOCK', 'WTS_SESSION_UNLOCK', 'WTS_SESSION_LOGON',
    'WTS_SESSION_LOGOFF', 'WTS_CONSOLE_CONNECT', 'WTS_CONSOLE_DISCONNECT',
    'WTS_REMOTE_CONNECT', 'WTS_REMOTE_DISCONNECT'];

  for (const ev of knownEvents) {
    if (line.startsWith(ev)) {
      const parts = line.split(' ');
      const sessionId = parseInt(parts[1]);
      console.log(`Windows Service session event: ${ev} on session ${sessionId}`);
      // Notify the admin console via SignalR
      if (signalRConnection && signalRConnection.state === 'Connected' && currentEngineerConnId) {
        signalRConnection.invoke('SendActiveDesktop', currentEngineerConnId, ev).catch(err => {
          console.error('Failed to send session event:', err.message);
        });
      }
      return;
    }
  }
}

function requestSasFromService() {
  if (servicePipe && !servicePipe.destroyed) {
    console.log('Requesting SAS from Windows Service via Named Pipe');
    servicePipe.write('SAS\n');
  } else {
    // Fallback to existing PowerShell method
    console.log('Service pipe not connected, falling back to PowerShell SAS...');
    const sasScriptPath = path.join(__dirname, 'send_sas.ps1');
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${sasScriptPath}"`);
  }
}

function launchSecureDesktopHelper() {
  if (secureDesktopHelperProcess) return;
  /*
  if (servicePipeConnected) {
    console.log('Windows Service is connected. Skipping local user-level screen capture helper.');
    return;
  }
  */

  // Use native .NET ScreenCapture exe if available (preferred), else fall back to PS1
  const nativeExePath = path.join(__dirname, '../native/ITComputer.ScreenCapture/bin/Release/net10.0-windows/win-x64/ITComputer.ScreenCapture.exe');
  const ps1Path = path.join(__dirname, 'secure_desktop_helper.ps1');
  const port = 59300;

  if (fs.existsSync(nativeExePath)) {
    console.log('Launching native DXGI screen capture process...');
    secureDesktopHelperProcess = spawn(nativeExePath, [port.toString()]);
  } else {
    console.log('Native capture not found, falling back to PowerShell helper...');
    secureDesktopHelperProcess = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', ps1Path, '-Port', port.toString()
    ]);
  }

  secureDesktopHelperProcess.on('error', (spawnErr) => {
    console.error('Failed to spawn helper child process:', spawnErr);
    secureDesktopHelperProcess = null;
  });

  secureDesktopHelperProcess.on('close', (code) => {
    console.log(`Secure desktop helper child process exited with code ${code}`);
    secureDesktopHelperProcess = null;
    if (!app.isQuitting) {
      console.log('Secure desktop helper child process exited. Restarting in 5 seconds...');
      setTimeout(launchSecureDesktopHelper, 5000);
    }
  });
}

function stopLocalSecureDesktopHelper() {
  console.log('Stopping local user-level secure desktop helper process...');
  if (secureDesktopHelperProcess) {
    try {
      secureDesktopHelperProcess.kill();
    } catch (e) {}
    secureDesktopHelperProcess = null;
  }
}

function stopSecureDesktopHelper() {
  console.log('Stopping secure desktop helper...');
  if (secureDesktopHelperProcess) {
    secureDesktopHelperProcess.kill();
    secureDesktopHelperProcess = null;
  }

  if (secureDesktopSocket) {
    secureDesktopSocket.destroy();
    secureDesktopSocket = null;
  }

  if (secureDesktopServer) {
    secureDesktopServer.close();
    secureDesktopServer = null;
  }
}

// Helper to get HWND as a safe string (handles 64-bit and 32-bit platforms)
function getHwndString(win) {
  const buf = win.getNativeWindowHandle();
  if (buf.length === 8) {
    return buf.readBigInt64LE(0).toString();
  }
  return buf.readInt32LE(0).toString();
}

// Helper functions for blackout mouse event control (allowing admin input to bypass the overlay)
function setBlackoutIgnoreMouse(ignore) {
  if (blackoutIgnoreTimeout) {
    clearTimeout(blackoutIgnoreTimeout);
    blackoutIgnoreTimeout = null;
  }
  for (const win of blackoutWindows) {
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore);
    }
  }
}

function tempAllowClickThrough() {
  if (blackoutWindows.length === 0) return;
  setBlackoutIgnoreMouse(true);
  blackoutIgnoreTimeout = setTimeout(() => {
    setBlackoutIgnoreMouse(false);
  }, 300);
}

// ─── Blackout Overlay Window ──────────────────────────────────────────────────
function createBlackoutWindow(progressInfo) {
  destroyBlackoutWindow(); // Ensure previous ones are cleaned up

  const blackoutHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Screen Blacked Out</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
          width: 100%; height: 100%;
          background: #000;
          overflow: hidden;
          cursor: none !important;
          user-select: none;
        }
        #word {
          position: absolute;
          font-family: 'Segoe UI', Arial, sans-serif;
          font-size: 48px;
          font-weight: 700;
          color: #fff;
          white-space: nowrap;
          pointer-events: none;
          cursor: none !important;
        }
      </style>
    </head>
    <body>
      <div id="word">Windows</div>
      <script>
        const el = document.getElementById('word');
        const colors = ['#ffffff', '#4A9EFF', '#7B61FF', '#00e5ff', '#ff6ec7', '#a3ff6e'];
        let x = 80, y = 80;
        let vx = 1.2, vy = 0.9;
        let ci = 0;

        function step() {
          const W = window.innerWidth;
          const H = window.innerHeight;
          const ew = el.offsetWidth;
          const eh = el.offsetHeight;

          x += vx;
          y += vy;

          let bounced = false;
          if (x + ew >= W) { x = W - ew; vx = -Math.abs(vx); bounced = true; }
          if (x <= 0)       { x = 0;       vx =  Math.abs(vx); bounced = true; }
          if (y + eh >= H)  { y = H - eh;  vy = -Math.abs(vy); bounced = true; }
          if (y <= 0)       { y = 0;       vy =  Math.abs(vy); bounced = true; }

          if (bounced) {
            ci = (ci + 1) % colors.length;
            el.style.color = colors[ci];
          }

          el.style.left = x + 'px';
          el.style.top  = y + 'px';
          requestAnimationFrame(step);
        }

        window.addEventListener('load', () => {
          el.style.left = x + 'px';
          el.style.top  = y + 'px';
          requestAnimationFrame(step);
        });

        // Block any key events on this overlay
        window.addEventListener('keydown', e => e.preventDefault(), true);
        window.addEventListener('mousedown', e => e.preventDefault(), true);
      </script>
    </body>
    </html>
  `;

  const displays = screen.getAllDisplays();
  for (const d of displays) {
    const { bounds } = d;

    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      // fullscreen: true ensures the window covers the Windows taskbar on the physical monitor.
      // setContentProtection(true) below makes this window invisible to WebRTC capture,
      // so the admin still sees the desktop underneath — only the employee's physical screen is blacked out.
      fullscreen: false,
      alwaysOnTop: true,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      transparent: false,
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    // setIgnoreMouseEvents(true) so Electron doesn't intercept admin's injected input;
    // local employee input is already blocked at OS level via BlockInput + HideGlobalCursor.
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');    // Exclude this window from screen capture so admin sees desktop underneath
    win.setContentProtection(true);

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(blackoutHtml)}`);
    win.show();

    // Force it above the taskbar shell using Win32 HWND
    if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
      const hwnd = getHwndString(win);
      inputWorker.stdin.write(`e ${hwnd}\n`);
    }

    blackoutWindows.push(win);
  }

  // Periodic z-order enforcement to ensure it covers taskbar & new windows
  if (blackoutAlwaysOnTopInterval) {
    clearInterval(blackoutAlwaysOnTopInterval);
  }
  blackoutAlwaysOnTopInterval = setInterval(() => {
    for (const win of blackoutWindows) {
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(true, 'screen-saver', 1);
        // win.moveTop();
      }
    }
  }, 200);
}

function destroyBlackoutWindow() {
  if (blackoutAlwaysOnTopInterval) {
    clearInterval(blackoutAlwaysOnTopInterval);
    blackoutAlwaysOnTopInterval = null;
  }
  if (blackoutIgnoreTimeout) {
    clearTimeout(blackoutIgnoreTimeout);
    blackoutIgnoreTimeout = null;
  }

  for (const win of blackoutWindows) {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  }
  blackoutWindows = [];

  if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
    inputWorker.stdin.write("b 0\n");
    inputWorker.stdin.write("r\n");
  }
}

// ─── Custom Lock Overlay Window ───────────────────────────────────────────────
let isClosingProgrammatically = false;

function createLockWindow() {
  destroyLockWindow(); // Ensure previous ones are cleaned up
  lockActive = true;

  const lockHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Workspace Locked</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #111827;
          background-image: radial-gradient(circle at center, #1f2937 0%, #111827 100%);
          color: #ffffff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
          user-select: none;
          overflow: hidden;
        }
        .container {
          text-align: center;
          padding: 48px;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(20px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          max-width: 480px;
          width: 90%;
          animation: scaleUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes scaleUp {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .lock-icon {
          font-size: 72px;
          margin-bottom: 24px;
          display: inline-block;
          animation: pulse 3s infinite ease-in-out;
        }
        @keyframes pulse {
          0% { transform: scale(1); filter: drop-shadow(0 0 0px rgba(59, 130, 246, 0)); }
          50% { transform: scale(1.05); filter: drop-shadow(0 0 15px rgba(59, 130, 246, 0.6)); }
          100% { transform: scale(1); filter: drop-shadow(0 0 0px rgba(59, 130, 246, 0)); }
        }
        .title {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 16px;
          letter-spacing: -0.5px;
          background: linear-gradient(135deg, #ffffff 0%, #d1d5db 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .message {
          font-size: 15px;
          color: #9ca3af;
          line-height: 1.6;
          margin-bottom: 32px;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 16px;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.2);
          color: #60a5fa;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .badge-dot {
          width: 8px;
          height: 8px;
          background-color: #3b82f6;
          border-radius: 50%;
          animation: blink 1.5s infinite;
        }
        @keyframes blink {
          0% { opacity: 0.3; }
          50% { opacity: 1; }
          100% { opacity: 0.3; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="lock-icon">🔒</div>
        <h1 class="title">Workspace Locked</h1>
        <p class="message">This workspace has been locked by the administrator. Remote maintenance is currently in progress.</p>
        <div class="badge">
          <div class="badge-dot"></div>
          IT Session Active
        </div>
      </div>
      <script>
        window.addEventListener('keydown', (e) => {
          const blockedKeys = ['Tab', 'Alt', 'Meta', 'F4', 'Escape'];
          if (blockedKeys.includes(e.key) || (e.altKey && e.key === 'F4')) {
            e.preventDefault();
            e.stopPropagation();
          }
        }, true);
      </script>
    </body>
    </html>
  `;

  const displays = screen.getAllDisplays();
  for (const d of displays) {
    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      fullscreen: false, // Keep false to prevent DWM composition from disabling (keeps WebRTC capture working!)
      alwaysOnTop: true,
      frame: false,
      skipTaskbar: true,
      thickFrame: false,
      hasShadow: false,
      focusable: true,
      transparent: false,
      backgroundColor: '#111827',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    win.on('close', (e) => {
      if (!isClosingProgrammatically) {
        e.preventDefault();
      }
    });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(lockHtml)}`);
    win.show();

    if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
      const hwnd = getHwndString(win);
      inputWorker.stdin.write(`e ${hwnd}\n`);
    }

    lockWindows.push(win);
  }

  if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
    inputWorker.stdin.write("b 1\n");
    inputWorker.stdin.write("h\n");
  }
}

function destroyLockWindow() {
  isClosingProgrammatically = true;
  for (const win of lockWindows) {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  }
  lockWindows = [];
  lockActive = false;
  isClosingProgrammatically = false;

  if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
    inputWorker.stdin.write("b 0\n");
    inputWorker.stdin.write("r\n");
  }
}

// ─── Device Registration ──────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function registerDevice() {
  while (!deviceId) {
    try {
      updateUiStatus(false, 'Registering device...');
      const networkInterfaces = os.networkInterfaces();
      let mac = 'unknown';
      let ip = '127.0.0.1';

      for (const [name, nets] of Object.entries(networkInterfaces)) {
        for (const net of nets || []) {
          if (!net.internal && net.family === 'IPv4') {
            ip = net.address;
            mac = net.mac;
            break;
          }
        }
      }

      const osVersion = os.version ? os.version() : process.platform;
      const response = await axios.post(`${SERVER_URL}/api/devices/register`, {
        hostname: os.hostname(),
        ipAddress: ip,
        macAddress: mac,
        os: os.type() + ' ' + os.release(),
        osVersion: osVersion,
        agentVersion: app.getVersion()
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.data;
        deviceId = data.id;
        console.log('Device registered with ID:', deviceId);
        updateTrayStatus('Connected');
        updateUiStatus(true, 'Registered. Connecting control channel...');
        startMetricsReporter();
        return;
      }

      console.error('Device registration failed:', response.status, response.data);
      updateUiStatus(false, `Registration failed (status ${response.status})`);
    } catch (err) {
      console.error('Device registration failed:', err.message);
      updateTrayStatus('Disconnected');
      updateUiStatus(false, `Connection failed: ${err.message}`);
    }

    console.log('Retrying registration in 10 seconds...');
    await sleep(10000);
  }
}

function updateTrayStatus(status) {
  const menu = tray?.getContextMenu();
  if (!menu) return;
  const item = menu.getMenuItemById('status');
  if (item) item.label = `Status: ${status}`;
}

// ─── Metrics Reporter ─────────────────────────────────────────────────────────
function startMetricsReporter() {
  setInterval(async () => {
    if (!deviceId) return;

    const metrics = {
      cpuUsage: await getCPUUsage(),
      ramUsage: process.memoryUsage().rss / 1024 / 1024,
      ramTotal: os.totalmem() / 1024 / 1024,
      diskUsage: 0,
      diskTotal: 0,
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      logicalCores: os.cpus().length,
      uptimeSeconds: Math.floor(os.uptime()),
      monitorCount: screen.getAllDisplays().length
    };

    try {
      await axios.post(`${SERVER_URL}/api/devices/${deviceId}/metrics`, metrics);
    } catch (e) {
      console.error('Metrics update failed:', e.response?.data || e.message);
    }
  }, 30000); // Every 30 seconds
}

function getCPUUsage() {
  return new Promise((resolve) => {
    const start = os.cpus();
    setTimeout(() => {
      const end = os.cpus();
      const idleDiff = end.reduce((acc, cpu, i) => acc + (cpu.times.idle - start[i].times.idle), 0);
      const totalDiff = end.reduce((acc, cpu, i) =>
        acc + Object.values(cpu.times).reduce((s, t) => s + t, 0)
        - Object.values(start[i].times).reduce((s, t) => s + t, 0), 0);
      resolve(100 - (idleDiff / totalDiff) * 100);
    }, 1000);
  });
}

// ─── SignalR Connection ───────────────────────────────────────────────────────
async function connectSignalR() {
  if (!deviceId) {
    console.warn('Cannot connect SignalR: device not registered yet');
    return;
  }

  const signalR = require('@microsoft/signalr/dist/cjs/index.js');

  signalRConnection = new signalR.HubConnectionBuilder()
    .withUrl(`${SERVER_URL}/hubs/remote-control?deviceId=${deviceId}`, {
      skipNegotiation: false,
      transport: signalR.HttpTransportType.WebSockets
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .configureLogging(signalR.LogLevel.Information)
    .build();

  // ─── Incoming events ─────────────────────────────────────────────────────

  signalRConnection.on('ReceiveOffer', async (engineerConnId, sdp) => {
    currentEngineerConnId = engineerConnId;
    // Forward to renderer for WebRTC answer
    mainWindow?.webContents.send('webrtc-offer', { engineerConnId, sdp });
  });

  signalRConnection.on('ReceiveIceCandidate', (candidate) => {
    mainWindow?.webContents.send('webrtc-ice', candidate);
  });

  const getScaledCoords = (x, y) => {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;
    const rx = Math.round((x / 10000) * (width - 1));
    const ry = Math.round((y / 10000) * (height - 1));
    return { rx, ry };
  };

  signalRConnection.on('MouseMove', async (x, y) => {
    const { rx, ry } = getScaledCoords(x, y);
    await injectMouseMove(rx, ry);
  });

  signalRConnection.on('MouseClick', async (x, y, button) => {
    const { rx, ry } = getScaledCoords(x, y);
    await injectMouseClick(rx, ry, button);
  });

  signalRConnection.on('MouseDown', async (x, y, button) => {
    const { rx, ry } = getScaledCoords(x, y);
    if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
      inputWorker.stdin.write(`d ${rx} ${ry} ${button}\n`);
    }
  });

  signalRConnection.on('MouseUp', async (x, y, button) => {
    const { rx, ry } = getScaledCoords(x, y);
    if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
      inputWorker.stdin.write(`u ${rx} ${ry} ${button}\n`);
    }
  });

  signalRConnection.on('MouseWheel', async (delta) => {
    if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
      inputWorker.stdin.write(`w ${delta}\n`);
    }
  });

  signalRConnection.on('KeyEvent', async (key, isDown, ctrl, alt, shift) => {
    await injectKeyEvent(key, isDown, ctrl, alt, shift);
  });

  signalRConnection.on('SetBlackout', (enabled, progressInfo) => {
    if (enabled) {
      createBlackoutWindow(progressInfo);
      if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
        inputWorker.stdin.write("b 1\n");
        inputWorker.stdin.write("h\n");
      }
    } else {
      destroyBlackoutWindow();
      if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
        inputWorker.stdin.write("b 0\n");
        inputWorker.stdin.write("r\n");
      }
    }
  });

  const handleSetPrivacyMode = (enabled) => {
    privacyModeActive = enabled;
    mainWindow?.webContents.send('set-privacy-mode', enabled);
  };
  signalRConnection.on('SetPrivacyMode', handleSetPrivacyMode);
  signalRConnection.on('setPrivacyMode', handleSetPrivacyMode);
  signalRConnection.on('setprivacymode', handleSetPrivacyMode);

  signalRConnection.on('ClipboardSync', (text) => {
    lastClipboardText = text;
    require('electron').clipboard.writeText(text);
  });

  signalRConnection.on('ExecuteCommand', async (shell, command, engineerConnId) => {
    const output = await executeShellCommand(shell, command);
    await signalRConnection.invoke('SendCommandOutput', engineerConnId, output.stdout, false);
    if (output.stderr)
      await signalRConnection.invoke('SendCommandOutput', engineerConnId, output.stderr, true);
  });

  signalRConnection.on('PowerCommand', async (command) => {
    await executePowerCommand(command);
  });

  signalRConnection.on('SecureDesktopInput', (inputJson) => {
    console.log(`[SecureDesktopInput] Received SignalR event: ${inputJson}`);
    try {
      const input = JSON.parse(inputJson);
      if (secureDesktopSocket && !secureDesktopSocket.destroyed) {
        let msg = '';
        if (input.type === 'move') {
          msg = `m ${input.x} ${input.y}\n`;
        } else if (input.type === 'click') {
          msg = `c ${input.x} ${input.y} ${input.button}\n`;
        } else if (input.type === 'mousedown') {
          msg = `d ${input.x} ${input.y} ${input.button}\n`;
        } else if (input.type === 'mouseup') {
          msg = `u ${input.x} ${input.y} ${input.button}\n`;
        } else if (input.type === 'wheel') {
          msg = `w ${input.delta}\n`;
        } else if (input.type === 'key') {
          const ctrlVal = input.ctrl ? 1 : 0;
          const altVal = input.alt ? 1 : 0;
          const shiftVal = input.shift ? 1 : 0;
          msg = `k ${input.keyCode} ${ctrlVal} ${altVal} ${shiftVal}\n`;
        }
        if (msg) {
          console.log(`[SecureDesktopInput] Writing to helper socket: ${msg.trim()}`);
          secureDesktopSocket.write(msg);
        }
      } else {
        console.warn('[SecureDesktopInput] Warning: secureDesktopSocket is not connected or is destroyed.');
      }
    } catch (e) {
      console.error('Error handling SecureDesktopInput:', e.message);
    }
  });

  signalRConnection.on('ListDirectory', async (dirPath, engineerConnId) => {
    const listing = await listDirectory(dirPath);
    await signalRConnection.invoke('SendDirectoryListing', engineerConnId, JSON.stringify(listing));
  });

  signalRConnection.on('RequestFileDownload', async (filePath, engineerConnId) => {
    console.log(`[RequestFileDownload] Initiating chunk-based download for ${filePath}`);
    const crypto = require('crypto');
    const transferId = crypto.randomUUID();
    const fileName = path.basename(filePath);
    const chunkSize = 256 * 1024; // 256 KB chunks

    let offset = 0;
    let fileHash = crypto.createHash('sha256');
    let useService = (process.platform === 'win32' && servicePipeConnected);

    let fd = null;
    let fileLength = 0;
    if (!useService) {
      try {
        if (!fs.existsSync(filePath)) {
          console.error(`File does not exist: ${filePath}`);
          return;
        }
        fd = fs.openSync(filePath, 'r');
        fileLength = fs.statSync(filePath).size;
      } catch (err) {
        console.error('Failed to open file locally:', err.message);
        return;
      }
    }

    try {
      while (true) {
        let chunkBuffer = null;
        let chunkHash = '';

        if (useService) {
          const resp = await sendServiceIpcRequest(`READ|${transferId}|${filePath}|${offset}|${chunkSize}`);
          if (resp === 'EOF') {
            break;
          }
          if (resp.startsWith('ERROR|')) {
            throw new Error(resp.substring(6));
          }
          if (resp.startsWith('OK|')) {
            const parts = resp.split('|');
            chunkHash = parts[1];
            chunkBuffer = Buffer.from(parts[2], 'base64');
          } else {
            throw new Error(`Unexpected IPC response: ${resp}`);
          }
        } else {
          if (offset >= fileLength) break;
          const readBuf = Buffer.alloc(Math.min(chunkSize, fileLength - offset));
          const bytesRead = fs.readSync(fd, readBuf, 0, readBuf.length, offset);
          if (bytesRead <= 0) break;
          chunkBuffer = readBuf.subarray(0, bytesRead);
          chunkHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex');
        }

        fileHash.update(chunkBuffer);

        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const { Blob } = require('buffer');
            const blob = new Blob([chunkBuffer]);
            const formData = new FormData();
            formData.append('transferId', transferId);
            formData.append('offset', offset.toString());
            formData.append('hash', chunkHash);
            formData.append('chunk', blob, 'chunk.bin');

            const uploadResp = await axios.post(`${SERVER_URL}/api/files/upload/chunk`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (uploadResp.status === 200) {
              success = true;
              break;
            }
          } catch (uploadErr) {
            console.warn(`Upload chunk offset ${offset} failed (attempt ${attempt}/3):`, uploadErr.message);
          }
        }

        if (!success) {
          throw new Error(`Failed to upload chunk at offset ${offset} after 3 attempts.`);
        }

        offset += chunkBuffer.length;
      }

      if (fd !== null) {
        fs.closeSync(fd);
        fd = null;
      }

      const finalHash = fileHash.digest('hex');
      const commitResp = await axios.post(`${SERVER_URL}/api/files/upload/commit`, {
        transferId: transferId,
        fileName: fileName,
        expectedHash: finalHash
      });

      if (commitResp.status === 200) {
        const { fileId, fileName: committedName } = commitResp.data;
        console.log(`[RequestFileDownload] Successfully uploaded all chunks for ${filePath}. Triggering FileDownloadReady.`);
        await signalRConnection.invoke('FileDownloadReady', engineerConnId, fileId, committedName);
      }
    } catch (e) {
      console.error('[RequestFileDownload] Chunk-based transfer failed:', e.message);
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
    }
  });

  signalRConnection.on('ReceiveFileFromAdmin', async (fileId, fileName, targetFolder, engineerConnId) => {
    console.log(`[ReceiveFileFromAdmin] Downloading file ${fileName} chunk-by-chunk...`);
    const crypto = require('crypto');
    const transferId = crypto.randomUUID();
    const targetPath = path.join(targetFolder, fileName);
    const chunkSize = 256 * 1024; // 256 KB chunks

    let offset = 0;
    let fileHash = crypto.createHash('sha256');
    let useService = (process.platform === 'win32' && servicePipeConnected);

    let fd = null;
    let localTempPath = '';
    if (!useService) {
      try {
        const tempDir = path.join(os.tmpdir(), 'ITConnectTransfers');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        localTempPath = path.join(tempDir, `${transferId}.tmp`);
        fd = fs.openSync(localTempPath, 'w');
      } catch (err) {
        console.error('Failed to initialize local temp file:', err.message);
        return;
      }
    }

    try {
      while (true) {
        let chunkBuffer = null;
        let chunkHash = '';

        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const downloadUrl = `${SERVER_URL}/api/files/download/chunk/${fileId}?offset=${offset}&size=${chunkSize}`;
            const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
            
            if (response.status === 204 || !response.data || response.data.byteLength === 0) {
              success = true;
              chunkBuffer = Buffer.alloc(0);
              break;
            }

            if (response.status === 200) {
              success = true;
              chunkBuffer = Buffer.from(response.data);
              chunkHash = response.headers['x-chunk-hash'];
              break;
            }
          } catch (err) {
            console.warn(`Download chunk offset ${offset} failed (attempt ${attempt}/3):`, err.message);
          }
        }

        if (!success) {
          throw new Error(`Failed to download chunk at offset ${offset} after 3 attempts.`);
        }

        if (chunkBuffer.length === 0) {
          break; // EOF
        }

        fileHash.update(chunkBuffer);

        if (useService) {
          const base64Data = chunkBuffer.toString('base64');
          const resp = await sendServiceIpcRequest(`WRITE|${transferId}|${targetPath}|${offset}|${chunkHash}|${base64Data}`);
          if (resp !== 'OK') {
            throw new Error(`Service chunk write failed: ${resp}`);
          }
        } else {
          fs.writeSync(fd, chunkBuffer, 0, chunkBuffer.length, offset);
        }

        offset += chunkBuffer.length;
      }

      const finalHash = fileHash.digest('hex');

      if (useService) {
        const resp = await sendServiceIpcRequest(`COMMIT|${transferId}|${finalHash}`);
        if (resp !== 'OK') {
          throw new Error(`Service commit failed: ${resp}`);
        }
      } else {
        if (fd !== null) {
          fs.closeSync(fd);
          fd = null;
        }

        const computedHash = crypto.createHash('sha256').update(fs.readFileSync(localTempPath)).digest('hex');
        if (computedHash !== finalHash) {
          fs.unlinkSync(localTempPath);
          throw new Error('Integrity check failed on downloaded local file.');
        }

        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        fs.renameSync(localTempPath, targetPath);
      }

      console.log(`[ReceiveFileFromAdmin] File download chunk-by-chunk completed successfully.`);
      mainWindow?.webContents.send('file-received-notification', { fileName, targetFolder });
      
      try {
        await axios.delete(`${SERVER_URL}/api/files/cleanup/${fileId}`);
      } catch (cleanupErr) {
        console.warn('Failed to cleanup file on server:', cleanupErr.message);
      }

      const listing = await listDirectory(targetFolder);
      await signalRConnection.invoke('SendDirectoryListing', engineerConnId, JSON.stringify(listing));
    } catch (e) {
      console.error('[ReceiveFileFromAdmin] Chunk-based upload to agent failed:', e.message);
      if (useService) {
        await sendServiceIpcRequest(`CANCEL|${transferId}`).catch(() => {});
      } else {
        if (fd !== null) {
          try { fs.closeSync(fd); } catch {}
          try { fs.unlinkSync(localTempPath); } catch {}
        }
      }
    }
  });

  signalRConnection.on('RequestClipboard', async (engineerConnId) => {
    try {
      const electron = require('electron');
      let text = '';
      let filePaths = [];

      if (process.platform === 'win32') {
        try {
          const child_process = require('child_process');
          const psOut = child_process.execSync(
            'powershell -NoProfile -Command "Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }"',
            { encoding: 'utf8' }
          );
          if (psOut && psOut.trim()) {
            filePaths = psOut.split(/\r?\n/).filter(x => x.trim() !== '');
          }
        } catch (psErr) {
          console.warn('PowerShell clipboard check failed:', psErr.message);
        }
      }

      if (filePaths.length > 0) {
        console.log('Files copied on agent clipboard:', filePaths);
        await signalRConnection.invoke('ReturnClipboard', engineerConnId, JSON.stringify({
          type: 'files',
          paths: filePaths
        }));
      } else {
        text = electron.clipboard.readText();
        await signalRConnection.invoke('ReturnClipboard', engineerConnId, text);
      }
    } catch (e) {
      console.error('RequestClipboard failed:', e.message);
    }
  });

  signalRConnection.on('GetProcessList', async (engineerConnId) => {
    const processes = await getProcessList();
    await signalRConnection.invoke('SendProcessList', engineerConnId, JSON.stringify(processes));
  });

  signalRConnection.on('KillProcess', async (pid) => {
    try { process.kill(pid); } catch (e) { /* ignore */ }
  });

  signalRConnection.on('ReadRegistry', async (keyPath, engineerConnId) => {
    if (process.platform === 'win32') {
      const data = await readRegistry(keyPath);
      await signalRConnection.invoke('SendRegistryData', engineerConnId, JSON.stringify(data));
    }
  });

  signalRConnection.on('WriteRegistry', async (keyPath, valueName, value, valueType) => {
    if (process.platform === 'win32')
      await writeRegistry(keyPath, valueName, value, valueType);
  });

  // ─── Connection lifecycle ─────────────────────────────────────────────────
  signalRConnection.onreconnected(() => {
    console.log('SignalR reconnected');
    updateTrayStatus('Connected');
    updateUiStatus(true, 'Online & Ready');
  });

  signalRConnection.onclose(() => {
    updateTrayStatus('Disconnected');
    updateUiStatus(false, 'Disconnected from control channel');
    destroyBlackoutWindow();
    destroyLockWindow();
  });

  try {
    updateUiStatus(true, 'Connecting control channel...');
    await signalRConnection.start();
    console.log('SignalR connected');
    updateTrayStatus('Connected');
    updateUiStatus(true, 'Online & Ready');
  } catch (err) {
    console.error('SignalR connection failed:', err.message);
    updateTrayStatus('Disconnected');
    updateUiStatus(false, `Control channel connection failed: ${err.message}`);
    setTimeout(connectSignalR, 10000);
  }
}

function mapKeyToSendKeys(key) {
  const specialKeys = {
    'enter': '{ENTER}',
    'tab': '{TAB}',
    'backspace': '{BACKSPACE}',
    'escape': '{ESC}',
    'insert': '{INSERT}',
    'delete': '{DEL}',
    'home': '{HOME}',
    'end': '{END}',
    'pageup': '{PGUP}',
    'pagedown': '{PGDN}',
    'arrowup': '{UP}',
    'arrowdown': '{DOWN}',
    'arrowleft': '{LEFT}',
    'arrowright': '{RIGHT}',
    'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}', 'f5': '{F5}', 'f6': '{F6}',
    'f7': '{F7}', 'f8': '{F8}', 'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
    'capslock': '{CAPSLOCK}',
    'scrolllock': '{SCROLLLOCK}',
    'numlock': '{NUMLOCK}',
    'help': '{HELP}',
    'printscreen': '{PRTSC}',
  };
  return specialKeys[key.toLowerCase()] || key;
}

// ─── Mouse/Keyboard Injection ─────────────────────────────────────────────────
async function injectMouseMove(x, y) {
  if (privacyModeActive) return;
  if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
    inputWorker.stdin.write(`m ${x} ${y}\n`);
  }
}

async function injectMouseClick(x, y, button) {
  if (privacyModeActive) return;
  if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
    inputWorker.stdin.write(`c ${x} ${y} ${button}\n`);
  }
}

async function injectKeyEvent(key, isDown, ctrl, alt, shift) {
  if (privacyModeActive) return;
  if (!isDown) return;
  if (['control', 'shift', 'alt', 'meta'].includes(key.toLowerCase())) {
    return; // Ignore modifier keys pressed on their own
  }

  let combo = '';
  if (ctrl) combo += '^';
  if (alt) combo += '%';
  if (shift) combo += '+';

  const mapped = mapKeyToSendKeys(key);
  if (mapped.length === 1 && ['+', '^', '%', '~', '{', '}', '[', ']'].includes(mapped)) {
    combo += `{${mapped}}`;
  } else {
    combo += mapped;
  }

  if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
    inputWorker.stdin.write(`k ${combo}\n`);
  }
}

// ─── Shell Command Execution ──────────────────────────────────────────────────
function executeShellCommand(shell, command) {
  return new Promise((resolve) => {
    const cmd = shell === 'powershell'
      ? `powershell -NonInteractive -Command "${command}"`
      : shell === 'bash'
        ? `bash -c "${command}"`
        : command;

    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: err?.message || stderr || '' });
    });
  });
}

// ─── Power Commands ───────────────────────────────────────────────────────────
async function executePowerCommand(command) {
  const sasScriptPath = path.join(__dirname, 'send_sas.ps1');

  // Handle Awake mode
  if (command === 'awake_on') {
    if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
      inputWorker.stdin.write("a 1\n");
    }
    return;
  }
  if (command === 'awake_off') {
    if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
      inputWorker.stdin.write("a 0\n");
    }
    return;
  }

  // Handle custom run commands
  if (command.startsWith('run:')) {
    const customCmd = command.substring(4);
    if (customCmd) {
      exec(customCmd);
    }
    return;
  }

  // Handle custom URLs
  if (command.startsWith('url:')) {
    const url = command.substring(4);
    if (url) {
      try {
        const { shell } = require('electron');
        shell.openExternal(url);
      } catch (err) {
        console.error('Failed to open URL on agent:', err.message);
      }
    }
    return;
  }

  const cmds = {
    restart: process.platform === 'win32' ? 'shutdown /r /t 10' : 'sudo shutdown -r +1',
    shutdown: process.platform === 'win32' ? 'shutdown /s /t 10' : 'sudo shutdown -h +1',
    logoff: process.platform === 'win32' ? 'logoff' : 'pkill -u $(whoami)',
    safemode: 'bcdedit /set {current} safeboot minimal && shutdown /r /t 10',
    cad: process.platform === 'win32' ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${sasScriptPath}"` : '',
    lock: process.platform === 'win32' ? 'rundll32.exe user32.dll,LockWorkStation' : '', // Custom lock overlay is toggled below, native lock is wslock
    wslock: process.platform === 'win32' ? 'rundll32.exe user32.dll,LockWorkStation' : '',
    taskmgr: process.platform === 'win32' ? 'taskmgr.exe' : '',
    cmd: process.platform === 'win32' ? 'start cmd.exe' : '',
    powershell: process.platform === 'win32' ? 'start powershell.exe' : '',
    regedit: process.platform === 'win32' ? 'regedit.exe' : '',
    devmgmt: process.platform === 'win32' ? 'devmgmt.msc' : '',
    services: process.platform === 'win32' ? 'services.msc' : '',
    eventvwr: process.platform === 'win32' ? 'eventvwr.msc' : '',
    control: process.platform === 'win32' ? 'control.exe' : '',
    msinfo32: process.platform === 'win32' ? 'msinfo32.exe' : ''
  };

  if (command === 'lock') {
    if (process.platform === 'win32') {
      if (lockActive) {
        destroyLockWindow();
      } else {
        createLockWindow();
      }
    }
    return;
  }

  if (command === 'cad') {
    if (lockActive) {
      destroyLockWindow();
    }
    requestSasFromService();
    return;
  }

  const cmd = cmds[command];
  if (cmd) exec(cmd);
}

// ─── File System ──────────────────────────────────────────────────────────────
async function listDirectory(dirPath) {
  if (process.platform === 'win32' && servicePipeConnected) {
    try {
      if (!dirPath || dirPath.trim() === '' || dirPath.toLowerCase() === 'drives') {
        const response = await sendServiceIpcRequest('DRIVES');
        if (response.startsWith('OK|')) {
          const drives = JSON.parse(response.substring(3));
          return drives.map(d => ({
            name: d,
            isDirectory: true,
            path: d,
            size: 0,
            modified: null
          }));
        }
      } else {
        const response = await sendServiceIpcRequest(`DIR|${dirPath}`);
        if (response.startsWith('OK|')) {
          const rawList = JSON.parse(response.substring(3));
          return rawList.map(item => ({
            name: item.Name ?? item.name,
            isDirectory: item.IsDirectory ?? item.isDirectory,
            path: item.Path ?? item.path,
            size: item.Size ?? item.size,
            modified: item.LastModified ?? item.modified
          }));
        } else {
          throw new Error(response.substring(6));
        }
      }
    } catch (err) {
      console.warn('Windows Service directory listing failed, falling back to local user permissions:', err.message);
    }
  }

  try {
    if (!dirPath || dirPath.trim() === '' || dirPath.toLowerCase() === 'drives') {
      if (process.platform === 'win32') {
        return [{ name: 'C:\\', isDirectory: true, path: 'C:\\', size: 0, modified: null }];
      } else {
        return [{ name: '/', isDirectory: true, path: '/', size: 0, modified: null }];
      }
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const results = [];
    for (const e of entries) {
      try {
        const fullPath = path.join(dirPath, e.name);
        let size = 0;
        let modified = null;
        let isDirectory = false;

        try {
          isDirectory = e.isDirectory();
        } catch {
          // ignore
        }

        if (!isDirectory) {
          try {
            size = fs.statSync(fullPath).size;
          } catch {
            // size remains 0 if permission is denied
          }
        }

        try {
          modified = fs.statSync(fullPath).mtime;
        } catch {
          // modified remains null if permission is denied
        }

        results.push({
          name: e.name,
          isDirectory: isDirectory,
          path: fullPath,
          size: size,
          modified: modified
        });
      } catch (err) {
        // Skip entry entirely if it fails unexpectedly
      }
    }
    return results;
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Process Management ───────────────────────────────────────────────────────
function getProcessList() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32'
      ? 'powershell -Command "Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet | ConvertTo-Json"'
      : 'ps aux --no-headers | awk \'{print "{\"pid\":" $2 ",\"name\":\"" $11 "\",\"cpu\":" $3 ",\"mem\":" $4 "}"}\' | head -100';

    exec(cmd, { timeout: 10000 }, (err, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve([]);
      }
    });
  });
}

// ─── Registry ────────────────────────────────────────────────────────────────
function readRegistry(keyPath) {
  return new Promise((resolve) => {
    exec(`reg query "${keyPath}"`, (err, stdout) => {
      resolve(err ? { error: err.message } : { data: stdout });
    });
  });
}

function writeRegistry(keyPath, valueName, value, valueType) {
  return new Promise((resolve) => {
    exec(`reg add "${keyPath}" /v "${valueName}" /t ${valueType} /d "${value}" /f`, (err) => {
      resolve(!err);
    });
  });
}

// ─── IPC: WebRTC Answer (renderer → main → SignalR) ──────────────────────────
ipcMain.handle('webrtc-answer', async (event, { engineerConnId, sdp }) => {
  await signalRConnection?.invoke('SendAnswer', engineerConnId, sdp);
});

ipcMain.handle('webrtc-ice', async (event, { targetConnId, candidate }) => {
  await signalRConnection?.invoke('SendIceCandidate', targetConnId, candidate);
});

ipcMain.handle('clipboard-get', () => {
  return require('electron').clipboard.readText();
});

ipcMain.handle('get-server-url', () => {
  return SERVER_URL;
});

ipcMain.handle('get-agent-status', () => {
  return uiStatus;
});

ipcMain.handle('get-desktop-stream-id', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources[0]?.id;
});

// ─── Auto Clipboard Sync ──────────────────────────────────────────────────────
let lastClipboardText = '';

function startClipboardMonitor() {
  setInterval(async () => {
    try {
      if (!signalRConnection || signalRConnection.state !== 'Connected' || !deviceId) return;
      const currentText = require('electron').clipboard.readText();
      if (currentText && currentText !== lastClipboardText) {
        lastClipboardText = currentText;
        console.log('Clipboard changed on agent, syncing to server...');
        await signalRConnection.invoke('AgentSyncClipboard', deviceId.toString(), currentText);
      }
    } catch (err) {
      console.warn('Clipboard auto-sync failed:', err.message);
    }
  }, 1000);
}

ipcMain.handle('list-local-directory', async (_, dirPath) => {
  return await listDirectory(dirPath);
});

ipcMain.handle('send-local-file-to-admin', async (_, filePath) => {
  if (!currentEngineerConnId) {
    throw new Error('No support session is currently active.');
  }

  console.log(`[Agent Transfer] Uploading file ${filePath} chunk-by-chunk...`);
  const crypto = require('crypto');
  const transferId = crypto.randomUUID();
  const fileName = path.basename(filePath);
  const chunkSize = 256 * 1024; // 256 KB chunks

  let offset = 0;
  let fileHash = crypto.createHash('sha256');
  let useService = (process.platform === 'win32' && servicePipeConnected);

  let fd = null;
  let fileLength = 0;
  if (!useService) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
      }
      fd = fs.openSync(filePath, 'r');
      fileLength = fs.statSync(filePath).size;
    } catch (err) {
      console.error('Failed to open file locally:', err.message);
      throw err;
    }
  }

  try {
    while (true) {
      let chunkBuffer = null;
      let chunkHash = '';

      if (useService) {
        const resp = await sendServiceIpcRequest(`READ|${transferId}|${filePath}|${offset}|${chunkSize}`);
        if (resp === 'EOF') {
          break;
        }
        if (resp.startsWith('ERROR|')) {
          throw new Error(resp.substring(6));
        }
        if (resp.startsWith('OK|')) {
          const parts = resp.split('|');
          chunkHash = parts[1];
          chunkBuffer = Buffer.from(parts[2], 'base64');
        } else {
          throw new Error(`Unexpected IPC response: ${resp}`);
        }
      } else {
        if (offset >= fileLength) break;
        const readBuf = Buffer.alloc(Math.min(chunkSize, fileLength - offset));
        const bytesRead = fs.readSync(fd, readBuf, 0, readBuf.length, offset);
        if (bytesRead <= 0) break;
        chunkBuffer = readBuf.subarray(0, bytesRead);
        chunkHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex');
      }

      fileHash.update(chunkBuffer);

      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { Blob } = require('buffer');
          const blob = new Blob([chunkBuffer]);
          const formData = new FormData();
          formData.append('transferId', transferId);
          formData.append('offset', offset.toString());
          formData.append('hash', chunkHash);
          formData.append('chunk', blob, 'chunk.bin');

          const uploadResp = await axios.post(`${SERVER_URL}/api/files/upload/chunk`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });

          if (uploadResp.status === 200) {
            success = true;
            break;
          }
        } catch (uploadErr) {
          console.warn(`Agent upload chunk offset ${offset} failed (attempt ${attempt}/3):`, uploadErr.message);
        }
      }

      if (!success) {
        throw new Error(`Failed to upload chunk at offset ${offset} after 3 attempts.`);
      }

      offset += chunkBuffer.length;
    }

    if (fd !== null) {
      fs.closeSync(fd);
      fd = null;
    }

    const finalHash = fileHash.digest('hex');
    const commitResp = await axios.post(`${SERVER_URL}/api/files/upload/commit`, {
      transferId: transferId,
      fileName: fileName,
      expectedHash: finalHash
    });

    if (commitResp.status === 200) {
      const { fileId, fileName: committedName } = commitResp.data;
      console.log(`[Agent Transfer] Successfully uploaded all chunks for ${filePath}. Triggering FileDownloadReady.`);
      await signalRConnection.invoke('FileDownloadReady', currentEngineerConnId, fileId, committedName);
      return { success: true, fileName: committedName };
    }
    throw new Error('Commit failed on server');
  } catch (e) {
    console.error('[Agent Transfer] Chunk-based transfer failed:', e.message);
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    throw e;
  }
});

