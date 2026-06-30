const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  clipboardRead: () => ipcRenderer.invoke('clipboard-read'),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', text),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  downloadFileAndCopyToClipboard: (url, fileName) => ipcRenderer.invoke('download-file-and-copy-to-clipboard', url, fileName)
});
