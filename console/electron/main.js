const { app, BrowserWindow, ipcMain, clipboard, screen } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
let mainWindow = null;

app.whenReady().then(() => {
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1')) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1600, width - 100),
    height: Math.min(1000, height - 80),
    minWidth: 1200,
    minHeight: 700,
    frame: true,
    titleBarStyle: 'default',
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false // Allow WebRTC from Electron
    }
  });

  const startUrl = isDev
    ? 'http://localhost:3001'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('clipboard-read', () => clipboard.readText());
ipcMain.handle('clipboard-write', (_, text) => clipboard.writeText(text));
ipcMain.handle('get-displays', () => screen.getAllDisplays());
ipcMain.handle('app-version', () => app.getVersion());
