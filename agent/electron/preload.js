const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // WebRTC
  onWebRTCOffer: (callback) => ipcRenderer.on('webrtc-offer', (_, data) => callback(data)),
  onWebRTCIce: (callback) => ipcRenderer.on('webrtc-ice', (_, data) => callback(data)),
  sendWebRTCAnswer: (data) => ipcRenderer.invoke('webrtc-answer', data),
  sendWebRTCIce: (data) => ipcRenderer.invoke('webrtc-ice', data),

  // Clipboard
  getClipboard: () => ipcRenderer.invoke('clipboard-get'),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
