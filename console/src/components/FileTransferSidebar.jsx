import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import signalRService from '../services/signalr';

function FileTransferSidebar({ deviceId, onClose, serverUrl, remotePath, remoteItems, onNavigateRemote }) {
  const [localPath, setLocalPath] = useState(window.electronAPI ? 'C:\\' : 'drives');
  const [localItems, setLocalItems] = useState([]);
  const [localLoading, setLocalLoading] = useState(false);

  const [selectedLocalFile, setSelectedLocalFile] = useState(null);
  const [selectedRemoteFile, setSelectedRemoteFile] = useState(null);
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    loadLocalDirectory(localPath);
  }, [localPath]);

  async function loadLocalDirectory(pathStr) {
    if (!window.electronAPI) {
      setLocalItems([]);
      return;
    }
    setLocalLoading(true);
    try {
      const items = await window.electronAPI.listLocalDirectory(pathStr);
      setLocalItems(items || []);
      setSelectedLocalFile(null);
    } catch (err) {
      toast.error('Failed to read local directory');
      console.error(err);
    } finally {
      setLocalLoading(false);
    }
  }

  function handleLocalClick(item) {
    if (item.isDirectory) {
      setLocalPath(item.path);
    } else {
      setSelectedLocalFile(item);
    }
  }

  function handleLocalGoUp() {
    if (!localPath || localPath === 'drives') return;
    const parts = localPath.split('\\').filter(Boolean);
    if (parts.length <= 1) {
      setLocalPath('drives');
    } else {
      parts.pop();
      setLocalPath(parts.join('\\') + '\\');
    }
  }

  function handleRemoteClick(item) {
    if (item.isDirectory) {
      onNavigateRemote(item.path);
    } else {
      setSelectedRemoteFile(item);
    }
  }

  function handleRemoteGoUp() {
    if (!remotePath || remotePath === 'drives') return;
    const parts = remotePath.split('\\').filter(Boolean);
    if (parts.length <= 1) {
      onNavigateRemote('drives');
    } else {
      parts.pop();
      onNavigateRemote(parts.join('\\') + '\\');
    }
  }

  async function handleSendFile() {
    if (!selectedLocalFile) {
      toast.warn('Please select a local file to send.');
      return;
    }
    if (remotePath === 'drives') {
      toast.warn('Cannot send file to drives root. Please enter a disk drive.');
      return;
    }
    setTransferring(true);
    toast.info(`Uploading ${selectedLocalFile.name}...`);
    try {
      const data = await window.electronAPI.uploadLocalFileToServer(selectedLocalFile.path, serverUrl);
      const { fileId, fileName } = data;
      toast.info('Initiating remote agent write...');
      await signalRService.sendFileToAgent(parseInt(deviceId), fileId, fileName, remotePath);
      toast.success(`Sent ${fileName} successfully!`);
      // Refresh remote listing
      onNavigateRemote(remotePath);
    } catch (err) {
      toast.error(`Send failed: ${err.message}`);
    } finally {
      setTransferring(false);
    }
  }

  async function handleDownloadFile() {
    if (!selectedRemoteFile) {
      toast.warn('Please select a remote file to download.');
      return;
    }
    setTransferring(true);
    toast.info(`Downloading ${selectedRemoteFile.name}...`);
    try {
      await signalRService.requestFileDownload(parseInt(deviceId), selectedRemoteFile.path);
    } catch (err) {
      toast.error(`Download failed: ${err.message}`);
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="file-transfer-sidebar">
      <div className="sidebar-header">
        <h3>📂 File Transfer Panel</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="sidebar-body">
        {/* LOCAL COMPUTER PANE */}
        <div className="pane-section">
          <div className="pane-header">
            <h4>📁 Local Computer (You)</h4>
            {localPath !== 'drives' && (
              <button className="nav-up-btn" onClick={handleLocalGoUp}>⬆️ Up</button>
            )}
          </div>
          <div className="pane-path">{localPath}</div>
          <div className="pane-list">
            {localLoading ? (
              <div className="pane-msg">Loading...</div>
            ) : localItems.length === 0 ? (
              <div className="pane-msg">Empty or inaccessible</div>
            ) : (
              localItems.map((item, idx) => (
                <div
                  key={idx}
                  className={`pane-item ${item.isDirectory ? 'dir' : 'file'} ${selectedLocalFile?.path === item.path ? 'selected' : ''}`}
                  onClick={() => handleLocalClick(item)}
                >
                  <span className="item-icon">{item.isDirectory ? '📁' : '📄'}</span>
                  <span className="item-name">{item.name}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* TRANSFERS INTERACTION CONTROL */}
        <div className="transfer-actions">
          <button
            className="action-btn btn-send"
            onClick={handleSendFile}
            disabled={!selectedLocalFile || transferring}
          >
            📤 Send File To Remote
          </button>
          <button
            className="action-btn btn-get"
            onClick={handleDownloadFile}
            disabled={!selectedRemoteFile || transferring}
          >
            📥 Get File From Remote
          </button>
        </div>

        {/* REMOTE COMPUTER PANE */}
        <div className="pane-section">
          <div className="pane-header">
            <h4>🖥️ Remote Computer (Client)</h4>
            {remotePath !== 'drives' && (
              <button className="nav-up-btn" onClick={handleRemoteGoUp}>⬆️ Up</button>
            )}
          </div>
          <div className="pane-path">{remotePath}</div>
          <div className="pane-list">
            {remoteItems.length === 0 ? (
              <div className="pane-msg">Empty or drives root</div>
            ) : (
              remoteItems.map((item, idx) => (
                <div
                  key={idx}
                  className={`pane-item ${item.isDirectory ? 'dir' : 'file'} ${selectedRemoteFile?.path === item.path ? 'selected' : ''}`}
                  onClick={() => handleRemoteClick(item)}
                >
                  <span className="item-icon">{item.isDirectory ? '📁' : '📄'}</span>
                  <span className="item-name">{item.name}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FileTransferSidebar;
