import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [status, setStatus] = useState('Connecting...');
  const [connected, setConnected] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [engineerName, setEngineerName] = useState('');
  const [serverUrl, setServerUrl] = useState('Loading...');
  const [isElectron, setIsElectron] = useState(true);

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

    const peerRef = { current: null };

    window.electronAPI.onWebRTCOffer(async ({ engineerConnId, sdp }) => {
      console.log('Received WebRTC offer', engineerConnId);
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
        
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

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
      if (peerRef.current) {
        peerRef.current.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'video') {
            sender.track.enabled = !enabled;
          }
        });
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
      if (unsubscribePrivacy) unsubscribePrivacy();
      if (peerRef.current) peerRef.current.close();
    };
  }, []);

  return (
    <div className="agent-app">
      <div className="agent-header">
        <div className="agent-logo">
          <span className="logo-icon">🖥️</span>
          <span className="logo-text">IT Support Agent</span>
        </div>
        <div className={`status-badge ${connected ? 'status-online' : 'status-offline'}`}>
          <span className="status-dot"></span>
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div className="agent-body">
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
    </div>
  );
}

export default App;

