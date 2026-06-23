import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { devices as devicesApi, sessions as sessionsApi } from '../services/api';
import { signalRService } from '../services/signalr';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ─── Sub-components ───────────────────────────────────────────────────────────

function TerminalPanel({ deviceId, sessionId }) {
  const [output, setOutput] = useState([{ text: '$ IT Console Remote Terminal', type: 'prompt' }]);
  const [input, setInput] = useState('');
  const [shell, setShell] = useState('powershell');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const runCommand = async () => {
    if (!input.trim()) return;
    setOutput(prev => [...prev, { text: `${shell}> ${input}`, type: 'prompt' }]);
    setHistory(prev => [input, ...prev].slice(0, 50));
    setHistoryIndex(-1);

    await signalRService.executeCommand(deviceId, sessionId, shell, input);
    setInput('');
  };

  // Listen for command output via event
  useEffect(() => {
    const handler = (e) => {
      setOutput(prev => [...prev, {
        text: e.detail.output,
        type: e.detail.isError ? 'error' : 'success'
      }]);
    };
    window.addEventListener('command-output', handler);
    return () => window.removeEventListener('command-output', handler);
  }, []);

  return (
    <div className="terminal" style={{ height: '100%', minHeight: 300 }}>
      <div className="terminal-header">
        <div className="terminal-dots">
          <div className="terminal-dot red" />
          <div className="terminal-dot yellow" />
          <div className="terminal-dot green" />
        </div>
        <select
          className="form-select form-input"
          style={{ padding: '2px 8px', fontSize: 12, width: 'auto', marginLeft: 'auto' }}
          value={shell}
          onChange={e => setShell(e.target.value)}
        >
          <option value="powershell">PowerShell</option>
          <option value="cmd">CMD</option>
          <option value="bash">Bash (Mac)</option>
        </select>
      </div>
      <div className="terminal-output" ref={outputRef}>
        {output.map((line, i) => (
          <p key={i} className={`terminal-line ${line.type}`}>{line.text}</p>
        ))}
      </div>
      <div className="terminal-input-row">
        <span className="terminal-prompt-label">{shell}&gt;</span>
        <input
          className="terminal-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') runCommand();
            if (e.key === 'ArrowUp') {
              const idx = Math.min(historyIndex + 1, history.length - 1);
              setHistoryIndex(idx);
              setInput(history[idx] || '');
            }
            if (e.key === 'ArrowDown') {
              const idx = Math.max(historyIndex - 1, -1);
              setHistoryIndex(idx);
              setInput(idx === -1 ? '' : history[idx]);
            }
          }}
          placeholder="Type command and press Enter..."
          autoFocus
        />
      </div>
    </div>
  );
}

function ChatPanel({ deviceId, sessionId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const messagesRef = useRef(null);
  const typingTimer = useRef(null);

  useEffect(() => {
    signalRService.connectChat(
      sessionId,
      (msg) => {
        setMessages(prev => [...prev, msg]);
        setTimeout(() => {
          if (messagesRef.current)
            messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
        }, 50);
      },
      (username, isTyping) => setTyping(isTyping ? username : false)
    ).catch(console.error);
  }, [sessionId]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    await signalRService.sendChatMessage(sessionId, input, null);
    setInput('');
  };

  const handleInputChange = (val) => {
    setInput(val);
    signalRService.sendTyping(sessionId, true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => signalRService.sendTyping(sessionId, false), 2000);
  };

  return (
    <div className="chat-panel">
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
        💬 Session Chat
      </div>
      <div className="chat-messages" ref={messagesRef}>
        {messages.map(msg => (
          <div key={msg.id} className={`chat-bubble ${msg.isEngineer ? 'from-engineer' : 'from-user'}`}>
            <div className="bubble-text">{msg.message}</div>
            <div className="bubble-meta">
              {msg.senderName} · {new Date(msg.sentAt).toLocaleTimeString()}
            </div>
          </div>
        ))}
        {typing && (
          <div className="chat-bubble from-user">
            <div className="bubble-text" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {typing} is typing...
            </div>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <input
          className="form-input"
          style={{ flex: 1 }}
          placeholder="Type a message..."
          value={input}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
        />
        <button className="btn btn-primary btn-sm" onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}

// ─── Main Remote Session Page ─────────────────────────────────────────────────
function RemoteSessionPage() {
  const { deviceId } = useParams();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const navigate = useNavigate();

  const [device, setDevice] = useState(null);
  const [session, setSession] = useState(null);
  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('remote'); // remote | terminal | processes | files | chat
  const [blackout, setBlackout] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [annotation, setAnnotation] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState('C:\\');
  const [fileLoading, setFileLoading] = useState(false);
  const [transferringFile, setTransferringFile] = useState(null);
  const [showCadDropdown, setShowCadDropdown] = useState(false);

  const videoRef = useRef(null);
  const peerRef = useRef(null);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);
  const lastMouseMoveTime = useRef(0);
  const lastClipboardRef = useRef('');

  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    loadDevice();
    initWebRTC().catch(e => console.warn('WebRTC Init Aborted:', e.message));

    return () => {
      cleanup();
      initialized.current = false;
    };
  }, [deviceId]);

  useEffect(() => {
    const handleDirListing = (e) => {
      if (Array.isArray(e.detail)) {
        setFiles(e.detail);
      } else if (e.detail && e.detail.error) {
        toast.error(`Error: ${e.detail.error}`);
        setFiles([]);
      } else {
        setFiles([]);
      }
      setFileLoading(false);
    };
    window.addEventListener('directory-listing', handleDirListing);

    if (connected) {
      setFileLoading(true);
      signalRService.listDirectory(parseInt(deviceId), currentPath);
    }

    return () => {
      window.removeEventListener('directory-listing', handleDirListing);
    };
  }, [connected, deviceId]);

  // Handle click outside dropdown to close it
  useEffect(() => {
    if (!showCadDropdown) return;
    const handleOutsideClick = (e) => {
      if (!e.target.closest('#btn-cad-dropdown')) {
        setShowCadDropdown(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [showCadDropdown]);

  // Auto sync admin clipboard to remote agent
  useEffect(() => {
    if (!connected || !window.electronAPI) return;
    const interval = setInterval(async () => {
      try {
        const currentText = await window.electronAPI.clipboardRead();
        if (currentText && currentText !== lastClipboardRef.current) {
          lastClipboardRef.current = currentText;
          await signalRService.syncClipboard(parseInt(deviceId), currentText);
        }
      } catch (err) {
        // ignore
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [connected, deviceId]);

  async function loadDevice() {
    const d = await devicesApi.getById(parseInt(deviceId));
    setDevice(d);
    const s = await sessionsApi.getById(parseInt(sessionId));
    setSession(s);
  }

  async function initWebRTC() {
    // Connect SignalR for remote control
    const connId = await signalRService.connectRemoteControl({
      onAnswer: async (sdp) => {
        await peerRef.current?.setRemoteDescription({ type: 'answer', sdp });
        setConnected(true);
      },
      onIceCandidate: async (candidateJson) => {
        const candidate = JSON.parse(candidateJson);
        await peerRef.current?.addIceCandidate(candidate);
      },
      onCommandOutput: (output, isError) => {
        window.dispatchEvent(new CustomEvent('command-output', { detail: { output, isError } }));
      },
      onDirectoryListing: (json) => {
        window.dispatchEvent(new CustomEvent('directory-listing', { detail: JSON.parse(json) }));
      },
      onProcessList: (json) => {
        window.dispatchEvent(new CustomEvent('process-list', { detail: JSON.parse(json) }));
      },
      onRegistryData: (json) => {
        window.dispatchEvent(new CustomEvent('registry-data', { detail: JSON.parse(json) }));
      },
      onClipboardData: (text) => {
        lastClipboardRef.current = text;
        if (window.electronAPI) {
          window.electronAPI.clipboardWrite(text);
        } else {
          navigator.clipboard.writeText(text);
        }
        toast.success('Clipboard synced from remote PC', { toastId: 'clipboard-sync' });
      },
      onFileDownloadReady: (fileId, fileName) => {
        const downloadUrl = `${BASE_URL}/api/files/download/${fileId}?name=${encodeURIComponent(fileName)}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success(`Downloaded: ${fileName}`);
        setTransferringFile(null);
      }
    });

    // Create RTCPeerConnection
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerRef.current = pc;

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        // Find agent connection ID via API
        await signalRService.sendIceCandidate('agent', event.candidate);
      }
    };

    // Create offer
    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
    await pc.setLocalDescription(offer);
    await signalRService.sendOffer(parseInt(deviceId), offer.sdp);
  }

  function cleanup() {
    peerRef.current?.close();
    if (signalRService.remoteControlHub) {
       signalRService.remoteControlHub.stop().catch(() => {});
    }
  }

  async function handleEndSession() {
    try {
      await sessionsApi.end(parseInt(sessionId), null);
      toast.success('Session ended');
      navigate('/devices');
    } catch (e) {
      toast.error('Failed to end session');
    }
  }

  async function toggleBlackout() {
    const newVal = !blackout;
    setBlackout(newVal);
    await signalRService.setBlackout(parseInt(deviceId), parseInt(sessionId), newVal,
      newVal ? 'IT maintenance in progress. Please wait.' : null);
    toast.info(newVal ? '🖤 Screen blackout enabled' : '✅ Blackout removed');
  }

  async function togglePrivacy() {
    const newVal = !privacyMode;
    setPrivacyMode(newVal);
    await signalRService.setPrivacyMode(parseInt(deviceId), parseInt(sessionId), newVal);
    toast.info(newVal ? '🔒 Privacy mode ON' : '🔓 Privacy mode OFF');
  }

  async function handleClipboardSync() {
    const text = await window.electronAPI?.clipboardRead();
    if (text) {
      await signalRService.syncClipboard(parseInt(deviceId), text);
      toast.success('Clipboard synced to remote');
    }
  }

  async function handleClipboardPull() {
    await signalRService.requestClipboard(parseInt(deviceId));
    toast.info('Requesting clipboard from remote PC...');
  }

  const toggleFullscreen = () => {
    const wrap = document.querySelector('.viewer-canvas-wrap');
    if (!wrap) return;
    if (!document.fullscreenElement) {
      wrap.requestFullscreen().catch((err) => {
        toast.error(`Error enabling fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Mouse/keyboard relay
  const handleMouseMove = useCallback(async (e) => {
    if (annotation || !connected) return;
    const now = Date.now();
    if (now - lastMouseMoveTime.current < 50) return; // Throttle to 20 events per second
    lastMouseMoveTime.current = now;

    const video = videoRef.current;
    const rect = video?.getBoundingClientRect();
    if (!rect || video.videoWidth === 0 || video.videoHeight === 0) return;

    const videoRatio = video.videoWidth / video.videoHeight;
    const rectRatio = rect.width / rect.height;
    let contentWidth = rect.width;
    let contentHeight = rect.height;
    let contentLeft = rect.left;
    let contentTop = rect.top;

    if (rectRatio > videoRatio) {
      // Pillarbox (black bars on left/right)
      contentWidth = rect.height * videoRatio;
      contentLeft = rect.left + (rect.width - contentWidth) / 2;
    } else {
      // Letterbox (black bars on top/bottom)
      contentHeight = rect.width / videoRatio;
      contentTop = rect.top + (rect.height - contentHeight) / 2;
    }

    const ratioX = (e.clientX - contentLeft) / contentWidth;
    const ratioY = (e.clientY - contentTop) / contentHeight;
    
    // Clamp ratios to [0, 1] to prevent out of bounds clicks
    const clampedX = Math.max(0, Math.min(1, ratioX));
    const clampedY = Math.max(0, Math.min(1, ratioY));

    const x = Math.round(clampedX * 10000);
    const y = Math.round(clampedY * 10000);
    await signalRService.sendMouseMove(parseInt(deviceId), x, y);
  }, [annotation, connected, deviceId]);

  const handleMouseClick = useCallback(async (e) => {
    if (annotation || !connected) return;
    const video = videoRef.current;
    const rect = video?.getBoundingClientRect();
    if (!rect || video.videoWidth === 0 || video.videoHeight === 0) return;

    const videoRatio = video.videoWidth / video.videoHeight;
    const rectRatio = rect.width / rect.height;
    let contentWidth = rect.width;
    let contentHeight = rect.height;
    let contentLeft = rect.left;
    let contentTop = rect.top;

    if (rectRatio > videoRatio) {
      // Pillarbox (black bars on left/right)
      contentWidth = rect.height * videoRatio;
      contentLeft = rect.left + (rect.width - contentWidth) / 2;
    } else {
      // Letterbox (black bars on top/bottom)
      contentHeight = rect.width / videoRatio;
      contentTop = rect.top + (rect.height - contentHeight) / 2;
    }

    const ratioX = (e.clientX - contentLeft) / contentWidth;
    const ratioY = (e.clientY - contentTop) / contentHeight;
    
    // Clamp ratios to [0, 1] to prevent out of bounds clicks
    const clampedX = Math.max(0, Math.min(1, ratioX));
    const clampedY = Math.max(0, Math.min(1, ratioY));

    const x = Math.round(clampedX * 10000);
    const y = Math.round(clampedY * 10000);
    await signalRService.sendMouseClick(parseInt(deviceId), x, y, e.button);
  }, [annotation, connected, deviceId]);

  const handleKeyDown = useCallback(async (e) => {
    if (!connected || document.activeElement.tagName === 'INPUT') return;
    e.preventDefault();
    await signalRService.sendKeyEvent(
      parseInt(deviceId), e.key, true,
      e.ctrlKey, e.altKey, e.shiftKey
    );
  }, [connected, deviceId]);

  // Annotation canvas
  function startDraw(e) {
    if (!annotation) return;
    isDrawing.current = true;
    const rect = canvasRef.current.getBoundingClientRect();
    lastPos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function draw(e) {
    if (!annotation || !isDrawing.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const rect = canvasRef.current.getBoundingClientRect();
    const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    ctx.strokeStyle = '#FF4444';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  }

  function stopDraw() { isDrawing.current = false; }

  function clearAnnotations() {
    const ctx = canvasRef.current?.getContext('2d');
    ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* Session info bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
        borderBottom: '1px solid var(--border)', marginBottom: 12
      }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/devices')}>← Back</button>
        {device && (
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 700 }}>{device.hostname}</span>
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>{device.iPAddress}</span>
            {connected
              ? <span className="badge badge-online" style={{ marginLeft: 10 }}>● Connected</span>
              : <span className="badge badge-warning" style={{ marginLeft: 10 }}>⟳ Connecting...</span>
            }
          </div>
        )}
        <button className="btn btn-danger btn-sm" onClick={handleEndSession}>⏹ End Session</button>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-3">
        {[
          { id: 'remote', icon: '🖥️', label: 'Remote View' },
          { id: 'terminal', icon: '💻', label: 'Terminal' },
          { id: 'files', icon: '📁', label: 'File Explorer' },
          { id: 'chat', icon: '💬', label: 'Chat' },
        ].map(tab => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', gap: 12 }}>
        {activeTab === 'remote' && (
          <div className="remote-viewer" style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}>
            {/* Toolbar */}
            <div className="viewer-toolbar">
              <div className="toolbar-group">
                <button
                  id="btn-blackout"
                  className={`toolbar-btn ${blackout ? 'active' : ''}`}
                  title="Screen Blackout"
                  onClick={toggleBlackout}
                >🖤</button>
                <button
                  id="btn-privacy"
                  className={`toolbar-btn ${privacyMode ? 'active' : ''}`}
                  title="Privacy Mode"
                  onClick={togglePrivacy}
                >🔒</button>
              </div>

              <div className="toolbar-group">
                <button
                  id="btn-annotate"
                  className={`toolbar-btn ${annotation ? 'active' : ''}`}
                  title="Annotation"
                  onClick={() => setAnnotation(!annotation)}
                >✏️</button>
                {annotation && (
                  <button className="toolbar-btn" title="Clear" onClick={clearAnnotations}>🗑️</button>
                )}
              </div>

              <div className="toolbar-group">
                <button className="toolbar-btn" title="Zoom Out" onClick={() => setZoom(z => Math.max(50, z - 10))}>−</button>
                <span style={{ fontSize: 12, padding: '0 4px', color: 'var(--text-muted)' }}>{zoom}%</span>
                <button className="toolbar-btn" title="Zoom In" onClick={() => setZoom(z => Math.min(200, z + 10))}>+</button>
                <button className="toolbar-btn" title="Fit" onClick={() => setZoom(100)}>⊡</button>
                <button className="toolbar-btn" title="Toggle Fullscreen" onClick={toggleFullscreen}>⛶</button>
              </div>

              <div className="toolbar-group">
                <button id="btn-clipboard" className="toolbar-btn" title="Sync Clipboard to Remote" onClick={handleClipboardSync}>📋📤</button>
                <button id="btn-clipboard-pull" className="toolbar-btn" title="Get Clipboard from Remote" onClick={handleClipboardPull}>📋📥</button>
              </div>

              <div className="toolbar-group" style={{ marginLeft: 'auto', position: 'relative' }}>
                <button
                  id="btn-cad-dropdown"
                  className="toolbar-btn danger"
                  title="Ctrl+Alt+Del Options"
                  onClick={() => setShowCadDropdown(!showCadDropdown)}
                  style={{ width: 'auto', padding: '0 8px', display: 'flex', gap: '4px', alignItems: 'center' }}
                >
                  <span>⌨️ CAD</span>
                  <span style={{ fontSize: 9 }}>▼</span>
                </button>
                
                {showCadDropdown && (
                  <div
                    className="cad-dropdown-menu"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 4,
                      marginTop: 8,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      boxShadow: 'var(--shadow-lg)',
                      zIndex: 100,
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 170,
                      overflow: 'hidden'
                    }}
                  >
                    <button
                      className="cad-dropdown-item"
                      style={{
                        padding: '8px 12px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-primary)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: 12,
                        transition: 'background 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      onClick={() => {
                        signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'cad');
                        setShowCadDropdown(false);
                        toast.info('Sending Ctrl+Alt+Delete command to remote host...');
                      }}
                    >
                      ⌨️ Send Ctrl+Alt+Del
                    </button>
                    <button
                      className="cad-dropdown-item"
                      style={{
                        padding: '8px 12px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-primary)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: 12,
                        transition: 'background 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      onClick={() => {
                        signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'lock');
                        setShowCadDropdown(false);
                        toast.info('Locking workstation...');
                      }}
                    >
                      🔒 Lock Workstation
                    </button>
                    <button
                      className="cad-dropdown-item"
                      style={{
                        padding: '8px 12px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-primary)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: 12,
                        transition: 'background 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      onClick={() => {
                        signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'taskmgr');
                        setShowCadDropdown(false);
                        toast.info('Opening Task Manager...');
                      }}
                    >
                      ⚙️ Open Task Manager
                    </button>
                    <button
                      className="cad-dropdown-item"
                      style={{
                        padding: '8px 12px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-primary)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: 12,
                        transition: 'background 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      onClick={() => {
                        signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'logoff');
                        setShowCadDropdown(false);
                        toast.info('Signing out remote user...');
                      }}
                    >
                      👤 Sign Out (Log Off)
                    </button>
                  </div>
                )}

                <button
                  className="toolbar-btn danger"
                  title="Restart"
                  onClick={() => signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'restart')}
                >🔄</button>
                <button
                  className="toolbar-btn danger"
                  title="Shutdown"
                  onClick={() => signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'shutdown')}
                >⏻</button>
              </div>
            </div>

            {/* Video Canvas */}
            <div
              className="viewer-canvas-wrap"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              style={{ position: 'relative' }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="viewer-canvas"
                style={{ transform: `scale(${zoom / 100})` }}
                onMouseMove={handleMouseMove}
                onClick={handleMouseClick}
                onContextMenu={(e) => { e.preventDefault(); handleMouseClick({ ...e, button: 2 }); }}
              />
              <canvas
                ref={canvasRef}
                className={`annotation-canvas ${annotation ? 'active' : ''}`}
                width={1920}
                height={1080}
                style={{ transform: `scale(${zoom / 100})` }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
              />
              {!connected && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex',
                  flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.8)'
                }}>
                  <div className="loading-spinner lg" />
                  <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>Establishing connection...</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'terminal' && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <TerminalPanel deviceId={parseInt(deviceId)} sessionId={parseInt(sessionId)} />
          </div>
        )}

        {activeTab === 'files' && (
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className="card-title">📁 Remote File Explorer</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                className="form-input"
                value={currentPath}
                onChange={e => setCurrentPath(e.target.value)}
                placeholder="Folder Path (e.g. C:\)"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setFileLoading(true);
                  signalRService.listDirectory(parseInt(deviceId), currentPath);
                }}
              >Go / Refresh</button>
            </div>
            
            {fileLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div className="loading-spinner" />
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Size</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Up one level */}
                    <tr>
                      <td
                        style={{ cursor: 'pointer', color: 'var(--accent-blue)', fontWeight: 600 }}
                        onClick={() => {
                          const parts = currentPath.split('\\').filter(Boolean);
                          if (parts.length > 1) {
                            parts.pop();
                            const newPath = parts.join('\\') + '\\';
                            setCurrentPath(newPath);
                            setFileLoading(true);
                            signalRService.listDirectory(parseInt(deviceId), newPath);
                          }
                        }}
                      >
                        📁 .. (Up One Level)
                      </td>
                      <td>Folder</td>
                      <td>—</td>
                      <td>—</td>
                    </tr>
                    {files.map((file, i) => (
                      <tr key={i}>
                        <td
                          style={{
                            cursor: file.isDirectory ? 'pointer' : 'default',
                            fontWeight: file.isDirectory ? 600 : 'normal',
                            color: file.isDirectory ? 'var(--accent-blue)' : 'inherit'
                          }}
                          onClick={() => {
                            if (file.isDirectory) {
                              setCurrentPath(file.path);
                              setFileLoading(true);
                              signalRService.listDirectory(parseInt(deviceId), file.path);
                            }
                          }}
                        >
                          {file.isDirectory ? '📁' : '📄'} {file.name}
                        </td>
                        <td>{file.isDirectory ? 'Folder' : 'File'}</td>
                        <td>{file.isDirectory ? '—' : `${(file.size / 1024).toFixed(1)} KB`}</td>
                        <td>
                          {!file.isDirectory && (
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={transferringFile !== null}
                              onClick={async () => {
                                setTransferringFile(file.name);
                                toast.info(`Requesting file download: ${file.name}`);
                                await signalRService.requestFileDownload(parseInt(deviceId), file.path);
                              }}
                            >
                              {transferringFile === file.name ? '⏳ Preparing...' : '📥 Take File'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'chat' && sessionId && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ChatPanel deviceId={parseInt(deviceId)} sessionId={parseInt(sessionId)} />
          </div>
        )}
      </div>
    </div>
  );
}

export default RemoteSessionPage;
