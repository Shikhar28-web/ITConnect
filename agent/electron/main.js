const { app, BrowserWindow, Tray, Menu, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const { createServer } = require('http');

// ─── Config ──────────────────────────────────────────────────────────────────
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';
const isDev = process.env.NODE_ENV === 'development';

let tray = null;
let mainWindow = null;
let blackoutWindow = null;
let signalRConnection = null;
let deviceId = null;

// ─── App Ready ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createTray();
  createMainWindow();
  await registerDevice();
  await connectSignalR();
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Keep running in background
});

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
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
}

// ─── Main Window (hidden, shows on click) ────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    show: false,
    skipTaskbar: true,
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

// ─── Blackout Overlay Window ──────────────────────────────────────────────────
function createBlackoutWindow(progressInfo) {
  const displays = screen.getAllDisplays();
  const totalBounds = displays.reduce((acc, d) => ({
    x: Math.min(acc.x, d.bounds.x),
    y: Math.min(acc.y, d.bounds.y),
    width: acc.width + d.bounds.width,
    height: Math.max(acc.height, d.bounds.height)
  }), { x: 0, y: 0, width: 0, height: 0 });

  blackoutWindow = new BrowserWindow({
    x: totalBounds.x,
    y: totalBounds.y,
    width: totalBounds.width,
    height: totalBounds.height,
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

  blackoutWindow.setIgnoreMouseEvents(true);
  blackoutWindow.setAlwaysOnTop(true, 'screen-saver');

  const blackoutHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #000;
          color: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          font-family: 'Segoe UI', sans-serif;
          user-select: none;
        }
        .logo { font-size: 48px; margin-bottom: 24px; }
        .company { font-size: 28px; font-weight: 700; color: #4A9EFF; margin-bottom: 40px; }
        .title { font-size: 22px; font-weight: 600; margin-bottom: 16px; }
        .message { font-size: 16px; color: #aaa; text-align: center; max-width: 500px; line-height: 1.6; margin-bottom: 32px; }
        .progress-bar {
          width: 400px;
          height: 8px;
          background: #333;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4A9EFF, #7B61FF);
          border-radius: 4px;
          animation: progress 3s ease-in-out infinite alternate;
        }
        @keyframes progress {
          from { width: 20%; }
          to { width: 90%; }
        }
        .info { font-size: 13px; color: #666; }
        .ticket { margin-top: 20px; font-size: 14px; color: #4A9EFF; }
      </style>
    </head>
    <body>
      <div class="logo">🖥️</div>
      <div class="company">IT Department</div>
      <div class="title">Maintenance In Progress</div>
      <div class="message">
        Your issue is currently being resolved by the IT Department.<br>
        Please wait while maintenance is in progress.
      </div>
      <div class="progress-bar"><div class="progress-fill"></div></div>
      <div class="info">${progressInfo || 'Please do not power off your computer.'}</div>
    </body>
    </html>
  `;

  blackoutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(blackoutHtml)}`);

  // Block input on Windows
  if (process.platform === 'win32') {
    try {
      exec('powershell -Command "Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class Input { [DllImport(\"user32.dll\")] public static extern bool BlockInput(bool fBlockIt); }\'; [Input]::BlockInput($true)"');
    } catch (e) {
      console.error('Could not block input:', e);
    }
  }
}

function destroyBlackoutWindow() {
  if (blackoutWindow && !blackoutWindow.isDestroyed()) {
    blackoutWindow.close();
    blackoutWindow = null;
  }

  if (process.platform === 'win32') {
    try {
      exec('powershell -Command "Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class Input { [DllImport(\"user32.dll\")] public static extern bool BlockInput(bool fBlockIt); }\'; [Input]::BlockInput($false)"');
    } catch (e) { /* ignore */ }
  }
}

// ─── Device Registration ──────────────────────────────────────────────────────
async function registerDevice() {
  try {
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
    const response = await fetch(`${SERVER_URL}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostname: os.hostname(),
        ipAddress: ip,
        macAddress: mac,
        os: os.type() + ' ' + os.release(),
        osVersion: osVersion,
        agentVersion: app.getVersion()
      })
    });

    if (response.ok) {
      const data = await response.json();
      deviceId = data.id;
      console.log('Device registered with ID:', deviceId);
      startMetricsReporter();
    }
  } catch (err) {
    console.error('Device registration failed:', err);
    setTimeout(registerDevice, 10000);
  }
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
      uptimeSeconds: os.uptime(),
      monitorCount: screen.getAllDisplays().length
    };

    try {
      await fetch(`${SERVER_URL}/api/devices/${deviceId}/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metrics)
      });
    } catch (e) { /* silent fail */ }
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
  const signalR = require('@microsoft/signalr');

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

  signalRConnection.on('MouseMove', async (x, y) => {
    await injectMouseMove(x, y);
  });

  signalRConnection.on('MouseClick', async (x, y, button) => {
    await injectMouseClick(x, y, button);
  });

  signalRConnection.on('KeyEvent', async (key, isDown, ctrl, alt, shift) => {
    await injectKeyEvent(key, isDown, ctrl, alt, shift);
  });

  signalRConnection.on('SetBlackout', (enabled, progressInfo) => {
    if (enabled) {
      createBlackoutWindow(progressInfo);
    } else {
      destroyBlackoutWindow();
    }
  });

  signalRConnection.on('ClipboardSync', (text) => {
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
    tray?.setToolTip('IT Support Agent - Connected');
  });

  signalRConnection.onclose(() => {
    tray?.setToolTip('IT Support Agent - Disconnected');
  });

  await signalRConnection.start();
  console.log('SignalR connected');
}

// ─── Mouse/Keyboard Injection ─────────────────────────────────────────────────
async function injectMouseMove(x, y) {
  if (process.platform === 'win32') {
    exec(`powershell -Command "[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})"`);
  }
}

async function injectMouseClick(x, y, button) {
  if (process.platform === 'win32') {
    const btnFlag = button === 2 ? 'MOUSEEVENTF_RIGHTDOWN,MOUSEEVENTF_RIGHTUP' : 'MOUSEEVENTF_LEFTDOWN,MOUSEEVENTF_LEFTUP';
    exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = '${x},${y}'; [System.Windows.Forms.SendKeys]::SendWait(' ')"`);
  }
}

async function injectKeyEvent(key, isDown, ctrl, alt, shift) {
  if (process.platform === 'win32') {
    let combo = '';
    if (ctrl) combo += '^';
    if (alt) combo += '%';
    if (shift) combo += '+';
    combo += key;
    exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${combo}')"`);
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
    safemode: 'bcdedit /set {current} safeboot minimal && shutdown /r /t 10'
  };
  const cmd = cmds[command];
  if (cmd) exec(cmd);
}

// ─── File System ──────────────────────────────────────────────────────────────
async function listDirectory(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(dirPath, e.name),
      size: e.isFile() ? fs.statSync(path.join(dirPath, e.name)).size : 0,
      modified: fs.statSync(path.join(dirPath, e.name)).mtime
    }));
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
