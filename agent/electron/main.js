const { app, BrowserWindow, Tray, Menu, ipcMain, screen, desktopCapturer, powerMonitor } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const { createServer } = require('http');
const axios = require('axios/dist/node/axios.cjs');

// Disable SSL/TLS validation for self-signed certificates in local/LAN environments
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
app.commandLine.appendSwitch('ignore-certificate-errors');

// ─── Config ──────────────────────────────────────────────────────────────────
function loadServerUrl() {
  if (process.env.SERVER_URL) return process.env.SERVER_URL;

  const configPath = path.join(__dirname, '../config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.serverUrl) return config.serverUrl;
    } catch (e) {
      console.warn('Failed to read config.json:', e.message);
    }
  }

  return 'http://localhost:5000';
}

const SERVER_URL = loadServerUrl();
const isDev = !app.isPackaged;

console.log('Connecting to server:', SERVER_URL);

let tray = null;
let mainWindow = null;
let blackoutWindows = [];
let lockWindows = [];
let lockActive = false;
let privacyModeActive = false;
let inputWorker = null;
let signalRConnection = null;
let deviceId = null;
let isSessionLocked = false;
let lockScreenCaptureInterval = null;

// UI Status tracking
let uiStatus = { connected: false, message: 'Connecting to server...', sessionActive: false, engineerName: '' };

function updateUiStatus(connected, message, sessionActive = undefined, engineerName = '') {
  uiStatus.connected = connected;
  uiStatus.message = message;
  if (sessionActive !== undefined) {
    uiStatus.sessionActive = sessionActive;
    uiStatus.engineerName = engineerName;
  }
  try {
    mainWindow?.webContents.send('agent-status', uiStatus);
  } catch (err) {
    // Ignore if window is not ready/destroyed
  }
}

// ─── App Ready ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    // Ensure SoftwareSASGeneration policy allows software-initiated Ctrl+Alt+Del
    exec('reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v SoftwareSASGeneration /t REG_DWORD /d 3 /f', (err) => {
      if (err) console.warn('SoftwareSASGeneration registry set failed (need admin):', err.message);
      else console.log('SoftwareSASGeneration registry policy set to 3.');
    });
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

  if (process.platform === 'win32') {
    powerMonitor.on('lock-screen', () => {
      console.log('System lock detected');
      isSessionLocked = true;
      startLockScreenCaptureLoop();
      // Notify the renderer so it can display lock overlay in admin console
      mainWindow?.webContents.send('lock-status-changed', true);
    });

    powerMonitor.on('unlock-screen', () => {
      console.log('System unlock detected');
      isSessionLocked = false;
      stopLockScreenCaptureLoop();
      mainWindow?.webContents.send('lock-status-changed', false);
    });
  }
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Keep running in background
});

app.on('quit', () => {
  destroyLockWindow();
  if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
    try {
      inputWorker.stdin.write("r\n");
      inputWorker.stdin.end();
    } catch (e) {}
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
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;

public class Win32Input {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, uint dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool BlockInput(bool fBlockIt);

    [DllImport("sas.dll", SetLastError = true)]
    public static extern void SendSAS(bool asUser);

    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint SPI_SETCURSORS = 0x0057;

    private const uint DESKTOP_WRITEOBJECTS = 0x0080;
    private const uint DESKTOP_READOBJECTS = 0x0001;
    private const uint DESKTOP_CREATEMENU = 0x0004;
    private const uint DESKTOP_HOOKCONTROL = 0x0008;
    private const uint DESKTOP_JOURNALRECORD = 0x0010;
    private const uint DESKTOP_JOURNALPLAYBACK = 0x0020;
    private const uint DESKTOP_ENUMERATE = 0x0040;
    private const uint DESKTOP_SWITCHDESKTOP = 0x0100;

    private const uint ALL_ACCESS = DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | DESKTOP_CREATEMENU | 
                                    DESKTOP_HOOKCONTROL | DESKTOP_JOURNALRECORD | DESKTOP_JOURNALPLAYBACK | 
                                    DESKTOP_ENUMERATE | DESKTOP_SWITCHDESKTOP;

    private static void Execute(Action action) {
        Thread t = new Thread(() => {
            IntPtr hInput = OpenInputDesktop(0, false, ALL_ACCESS);
            if (hInput != IntPtr.Zero) {
                if (SetThreadDesktop(hInput)) {
                    try {
                        action();
                    } catch {}
                }
                CloseDesktop(hInput);
            } else {
                try { action(); } catch {}
            }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
    }

    public static void Move(int x, int y) {
        Execute(() => { SetCursorPos(x, y); });
    }

    public static void Click(int x, int y, int button) {
        Execute(() => {
            SetCursorPos(x, y);
            uint down = MOUSEEVENTF_LEFTDOWN, up = MOUSEEVENTF_LEFTUP;
            if (button == 2) { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
            else if (button == 1) { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
            mouse_event(down, 0, 0, 0, 0);
            Thread.Sleep(15);
            mouse_event(up, 0, 0, 0, 0);
        });
    }

    public static void MouseDown(int x, int y, int button) {
        Execute(() => {
            SetCursorPos(x, y);
            uint flag = MOUSEEVENTF_LEFTDOWN;
            if (button == 2) flag = MOUSEEVENTF_RIGHTDOWN;
            else if (button == 1) flag = MOUSEEVENTF_MIDDLEDOWN;
            mouse_event(flag, 0, 0, 0, 0);
        });
    }

    public static void MouseUp(int x, int y, int button) {
        Execute(() => {
            SetCursorPos(x, y);
            uint flag = MOUSEEVENTF_LEFTUP;
            if (button == 2) flag = MOUSEEVENTF_RIGHTUP;
            else if (button == 1) flag = MOUSEEVENTF_MIDDLEUP;
            mouse_event(flag, 0, 0, 0, 0);
        });
    }

    public static void MouseWheel(int delta) {
        Execute(() => {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, 0);
        });
    }

    public static void SetBlockInput(bool block) {
        Execute(() => {
            BlockInput(block);
        });
    }

    public static void RestoreGlobalCursor() {
        Execute(() => {
            SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
        });
    }

    public static void SendKeysWait(string keys) {
        Execute(() => {
            try {
                SendKeys.SendWait(keys);
            } catch {}
        });
    }

    public static void SendCad() {
        Execute(() => {
            try {
                SendSAS(false);
            } catch {
                keybd_event(0x11, 0, 0, 0); // Ctrl Down
                keybd_event(0x12, 0, 0, 0); // Alt Down
                keybd_event(0x2E, 0, 1, 0); // Delete Down
                Thread.Sleep(100);
                keybd_event(0x2E, 0, 1 | 2, 0); // Delete Up
                keybd_event(0x12, 0, 2, 0); // Alt Up
                keybd_event(0x11, 0, 2, 0); // Ctrl Up
            }
        });
    }

    public static void CaptureScreen(string filePath) {
        Execute(() => {
            try {
                int width = Screen.PrimaryScreen.Bounds.Width;
                int height = Screen.PrimaryScreen.Bounds.Height;
                using (Bitmap bmp = new Bitmap(width, height)) {
                    using (Graphics g = Graphics.FromImage(bmp)) {
                        g.CopyFromScreen(0, 0, 0, 0, bmp.Size);
                    }
                    bmp.Save(filePath, ImageFormat.Jpeg);
                }
            } catch {}
        });
    }
}
"@ -ReferencedAssemblies System.Windows.Forms, System.Drawing

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
            [Win32Input]::SetBlockInput([int]$parts[1] -eq 1)
        } elseif ($parts[0] -eq 'r') {
            [Win32Input]::RestoreGlobalCursor()
        } elseif ($parts[0] -eq 'k') {
            $keyStr = $line.Substring(2)
            [Win32Input]::SendKeysWait($keyStr)
        } elseif ($parts[0] -eq 'cad') {
            [Win32Input]::SendCad()
        } elseif ($parts[0] -eq 'capture') {
            $path = $line.Substring(8)
            [Win32Input]::CaptureScreen($path)
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

  inputWorker.on('exit', () => {
    console.warn('Input worker exited unexpectedly, restarting...');
    inputWorker = null;
    setTimeout(startInputWorker, 2000);
  });
}

// ─── Blackout Overlay Window ──────────────────────────────────────────────────
function createBlackoutWindow(progressInfo) {
  destroyBlackoutWindow(); // Ensure previous ones are cleaned up

  const blackoutHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; cursor: none !important; }
        body {
          background: #000;
          color: #fff;
          overflow: hidden;
          height: 100vh;
          width: 100vw;
          position: relative;
          cursor: none !important;
        }
        #screensaver {
          position: absolute;
          font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
          font-size: 32px;
          font-weight: 300;
          color: #555555;
          white-space: nowrap;
          user-select: none;
          text-shadow: 0 0 8px rgba(255,255,255,0.15);
        }
      </style>
    </head>
    <body>
      <div id="screensaver">Windows</div>
      <script>
        const el = document.getElementById('screensaver');
        let w = window.innerWidth;
        let h = window.innerHeight;
        let x = Math.random() * (w - 200);
        let y = Math.random() * (h - 50);
        let dx = 1.5;
        let dy = 1.5;
        
        function update() {
          w = window.innerWidth;
          h = window.innerHeight;
          const rect = el.getBoundingClientRect();
          
          if (x + rect.width >= w || x <= 0) {
            dx = -dx;
          }
          if (y + rect.height >= h || y <= 0) {
            dy = -dy;
          }
          
          x += dx;
          y += dy;
          
          el.style.left = x + 'px';
          el.style.top = y + 'px';
          
          requestAnimationFrame(update);
        }
        
        window.addEventListener('resize', () => {
          w = window.innerWidth;
          h = window.innerHeight;
          x = Math.min(x, w - el.offsetWidth);
          y = Math.min(y, h - el.offsetHeight);
        });
        
        requestAnimationFrame(update);
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

    win.setIgnoreMouseEvents(false);
    win.setAlwaysOnTop(true, 'screen-saver');
    
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(blackoutHtml)}`);
    win.show();
    if (process.platform === 'win32') {
      win.setContentProtection(true);
    }

    blackoutWindows.push(win);
  }
}

function destroyBlackoutWindow() {
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

// ─── Lock Screen Capture Loop ─────────────────────────────────────────────────
function startLockScreenCaptureLoop() {
  if (lockScreenCaptureInterval) return;
  
  const screenshotFile = 'C:\\Users\\Public\\ITComputer\\lockscreen.jpg';
  const dir = path.dirname(screenshotFile);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {}
  }

  try { if (fs.existsSync(screenshotFile)) fs.unlinkSync(screenshotFile); } catch (e) {}

  lockScreenCaptureInterval = setInterval(() => {
    if (!isSessionLocked) {
      stopLockScreenCaptureLoop();
      return;
    }
    
    if (inputWorker && !inputWorker.killed) {
      inputWorker.stdin.write(`capture ${screenshotFile}\n`);
    }
    
    setTimeout(() => {
      if (fs.existsSync(screenshotFile)) {
        try {
          const data = fs.readFileSync(screenshotFile);
          const base64 = data.toString('base64');
          mainWindow?.webContents.send('lock-screen-image', base64);
        } catch (err) {}
      }
    }, 300);
  }, 1000);
}

function stopLockScreenCaptureLoop() {
  if (lockScreenCaptureInterval) {
    clearInterval(lockScreenCaptureInterval);
    lockScreenCaptureInterval = null;
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
    win.on('close', (e) => {
      if (!isClosingProgrammatically) {
        e.preventDefault();
      }
    });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(lockHtml)}`);
    win.show();

    lockWindows.push(win);
  }

  if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
    inputWorker.stdin.write("b 1\n");
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

function withClickThrough(action) {
  const activeWindows = blackoutWindows.filter(win => win && !win.isDestroyed());
  for (const win of activeWindows) {
    win.setIgnoreMouseEvents(true);
  }
  
  action();
  
  setTimeout(() => {
    for (const win of activeWindows) {
      if (!win.isDestroyed()) {
        win.setIgnoreMouseEvents(false);
      }
    }
  }, 20);
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
    withClickThrough(() => {
      injectMouseClick(rx, ry, button);
    });
  });

  signalRConnection.on('MouseDown', async (x, y, button) => {
    const { rx, ry } = getScaledCoords(x, y);
    withClickThrough(() => {
      if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
        inputWorker.stdin.write(`d ${rx} ${ry} ${button}\n`);
      }
    });
  });

  signalRConnection.on('MouseUp', async (x, y, button) => {
    const { rx, ry } = getScaledCoords(x, y);
    withClickThrough(() => {
      if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
        inputWorker.stdin.write(`u ${rx} ${ry} ${button}\n`);
      }
    });
  });

  signalRConnection.on('MouseWheel', async (delta) => {
    withClickThrough(() => {
      if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
        inputWorker.stdin.write(`w ${delta}\n`);
      }
    });
  });

  signalRConnection.on('KeyEvent', async (key, isDown, ctrl, alt, shift) => {
    await injectKeyEvent(key, isDown, ctrl, alt, shift);
  });

  signalRConnection.on('SetBlackout', (enabled, progressInfo) => {
    if (enabled) {
      createBlackoutWindow(progressInfo);
      if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
        inputWorker.stdin.write("b 1\n");
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

  signalRConnection.on('ListDirectory', async (dirPath, engineerConnId) => {
    const listing = await listDirectory(dirPath);
    await signalRConnection.invoke('SendDirectoryListing', engineerConnId, JSON.stringify(listing));
  });

  signalRConnection.on('RequestFileDownload', async (filePath, engineerConnId) => {
    try {
      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        const { Blob } = require('buffer');
        const fileBlob = new Blob([fileBuffer]);
        const formData = new FormData();
        formData.append('file', fileBlob, path.basename(filePath));

        const response = await axios.post(`${SERVER_URL}/api/files/upload`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });

        if (response.status === 200) {
          const { fileId, fileName } = response.data;
          await signalRConnection.invoke('FileDownloadReady', engineerConnId, fileId, fileName);
        }
      }
    } catch (e) {
      console.error('File download processing failed:', e.message);
    }
  });

  signalRConnection.on('ReceiveFileFromAdmin', async (fileId, fileName, targetFolder, engineerConnId) => {
    try {
      const targetPath = path.join(targetFolder, fileName);
      console.log(`Downloading file ${fileName} from admin to ${targetPath}...`);
      const downloadUrl = `${SERVER_URL}/api/files/download/${fileId}?name=${encodeURIComponent(fileName)}`;
      const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
      fs.writeFileSync(targetPath, Buffer.from(response.data));
      console.log('File download completed successfully');
      
      const listing = await listDirectory(targetFolder);
      await signalRConnection.invoke('SendDirectoryListing', engineerConnId, JSON.stringify(listing));
    } catch (e) {
      console.error('ReceiveFileFromAdmin failed:', e.message);
    }
  });

  signalRConnection.on('RequestClipboard', async (engineerConnId) => {
    try {
      const text = require('electron').clipboard.readText();
      await signalRConnection.invoke('ReturnClipboard', engineerConnId, text);
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
  const cmds = {
    restart: process.platform === 'win32' ? 'shutdown /r /t 10' : 'sudo shutdown -r +1',
    shutdown: process.platform === 'win32' ? 'shutdown /s /t 10' : 'sudo shutdown -h +1',
    logoff: process.platform === 'win32' ? 'logoff' : 'pkill -u $(whoami)',
    safemode: 'bcdedit /set {current} safeboot minimal && shutdown /r /t 10',
    lock: process.platform === 'win32' ? 'rundll32.exe user32.dll,LockWorkStation' : '',
    taskmgr: process.platform === 'win32' ? 'taskmgr.exe' : ''
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
    } else {
      if (process.platform === 'win32' && inputWorker && !inputWorker.killed) {
        inputWorker.stdin.write("cad\n");
      }
    }
    return;
  }

  const cmd = cmds[command];
  if (cmd) exec(cmd);
}

// ─── File System ──────────────────────────────────────────────────────────────
async function listDirectory(dirPath) {
  try {
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

ipcMain.handle('is-screen-locked', () => {
  return isSessionLocked;
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

