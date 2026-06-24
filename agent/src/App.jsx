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
    const privacyModeRef = { current: false };
    const videoSenderRef = { current: null };
    const currentStreamRef = { current: null };

    // Offscreen Canvas setup for lock screen streaming
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    
    // Draw initial black frame
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const canvasStream = canvas.captureStream(10); // 10 FPS is plenty

    // Draw lock screen overlay on canvas
    const drawLockOverlay = () => {
      const w = canvas.width;
      const h = canvas.height;
      // Background gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, '#0f172a');
      gradient.addColorStop(1, '#1e293b');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // Grid pattern
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 60) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += 60) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // Center glow
      const glow = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, 350);
      glow.addColorStop(0, 'rgba(79,70,229,0.15)');
      glow.addColorStop(1, 'rgba(79,70,229,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Lock icon circle
      ctx.save();
      ctx.shadowColor = '#6366f1';
      ctx.shadowBlur = 40;
      ctx.fillStyle = 'rgba(99,102,241,0.2)';
      ctx.beginPath();
      ctx.arc(w/2, h/2 - 80, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Lock icon text
      ctx.font = '72px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', w/2, h/2 - 80);

      // Title
      ctx.fillStyle = '#f1f5f9';
      ctx.font = 'bold 42px "Segoe UI", sans-serif';
      ctx.fillText('System Locked', w/2, h/2 + 30);

      // Subtitle
      ctx.fillStyle = '#94a3b8';
      ctx.font = '24px "Segoe UI", sans-serif';
      ctx.fillText('The employee\'s workstation is locked', w/2, h/2 + 85);

      // Hint box
      const boxW = 520, boxH = 60, boxX = w/2 - boxW/2, boxY = h/2 + 130;
      ctx.fillStyle = 'rgba(99,102,241,0.15)';
      ctx.strokeStyle = 'rgba(99,102,241,0.5)';
      ctx.lineWidth = 1.5;
      const r = 12;
      ctx.beginPath();
      ctx.moveTo(boxX + r, boxY);
      ctx.lineTo(boxX + boxW - r, boxY);
      ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r);
      ctx.lineTo(boxX + boxW, boxY + boxH - r);
      ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH);
      ctx.lineTo(boxX + r, boxY + boxH);
      ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
      ctx.lineTo(boxX, boxY + r);
      ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#a5b4fc';
      ctx.font = '20px "Segoe UI", sans-serif';
      ctx.fillText('⌨️  Click the CAD button in the toolbar to unlock', w/2, boxY + 31);

      // Timestamp
      const now = new Date();
      ctx.fillStyle = '#475569';
      ctx.font = '16px "Segoe UI", sans-serif';
      ctx.fillText('Locked at ' + now.toLocaleTimeString(), w/2, h - 60);
    };

    // Animate the lock overlay (pulsing effect by redrawing periodically)
    let lockAnimInterval = null;
    const startLockAnimation = () => {
      drawLockOverlay();
      lockAnimInterval = setInterval(drawLockOverlay, 5000); // Redraw every 5s to keep timestamp fresh
    };
    const stopLockAnimation = () => {
      if (lockAnimInterval) { clearInterval(lockAnimInterval); lockAnimInterval = null; }
    };

    const getNormalDesktopStream = async () => {
      const sourceId = await window.electronAPI.getDesktopStreamId();
      return await navigator.mediaDevices.getUserMedia({
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
    };

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
        const isLocked = await window.electronAPI.isScreenLocked();
        let stream;
        
        if (isLocked) {
          console.log('Initializing WebRTC session in lock screen mode - showing lock overlay');
          startLockAnimation();
          stream = canvasStream;
        } else {
          stream = await getNormalDesktopStream();
        }
        
        currentStreamRef.current = stream;

        stream.getTracks().forEach(track => {
          if (track.kind === 'video') {
            track.enabled = !privacyModeRef.current;
          }
          const sender = pc.addTrack(track, stream);
          if (track.kind === 'video') {
            videoSenderRef.current = sender;
          }
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

    // Handle lock/unlock state transitions dynamically
    const unsubscribeLockStatus = window.electronAPI.onLockStatusChanged(async (isLocked) => {
      console.log('Lock status changed to:', isLocked);
      if (!peerRef.current || !videoSenderRef.current) return;

      try {
        let newStream;
        if (isLocked) {
          console.log('Switching to canvas lock overlay...');
          startLockAnimation();
          newStream = canvasStream;
          // Stop old normal stream tracks to release device capture
          if (currentStreamRef.current && currentStreamRef.current !== canvasStream) {
            currentStreamRef.current.getTracks().forEach(t => t.stop());
          }
        } else {
          console.log('Switching back to standard user desktop stream...');
          stopLockAnimation();
          // Small delay to ensure DWM session transitions are complete
          await new Promise(r => setTimeout(r, 1500));
          newStream = await getNormalDesktopStream();
        }

        const newTrack = newStream.getVideoTracks()[0];
        if (newTrack) {
          newTrack.enabled = !privacyModeRef.current;
          await videoSenderRef.current.replaceTrack(newTrack);
          currentStreamRef.current = newStream;
          console.log('WebRTC track replaced successfully.');
        }
      } catch (err) {
        console.error('Failed to handle lock/unlock stream transition:', err);
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
      if (unsubscribePrivacy) unsubscribePrivacy();
      if (unsubscribeLockStatus) unsubscribeLockStatus();
      stopLockAnimation();
      if (currentStreamRef.current && currentStreamRef.current !== canvasStream) {
        currentStreamRef.current.getTracks().forEach(t => t.stop());
      }
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

