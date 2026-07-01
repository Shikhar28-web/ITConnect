import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [status, setStatus] = useState('Connecting...');
  const [connected, setConnected] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [engineerName, setEngineerName] = useState('');
  const [serverUrl, setServerUrl] = useState('Loading...');
  const [isElectron, setIsElectron] = useState(true);

  const [localPath, setLocalPath] = useState('C:\\');
  const [localItems, setLocalItems] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [transferring, setTransferring] = useState(false);
  const [receivedFiles, setReceivedFiles] = useState([]);

  useEffect(() => {
    if (!window.electronAPI) {
      setIsElectron(false);
      setStatus('Agent must be run via the Electron app, not in a web browser.');
      setConnected(false);
      setServerUrl('N/A (Browser Mode)');
      return;
    }

    // Get Server URL from Electron main process
    window.electronAPI.getServerUrl().then(url => {
      setServerUrl(url);
    }).catch(() => {
      setServerUrl('Unknown');
    });

    // Get initial status
    window.electronAPI.getAgentStatus().then(data => {
      setConnected(data.connected);
      setStatus(data.message);
      setSessionActive(data.sessionActive);
      setEngineerName(data.engineerName || '');
    }).catch(() => {});

    // Listen for status updates from main process
    const unsubscribe = window.electronAPI.onAgentStatus((data) => {
      setConnected(data.connected);
      setStatus(data.message);
      if (data.sessionActive !== undefined) {
        setSessionActive(data.sessionActive);
        setEngineerName(data.engineerName || '');
      }
    });

    const unsubscribeFileReceived = window.electronAPI.onFileReceivedNotification((data) => {
      setReceivedFiles(prev => [data, ...prev]);
    });

    const peerRef = { current: null };
    const privacyModeRef = { current: false };

    window.electronAPI.onWebRTCOffer(async ({ engineerConnId, sdp }) => {
      console.log('Received WebRTC offer', engineerConnId);
      if (peerRef.current) {
        console.log('Closing previous active PeerConnection...');
        try {
          peerRef.current.close();
        } catch (err) {
          console.warn('Failed to close old PC:', err);
        }
      }
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peerRef.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          window.electronAPI.sendWebRTCIce({ targetConnId: engineerConnId, candidate: JSON.stringify(event.candidate) });
        }
      };

      try {
        const sourceId = await window.electronAPI.getDesktopStreamId();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              minWidth: 1280,
              maxWidth: 1920,
              minHeight: 720,
              maxHeight: 1080
            }
          }
        });
        
        stream.getTracks().forEach(track => {
          if (track.kind === 'video') {
            track.enabled = !privacyModeRef.current;
          }
          pc.addTrack(track, stream);
        });

        await pc.setRemoteDescription({ type: 'offer', sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await window.electronAPI.sendWebRTCAnswer({ engineerConnId, sdp: answer.sdp });
        console.log('Sent WebRTC answer');
      } catch (err) {
        console.error('WebRTC error', err);
      }
    });

    window.electronAPI.onWebRTCIce(async (candidateJson) => {
      if (peerRef.current) {
        try {
          const candidate = JSON.parse(candidateJson);
          await peerRef.current.addIceCandidate(candidate);
        } catch(e) {}
      }
    });

    const unsubscribePrivacy = window.electronAPI.onSetPrivacyMode((enabled) => {
      privacyModeRef.current = enabled;
      if (peerRef.current) {
        peerRef.current.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'video') {
            sender.track.enabled = !enabled;
          }
        });
      }
    });

    // When secure desktop is detected (Winlogon), mute the WebRTC track so no black frames are sent
    const unsubscribeWebRTCTrack = window.electronAPI.onSetWebRTCTrackEnabled?.((enabled) => {
      if (peerRef.current) {
        peerRef.current.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'video') {
            // Only override if not already controlled by privacy mode
            if (!privacyModeRef.current) {
              sender.track.enabled = enabled;
            }
          }
        });
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
      if (unsubscribePrivacy) unsubscribePrivacy();
      if (unsubscribeWebRTCTrack) unsubscribeWebRTCTrack();
      if (unsubscribeFileReceived) unsubscribeFileReceived();
      if (peerRef.current) peerRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (sessionActive && window.electronAPI) {
      loadDirectory(localPath);
    }
  }, [localPath, sessionActive]);

  async function loadDirectory(pathStr) {
    try {
      const items = await window.electronAPI.listLocalDirectory(pathStr);
      setLocalItems(items || []);
      setSelectedFile(null);
    } catch (err) {
      console.warn('Failed to load local directory:', err);
    }
  }

  function handleLocalClick(item) {
    if (item.isDirectory) {
      setLocalPath(item.path);
    } else {
      setSelectedFile(item);
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

  async function handleSendLocalFile() {
    if (!selectedFile) return;
    setTransferring(true);
    try {
      await window.electronAPI.sendLocalFileToAdmin(selectedFile.path);
      alert(`Sent "${selectedFile.name}" to administrator successfully.`);
    } catch (err) {
      alert(`Send failed: ${err.message}`);
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="agent-app" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div className="agent-header" style={{ flexShrink: 0 }}>
        <div className="agent-logo">
          <span className="logo-icon">🖥️</span>
          <span className="logo-text">IT Support Agent</span>
        </div>
        <div className={`status-badge ${connected ? 'status-online' : 'status-offline'}`}>
          <span className="status-dot"></span>
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Side: Status and Connection Info */}
        <div className="agent-body" style={{ flex: sessionActive ? '0 0 350px' : '1', overflowY: 'auto', borderRight: sessionActive ? '1px solid #333' : 'none' }}>
          {!isElectron && (
            <div className="session-card active" style={{ borderColor: '#ef4444' }}>
              <div className="session-icon">⚠️</div>
              <div className="session-info">
                <h4 style={{ color: '#f87171' }}>Browser Mode Detected</h4>
                <p style={{ marginTop: 8 }}>
                  The agent's desktop capabilities (mouse/keyboard control, remote terminal, etc.) can only run inside the Electron shell.
                </p>
                <p style={{ marginTop: 8 }}>
                  Please run the agent executable or start it using:
                  <br />
                  <code style={{ background: '#222', padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginTop: 4 }}>
                    npm run electron:dev
                  </code>
                </p>
              </div>
            </div>
          )}

          <div className="info-card">
            <h3>Agent Status</h3>
            <p className="status-text">{status}</p>
          </div>

          {sessionActive && (
            <div className="session-card active">
              <div className="session-icon">👷</div>
              <div className="session-info">
                <h4>Session Active</h4>
                <p>Engineer: <strong>{engineerName}</strong></p>
                <p>Your screen is being accessed by the IT Department.</p>
              </div>
            </div>
          )}

          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Version</span>
              <span className="info-value">1.0.0</span>
            </div>
            <div className="info-item">
              <span className="info-label">Server</span>
              <span className="info-value" style={{ fontFamily: 'monospace' }}>{serverUrl}</span>
            </div>
          </div>

          <div className="privacy-notice">
            <span>🔒</span>
            <p>This agent only allows access from authorized IT engineers. All sessions are logged and recorded.</p>
          </div>
        </div>

        {/* Right Side: File Transfer Panel (Only visible when session active) */}
        {sessionActive && (
          <div className="agent-file-transfer-pane" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderLeft: '1px solid rgba(255,255,255,0.08)', background: '#18181f' }}>
            <div className="sidebar-header" style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <h3 style={{ fontSize: '15px', color: '#fff', margin: 0 }}>📂 Share Files to Administrator</h3>
            </div>
            
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* Explorer List */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Browse Local Files:</span>
                  {localPath !== 'drives' && (
                    <button onClick={handleLocalGoUp} style={{ padding: '2px 8px', background: '#333', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '11px', cursor: 'pointer' }}>⬆️ Up</button>
                  )}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3b82f6', background: 'rgba(0,0,0,0.3)', padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {localPath}
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4px' }}>
                  {localItems.length === 0 ? (
                    <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '16px', fontSize: '12px' }}>No items or drives root</div>
                  ) : (
                    localItems.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleLocalClick(item)}
                        style={{
                          display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
                          background: selectedFile?.path === item.path ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                          color: selectedFile?.path === item.path ? '#3b82f6' : 'rgba(255,255,255,0.8)'
                        }}
                      >
                        <span style={{ marginRight: '8px' }}>{item.isDirectory ? '📁' : '📄'}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      </div>
                    ))
                  )}
                </div>

                <button
                  onClick={handleSendLocalFile}
                  disabled={!selectedFile || transferring}
                  style={{
                    padding: '10px', background: !selectedFile ? '#333' : '#10b981', border: 'none', borderRadius: '6px',
                    color: '#fff', fontSize: '13px', fontWeight: 'bold', cursor: !selectedFile ? 'not-allowed' : 'pointer', transition: 'all 0.2s'
                  }}
                >
                  {transferring ? '⏳ Uploading...' : '📤 Send Selected File to Admin'}
                </button>
              </div>

              {/* Received Transfers Pane */}
              <div style={{ width: '220px', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', fontWeight: 'bold' }}>📥 Received Files ({receivedFiles.length})</span>
                <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {receivedFiles.length === 0 ? (
                    <div style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '12px', fontSize: '11px' }}>No received files yet</div>
                  ) : (
                    receivedFiles.map((rf, idx) => (
                      <div key={idx} style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '6px 8px', borderRadius: '4px' }}>
                        <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📂 {rf.fileName}</div>
                        <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginTop: '4px', wordBreak: 'break-all' }}>Saved to: {rf.targetFolder}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

