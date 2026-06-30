const { app, BrowserWindow, ipcMain, clipboard, screen } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
let mainWindow = null;

app.commandLine.appendSwitch('ignore-certificate-errors');

app.whenReady().then(() => {
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
ipcMain.handle('download-file-and-copy-to-clipboard', async (_, url, fileName) => {
  const https = require('https');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { execSync } = require('child_process');

  let safeUrl = url;
  if (safeUrl.includes('localhost')) {
    safeUrl = safeUrl.replace('localhost', '127.0.0.1');
  }

  const tempDir = path.join(os.tmpdir(), 'ITConnectTransfers');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const localFilePath = path.join(tempDir, fileName);
  const fileStream = fs.createWriteStream(localFilePath);

  return new Promise((resolve, reject) => {
    https.get(safeUrl, { rejectUnauthorized: false }, (response) => {
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        console.log('[Console Clipboard] Downloaded file to:', localFilePath);
        try {
          if (process.platform === 'win32') {
            execSync(`powershell -NoProfile -Command "Set-Clipboard -Path '${localFilePath.replace(/'/g, "''")}'"`);
            console.log('[Console Clipboard] File path written to local Windows clipboard.');
          }
          resolve(true);
        } catch (err) {
          console.error('[Console Clipboard] Failed to copy to clipboard:', err.message);
          reject(err);
        }
      });
    }).on('error', (err) => {
      fs.unlink(localFilePath, () => {});
      reject(err);
    });
  });
});

ipcMain.handle('list-local-directory', async (_, dirPath) => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  
  let targetPath = dirPath;
  if (!targetPath || targetPath === 'drives') {
    if (process.platform === 'win32') {
      return [
        { name: 'C:\\', isDirectory: true, path: 'C:\\', size: 0, modified: null },
        { name: 'Desktop', isDirectory: true, path: path.join(os.homedir(), 'Desktop'), size: 0, modified: null },
        { name: 'Downloads', isDirectory: true, path: path.join(os.homedir(), 'Downloads'), size: 0, modified: null }
      ];
    } else {
      return [{ name: '/', isDirectory: true, path: '/', size: 0, modified: null }];
    }
  }

  try {
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    const results = [];
    for (const e of entries) {
      try {
        const fullPath = path.join(targetPath, e.name);
        let size = 0;
        let isDirectory = false;
        try { isDirectory = e.isDirectory(); } catch {}
        if (!isDirectory) {
          try { size = fs.statSync(fullPath).size; } catch {}
        }
        results.push({
          name: e.name,
          isDirectory: isDirectory,
          path: fullPath,
          size: size,
          modified: null
        });
      } catch (itemErr) {
        // Skip individual files/folders that are restricted or locked
      }
    }
    return results;
  } catch (err) {
    console.error('Failed to list local directory:', err.message);
    throw err;
  }
});

ipcMain.handle('upload-local-file-to-server', async (_, localPath, serverUrl) => {
  const fs = require('fs');
  const path = require('path');
  const axios = require('axios');
  const FormData = require('form-data');
  const crypto = require('crypto');
  const https = require('https');

  if (!fs.existsSync(localPath)) {
    throw new Error('Local file does not exist.');
  }

  let safeServerUrl = serverUrl;
  if (safeServerUrl.includes('localhost')) {
    safeServerUrl = safeServerUrl.replace('localhost', '127.0.0.1');
  }

  const agent = new https.Agent({ rejectUnauthorized: false });
  const transferId = crypto.randomUUID();
  const fileName = path.basename(localPath);
  const chunkSize = 256 * 1024; // 256 KB chunks

  let fd = null;
  let fileLength = 0;
  try {
    fd = fs.openSync(localPath, 'r');
    fileLength = fs.statSync(localPath).size;
  } catch (err) {
    console.error('Failed to open file locally:', err.message);
    throw err;
  }

  let offset = 0;
  let fileHash = crypto.createHash('sha256');

  try {
    while (offset < fileLength) {
      const readBuf = Buffer.alloc(Math.min(chunkSize, fileLength - offset));
      const bytesRead = fs.readSync(fd, readBuf, 0, readBuf.length, offset);
      if (bytesRead <= 0) break;

      const chunkBuffer = readBuf.subarray(0, bytesRead);
      const chunkHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex');
      fileHash.update(chunkBuffer);

      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const form = new FormData();
          form.append('transferId', transferId);
          form.append('offset', offset.toString());
          form.append('hash', chunkHash);
          form.append('chunk', chunkBuffer, { filename: 'chunk.bin', contentType: 'application/octet-stream' });

          const uploadResp = await axios.post(`${safeServerUrl}/api/files/upload/chunk`, form, {
            headers: form.getHeaders(),
            httpsAgent: agent,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          });

          if (uploadResp.status === 200) {
            success = true;
            break;
          }
        } catch (uploadErr) {
          console.warn(`Console upload chunk offset ${offset} failed (attempt ${attempt}/3):`, uploadErr.message);
        }
      }

      if (!success) {
        throw new Error(`Failed to upload chunk at offset ${offset} after 3 attempts.`);
      }

      offset += chunkBuffer.length;
    }

    fs.closeSync(fd);
    fd = null;

    const finalHash = fileHash.digest('hex');
    const commitResp = await axios.post(`${safeServerUrl}/api/files/upload/commit`, {
      transferId: transferId,
      fileName: fileName,
      expectedHash: finalHash
    }, {
      httpsAgent: agent
    });

    if (commitResp.status === 200) {
      return commitResp.data; // returns { fileId, fileName }
    }
    throw new Error('Commit failed on server');

  } catch (err) {
    console.error('Failed to upload local file from main process:', err.message);
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    throw err;
  }
});
