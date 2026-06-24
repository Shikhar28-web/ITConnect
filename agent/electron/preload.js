const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // WebRTC
  onWebRTCOffer: (callback) => ipcRenderer.on('webrtc-offer', (_, data) => callback(data)),
  onWebRTCIce: (callback) => ipcRenderer.on('webrtc-ice', (_, data) => callback(data)),
  sendWebRTCAnswer: (data) => ipcRenderer.invoke('webrtc-answer', data),
  sendWebRTCIce: (data) => ipcRenderer.invoke('webrtc-ice', data),
  getDesktopStreamId: () => ipcRenderer.invoke('get-desktop-stream-id'),

  // Clipboard
  getClipboard: () => ipcRenderer.invoke('clipboard-get'),

  // Status & Config
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  getAgentStatus: () => ipcRenderer.invoke('get-agent-status'),
  onAgentStatus: (callback) => {
    const subscription = (_, data) => callback(data);
    ipcRenderer.on('agent-status', subscription);
    return () => ipcRenderer.removeListener('agent-status', subscription);
  },
  onSetPrivacyMode: (callback) => {
    const subscription = (_, enabled) => callback(enabled);
    ipcRenderer.on('set-privacy-mode', subscription);
    return () => ipcRenderer.removeListener('set-privacy-mode', subscription);
  },

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // Lock Screen Handling
  onLockStatusChanged: (callback) => {
    const subscription = (_, locked) => callback(locked);
    ipcRenderer.on('lock-status-changed', subscription);
    return () => ipcRenderer.removeListener('lock-status-changed', subscription);
  },
  onLockScreenImage: (callback) => {
    const subscription = (_, base64Data) => callback(base64Data);
    ipcRenderer.on('lock-screen-image', subscription);
    return () => ipcRenderer.removeListener('lock-screen-image', subscription);
  },
  isScreenLocked: () => ipcRenderer.invoke('is-screen-locked')
});

