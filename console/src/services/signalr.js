import * as signalR from '@microsoft/signalr';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

class SignalRService {
  constructor() {
    this.remoteControlHub = null;
    this.notificationHub = null;
    this.chatHub = null;
  }

  getToken() {
    return localStorage.getItem('accessToken') || '';
  }

  async connectRemoteControl(handlers) {
    this.remoteControlHub = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE_URL}/hubs/remote-control`, {
        accessTokenFactory: () => this.getToken()
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    // Register event handlers
    if (handlers.onAnswer) this.remoteControlHub.on('ReceiveAnswer', handlers.onAnswer);
    if (handlers.onIceCandidate) this.remoteControlHub.on('ReceiveIceCandidate', handlers.onIceCandidate);
    if (handlers.onCommandOutput) this.remoteControlHub.on('CommandOutput', handlers.onCommandOutput);
    if (handlers.onDirectoryListing) this.remoteControlHub.on('DirectoryListing', handlers.onDirectoryListing);
    if (handlers.onProcessList) this.remoteControlHub.on('ProcessList', handlers.onProcessList);
    if (handlers.onRegistryData) this.remoteControlHub.on('RegistryData', handlers.onRegistryData);
    if (handlers.onClipboardData) this.remoteControlHub.on('ClipboardData', handlers.onClipboardData);
    if (handlers.onFileDownloadReady) this.remoteControlHub.on('FileDownloadReady', handlers.onFileDownloadReady);
    if (handlers.onSecureDesktopFrame) this.remoteControlHub.on('SecureDesktopFrame', handlers.onSecureDesktopFrame);
    if (handlers.onActiveDesktop) this.remoteControlHub.on('ActiveDesktop', handlers.onActiveDesktop);

    await this.remoteControlHub.start();
    return this.remoteControlHub.connectionId;
  }

  async connectNotifications(onNotification) {
    this.notificationHub = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE_URL}/hubs/notifications`, {
        accessTokenFactory: () => this.getToken()
      })
      .withAutomaticReconnect()
      .build();

    this.notificationHub.on('ReceiveNotification', onNotification);
    this.notificationHub.on('UnreadNotifications', (notifs) => {
      window.dispatchEvent(new CustomEvent('unread-notifications', { detail: notifs }));
    });

    await this.notificationHub.start();
    await this.notificationHub.invoke('GetUnreadNotifications');
  }

  async connectChat(sessionId, onMessage, onTyping) {
    this.chatHub = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE_URL}/hubs/chat`, {
        accessTokenFactory: () => this.getToken()
      })
      .withAutomaticReconnect()
      .build();

    this.chatHub.on('ReceiveMessage', onMessage);
    this.chatHub.on('TypingIndicator', onTyping);

    await this.chatHub.start();
    await this.chatHub.invoke('JoinSession', sessionId);
  }

  // ─── Remote Control Methods ────────────────────────────────────────────────
  async sendOffer(deviceId, sdp) {
    await this.remoteControlHub?.invoke('SendOffer', deviceId.toString(), sdp);
  }

  async sendAnswer(engineerConnId, sdp) {
    await this.remoteControlHub?.invoke('SendAnswer', engineerConnId, sdp);
  }

  async sendIceCandidate(targetConnId, candidate) {
    await this.remoteControlHub?.invoke('SendIceCandidate', targetConnId, JSON.stringify(candidate));
  }

  async sendMouseMove(deviceId, x, y) {
    await this.remoteControlHub?.invoke('SendMouseMove', deviceId.toString(), x, y);
  }

  async sendMouseClick(deviceId, x, y, button) {
    await this.remoteControlHub?.invoke('SendMouseClick', deviceId.toString(), x, y, button);
  }

  async sendMouseDown(deviceId, x, y, button) {
    await this.remoteControlHub?.invoke('SendMouseDown', deviceId.toString(), x, y, button);
  }

  async sendMouseUp(deviceId, x, y, button) {
    await this.remoteControlHub?.invoke('SendMouseUp', deviceId.toString(), x, y, button);
  }

  async sendMouseWheel(deviceId, delta) {
    await this.remoteControlHub?.invoke('SendMouseWheel', deviceId.toString(), delta);
  }

  async sendKeyEvent(deviceId, key, isDown, ctrl, alt, shift) {
    await this.remoteControlHub?.invoke('SendKeyEvent', deviceId.toString(), key, isDown, ctrl, alt, shift);
  }

  async setBlackout(deviceId, sessionId, enabled, progressInfo) {
    const sId = parseInt(sessionId) || 0;
    await this.remoteControlHub?.invoke('SetBlackout', deviceId.toString(), sId, enabled, progressInfo);
  }
 
  async setPrivacyMode(deviceId, sessionId, enabled) {
    const sId = parseInt(sessionId) || 0;
    await this.remoteControlHub?.invoke('SetPrivacyMode', deviceId.toString(), sId, enabled);
  }

  async syncClipboard(deviceId, text) {
    await this.remoteControlHub?.invoke('SyncClipboard', deviceId.toString(), text);
  }

  async requestClipboard(deviceId) {
    await this.remoteControlHub?.invoke('RequestClipboard', deviceId.toString());
  }

  async executeCommand(deviceId, sessionId, shell, command) {
    await this.remoteControlHub?.invoke('ExecuteCommand', deviceId.toString(), sessionId, shell, command);
  }

  async sendPowerCommand(deviceId, sessionId, command) {
    await this.remoteControlHub?.invoke('SendPowerCommand', deviceId.toString(), sessionId, command);
  }

  async listDirectory(deviceId, path) {
    await this.remoteControlHub?.invoke('ListDirectory', deviceId.toString(), path);
  }

  async requestFileDownload(deviceId, filePath) {
    await this.remoteControlHub?.invoke('RequestFileDownload', deviceId.toString(), filePath);
  }

  async sendFileToAgent(deviceId, fileId, fileName, targetFolder) {
    await this.remoteControlHub?.invoke('SendFileToAgent', deviceId.toString(), fileId, fileName, targetFolder);
  }

  async getProcessList(deviceId) {
    await this.remoteControlHub?.invoke('GetProcessList', deviceId.toString());
  }

  async killProcess(deviceId, pid) {
    await this.remoteControlHub?.invoke('KillProcess', deviceId.toString(), pid);
  }

  async readRegistry(deviceId, keyPath) {
    await this.remoteControlHub?.invoke('ReadRegistry', deviceId.toString(), keyPath);
  }

  async writeRegistry(deviceId, keyPath, valueName, value, valueType) {
    await this.remoteControlHub?.invoke('WriteRegistry', deviceId.toString(), keyPath, valueName, value, valueType);
  }

  async sendAnnotation(deviceId, annotationJson) {
    await this.remoteControlHub?.invoke('SendAnnotation', deviceId.toString(), annotationJson);
  }

  async sendSecureDesktopInput(deviceId, inputJson) {
    await this.remoteControlHub?.invoke('SendSecureDesktopInput', deviceId.toString(), inputJson);
  }

  // ─── Chat Methods ─────────────────────────────────────────────────────────
  async sendChatMessage(sessionId, message, attachmentName) {
    await this.chatHub?.invoke('SendMessage', sessionId, message, attachmentName);
  }

  async sendTyping(sessionId, isTyping) {
    await this.chatHub?.invoke('SendTypingIndicator', sessionId, isTyping);
  }

  async disconnect() {
    await this.remoteControlHub?.stop();
    await this.notificationHub?.stop();
    await this.chatHub?.stop();
  }
}

export const signalRService = new SignalRService();
export default signalRService;
