import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { devices as devicesApi, sessions as sessionsApi } from '../services/api';
import { signalRService } from '../services/signalr';
import FileTransferSidebar from '../components/FileTransferSidebar';

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
  const [annotation, setAnnotation] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState('C:\\');
  const [fileLoading, setFileLoading] = useState(false);
  const [transferringFile, setTransferringFile] = useState(null);
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);
  const [showFileTransferSidebar, setShowFileTransferSidebar] = useState(false);
  const [customLaunchInput, setCustomLaunchInput] = useState('');
  const [keepAwake, setKeepAwake] = useState(false);
  const [secureDesktopActive, setSecureDesktopActive] = useState(false);
  const [secureDesktopFrame, setSecureDesktopFrame] = useState(null);
  const [activeDesktopName, setActiveDesktopName] = useState('Default');
  const imgRef = useRef(null);

  const videoRef = useRef(null);
  const peerRef = useRef(null);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);
  const lastMouseMoveTime = useRef(0);
  const lastClipboardRef = useRef('');
  const targetFoldersRef = useRef({});
  const localCursorRef = useRef(null);

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
    if (!showToolsDropdown) return;
    const handleOutsideClick = (e) => {
      if (!e.target.closest('#btn-tools-dropdown')) {
        setShowToolsDropdown(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [showToolsDropdown]);

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

  // Intercept paste events when focusing the remote viewer to support browser clipboard sync fallback
  useEffect(() => {
    const handlePaste = async (e) => {
      if (activeTab !== 'remote' || !connected || !deviceId) return;
      const text = e.clipboardData?.getData('text');
      if (text) {
        try {
          lastClipboardRef.current = text;
          await signalRService.syncClipboard(parseInt(deviceId), text);
          console.log('[Clipboard] Synced via paste event:', text);
        } catch (err) {
          console.warn('[Clipboard] Failed to sync clipboard on paste:', err);
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeTab, connected, deviceId]);

  async function loadDevice() {
    const d = await devicesApi.getById(parseInt(deviceId));
    setDevice(d);
    const s = await sessionsApi.getById(parseInt(sessionId));
    setSession(s);
    if (s) {
      setBlackout(s.blackoutMode);
    }
  }

  async function startPeerConnection() {
    if (peerRef.current) {
      try {
        peerRef.current.close();
      } catch (e) { }
      peerRef.current = null;
    }

    setConnected(false);

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
      if (event.candidate && peerRef.current === pc) {
        await signalRService.sendIceCandidate('agent', event.candidate).catch(() => { });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn('WebRTC connection lost. Auto-reconnecting in 3 seconds...');
        setTimeout(() => {
          if (peerRef.current === pc && (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected')) {
            startPeerConnection().catch(e => console.warn('Auto-reconnect failed:', e.message));
          }
        }, 3000);
      }
    };

    // Create offer
    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
    await pc.setLocalDescription(offer);
    await signalRService.sendOffer(parseInt(deviceId), offer.sdp);
  }

  async function initWebRTC() {
    // Connect SignalR for remote control (only if not already connected)
    if (!signalRService.remoteControlHub) {
      await signalRService.connectRemoteControl({
        onAnswer: async (sdp) => {
          await peerRef.current?.setRemoteDescription({ type: 'answer', sdp });
          setConnected(true);
        },
        onIceCandidate: async (candidateJson) => {
          const candidate = JSON.parse(candidateJson);
          await peerRef.current?.addIceCandidate(candidate).catch(() => { });
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
        onClipboardData: async (text) => {
          try {
            if (text.startsWith('{"type":"files",')) {
              const data = JSON.parse(text);
              toast.info(`Syncing ${data.paths.length} file(s) from remote clipboard...`);
              for (const remotePath of data.paths) {
                await signalRService.requestFileDownload(parseInt(deviceId), remotePath);
              }
              return;
            }
          } catch (e) {
            // Ignore parse errors, treat as text
          }

          lastClipboardRef.current = text;
          if (window.electronAPI) {
            window.electronAPI.clipboardWrite(text);
          } else {
            navigator.clipboard.writeText(text);
          }
          toast.success('Clipboard synced from remote PC', { toastId: 'clipboard-sync' });
        },
        onFileDownloadReady: async (fileId, fileName) => {
          const downloadUrl = `${BASE_URL}/api/files/download/${fileId}?name=${encodeURIComponent(fileName)}`;
          const localTargetFolder = targetFoldersRef.current[fileName];
          
          if (localTargetFolder && localTargetFolder !== 'drives') {
            delete targetFoldersRef.current[fileName];
            if (window.electronAPI && window.electronAPI.downloadFileToDirectory) {
              try {
                await window.electronAPI.downloadFileToDirectory(downloadUrl, fileName, localTargetFolder);
                toast.success(`File received: saved to ${localTargetFolder}\\${fileName}`);
                window.dispatchEvent(new CustomEvent('local-directory-changed', { detail: { path: localTargetFolder } }));
              } catch (err) {
                console.error('Failed to download file to target directory:', err.message);
                toast.error(`Failed to save ${fileName} to local folder.`);
              }
            } else {
              const link = document.createElement('a');
              link.href = downloadUrl;
              link.setAttribute('download', fileName);
              document.body.appendChild(link);
              link.click();
              link.remove();
            }
          } else {
            if (window.electronAPI && window.electronAPI.downloadFileAndCopyToClipboard) {
              try {
                await window.electronAPI.downloadFileAndCopyToClipboard(downloadUrl, fileName);
                toast.success(`Copied to local clipboard: ${fileName}`);
              } catch (err) {
                console.error('Failed to copy downloaded file to local clipboard:', err.message);
                toast.error(`Failed to copy ${fileName} to clipboard`);
              }
            } else {
              const link = document.createElement('a');
              link.href = downloadUrl;
              link.setAttribute('download', fileName);
              document.body.appendChild(link);
              link.click();
              link.remove();
              toast.success(`Downloaded: ${fileName}`);
            }
          }
          setTransferringFile(null);
        },
        onSecureDesktopFrame: (base64Frame) => {
          setSecureDesktopFrame(base64Frame);
        },
        onActiveDesktop: (desktopName) => {
          const sessionEvents = {
            'WTS_SESSION_LOCK': '🔒 Target machine locked — stream continues',
            'WTS_SESSION_UNLOCK': '🔓 Target machine unlocked',
            'WTS_SESSION_LOGON': '👤 User logged on to target',
            'WTS_SESSION_LOGOFF': '🚪 User logged off target machine',
            'WTS_CONSOLE_CONNECT': '🖥️ Console session connected',
            'WTS_REMOTE_CONNECT': '🌐 RDP session connected to target',
          };
          if (sessionEvents[desktopName]) {
            toast.info(sessionEvents[desktopName], { autoClose: 3000 });
          }

          if (desktopName && desktopName.startsWith('WTS_')) {
            return;
          }

          setActiveDesktopName(desktopName);
          if (desktopName !== 'Default' && desktopName !== 'unknown') {
            setSecureDesktopActive(true);
          } else {
            setSecureDesktopActive(false);
            setSecureDesktopFrame(null);
          }
        }
      });
    }

    await startPeerConnection();
  }

  function cleanup() {
    if (peerRef.current) {
      try {
        peerRef.current.close();
      } catch (e) { }
      peerRef.current = null;
    }
    if (signalRService.remoteControlHub) {
      signalRService.remoteControlHub.stop().catch(() => { });
      signalRService.remoteControlHub = null;
    }
  }

  async function handleReconnect() {
    toast.info('Reconnecting remote stream...');
    try {
      await startPeerConnection();
      toast.success('Remote stream reconnected');
    } catch (err) {
      toast.error(`Reconnection failed: ${err.message}`);
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
    try {
      await signalRService.setBlackout(parseInt(deviceId), parseInt(sessionId), newVal,
        newVal ? 'IT maintenance in progress. Please wait.' : null);
      setBlackout(newVal);
      toast.info(newVal ? '🖤 Screen blackout enabled' : '✅ Blackout removed');
    } catch (e) {
      toast.error('Failed to change blackout state');
    }
  }

  async function handleClipboardSync() {
    let text = '';
    try {
      if (window.electronAPI) {
        text = await window.electronAPI.clipboardRead();
      } else if (navigator.clipboard) {
        text = await navigator.clipboard.readText();
      }
    } catch (err) {
      console.warn('Failed to read local clipboard:', err);
    }
    if (text) {
      try {
        await signalRService.syncClipboard(parseInt(deviceId), text);
        toast.success('Clipboard synced to remote');
      } catch (err) {
        toast.error('Failed to sync clipboard');
      }
    } else {
      toast.warn('Local clipboard is empty or access was denied');
    }
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
  const getMouseCoords = (e) => {
    const element = e.currentTarget;
    const rect = element.getBoundingClientRect();
    const width = element.naturalWidth || element.videoWidth;
    const height = element.naturalHeight || element.videoHeight;
    if (!width || !height) return null;

    const elementRatio = width / height;
    const rectRatio = rect.width / rect.height;
    let contentWidth = rect.width;
    let contentHeight = rect.height;
    let contentLeft = rect.left;
    let contentTop = rect.top;

    if (rectRatio > elementRatio) {
      contentWidth = rect.height * elementRatio;
      contentLeft = rect.left + (rect.width - contentWidth) / 2;
    } else {
      contentHeight = rect.width / elementRatio;
      contentTop = rect.top + (rect.height - contentHeight) / 2;
    }

    const ratioX = (e.clientX - contentLeft) / contentWidth;
    const ratioY = (e.clientY - contentTop) / contentHeight;
    const clampedX = Math.max(0, Math.min(1, ratioX));
    const clampedY = Math.max(0, Math.min(1, ratioY));

    return {
      x: Math.round(clampedX * 10000),
      y: Math.round(clampedY * 10000)
    };
  };

  const handleLocalMouseMoveOnly = useCallback((e) => {
    if (annotation || (!connected && !secureDesktopActive)) {
      if (localCursorRef.current) localCursorRef.current.style.display = 'none';
      return;
    }
    if (localCursorRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      localCursorRef.current.style.display = 'block';
      localCursorRef.current.style.left = `${x}px`;
      localCursorRef.current.style.top = `${y}px`;
    }
  }, [annotation, connected, secureDesktopActive]);

  const handleMouseLeave = useCallback(() => {
    if (localCursorRef.current) {
      localCursorRef.current.style.display = 'none';
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (annotation || (!connected && !secureDesktopActive)) return;
    const now = Date.now();
    if (now - lastMouseMoveTime.current < 25) return; // Throttle to 40 events per second
    lastMouseMoveTime.current = now;

    const coords = getMouseCoords(e);
    if (!coords) return;

    if (secureDesktopActive) {
      signalRService.sendSecureDesktopInput(parseInt(deviceId), JSON.stringify({ type: 'move', x: coords.x, y: coords.y }));
    } else {
      signalRService.sendMouseMove(parseInt(deviceId), coords.x, coords.y);
    }
  }, [annotation, connected, deviceId, secureDesktopActive]);

  const handleMouseDown = useCallback((e) => {
    if (annotation || (!connected && !secureDesktopActive)) return;
    const coords = getMouseCoords(e);
    if (!coords) return;

    if (secureDesktopActive) {
      signalRService.sendSecureDesktopInput(parseInt(deviceId), JSON.stringify({ type: 'mousedown', x: coords.x, y: coords.y, button: e.button }));
    } else {
      signalRService.sendMouseDown(parseInt(deviceId), coords.x, coords.y, e.button);
    }
  }, [annotation, connected, deviceId, secureDesktopActive]);

  const handleMouseUp = useCallback((e) => {
    if (annotation || (!connected && !secureDesktopActive)) return;
    const coords = getMouseCoords(e);
    if (!coords) return;

    if (secureDesktopActive) {
      signalRService.sendSecureDesktopInput(parseInt(deviceId), JSON.stringify({ type: 'mouseup', x: coords.x, y: coords.y, button: e.button }));
      // Send a click as well to guarantee interaction
      signalRService.sendSecureDesktopInput(parseInt(deviceId), JSON.stringify({ type: 'click', x: coords.x, y: coords.y, button: e.button }));
    } else {
      signalRService.sendMouseUp(parseInt(deviceId), coords.x, coords.y, e.button);
    }
  }, [annotation, connected, deviceId, secureDesktopActive]);

  const handleWheel = useCallback((e) => {
    if (annotation || (!connected && !secureDesktopActive)) return;
    const delta = e.deltaY > 0 ? -120 : 120;
    if (secureDesktopActive) {
      signalRService.sendSecureDesktopInput(parseInt(deviceId), JSON.stringify({ type: 'wheel', delta }));
    } else {
      signalRService.sendMouseWheel(parseInt(deviceId), delta);
    }
  }, [annotation, connected, deviceId, secureDesktopActive]);

  // Drag and Drop files directly onto the viewer canvas
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    if (!connected) return;
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const file = files[0];
    toast.info(`Uploading file to remote agent: ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${BASE_URL}/api/files/upload`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        const { fileId, fileName } = data;

        // Tell agent to download file to Desktop by default
        const desktopPath = 'C:\\Users\\Public\\Desktop';
        await signalRService.sendFileToAgent(parseInt(deviceId), fileId, fileName, desktopPath);
        toast.success(`File successfully placed on remote Desktop!`);
      } else {
        toast.error('File upload failed');
      }
    } catch (err) {
      toast.error(`Error uploading file: ${err.message}`);
    }
  };

  const handleKeyDown = useCallback(async (e) => {
    if ((!connected && !secureDesktopActive) || document.activeElement.tagName === 'INPUT') return;
    e.preventDefault();
    if (secureDesktopActive) {
      await signalRService.sendSecureDesktopInput(parseInt(deviceId), JSON.stringify({
        type: 'key',
        key: e.key,
        keyCode: e.keyCode,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey
      }));
    } else {
      await signalRService.sendKeyEvent(
        parseInt(deviceId), e.key, true,
        e.ctrlKey, e.altKey, e.shiftKey
      );
    }
  }, [connected, deviceId, secureDesktopActive]);

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
          <div className="remote-viewer" style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden' }}>
            {/* Toolbar */}
            <div className="viewer-toolbar">
              <div className="toolbar-group">
                <button
                  id="btn-blackout"
                  className={`toolbar-btn ${blackout ? 'active' : ''}`}
                  title="Screen Blackout"
                  onClick={toggleBlackout}
                >🖤</button>
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
                <button id="btn-clipboard" className="toolbar-btn" title="Sync Clipboard" onClick={handleClipboardSync}>📋</button>
                <button
                  className={`toolbar-btn ${showFileTransferSidebar ? 'active' : ''}`}
                  title="File Transfer Sidebar"
                  onClick={() => setShowFileTransferSidebar(!showFileTransferSidebar)}
                >📂⇄</button>
                <button
                  className="toolbar-btn"
                  title="Reconnect Stream"
                  onClick={handleReconnect}
                  style={{ width: 'auto', padding: '0 8px', display: 'flex', gap: '4px', fontSize: '12px' }}
                >🔄 Reconnect</button>
              </div>

              <div className="toolbar-group" style={{ marginLeft: 'auto', position: 'relative' }} id="btn-tools-dropdown">
                <button
                  className={`toolbar-btn ${showToolsDropdown ? 'active' : ''}`}
                  title="Quick Tools & System Actions"
                  onClick={() => setShowToolsDropdown(!showToolsDropdown)}
                  style={{ width: 'auto', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 500 }}
                >
                  🛠️ Quick Tools <span style={{ fontSize: '10px' }}>{showToolsDropdown ? '▲' : '▼'}</span>
                </button>

                {showToolsDropdown && (
                  <div className="tools-dropdown-menu" style={{ right: 0, left: 'auto' }}>
                    <div className="tools-dropdown-section">
                      <div className="tools-dropdown-section-title">💻 Administrative Tools</div>
                      <div className="tools-grid">
                        <button className="tools-item-btn" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'cmd');
                          toast.success('Launching Command Prompt on remote PC...');
                        }}>
                          <span className="tools-item-icon">💻</span>
                          <span className="tools-item-text">Command Prompt</span>
                        </button>
                        <button className="tools-item-btn" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'powershell');
                          toast.success('Launching PowerShell on remote PC...');
                        }}>
                          <span className="tools-item-icon">⚡</span>
                          <span className="tools-item-text">PowerShell</span>
                        </button>
                        <button className="tools-item-btn" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'taskmgr');
                          toast.success('Opening Task Manager...');
                        }}>
                          <span className="tools-item-icon">⚙️</span>
                          <span className="tools-item-text">Task Manager</span>
                        </button>
                        <button className="tools-item-btn" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'regedit');
                          toast.success('Opening Registry Editor...');
                        }}>
                          <span className="tools-item-icon">🔑</span>
                          <span className="tools-item-text">Registry Editor</span>
                        </button>
                        <button className="tools-item-btn" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'devmgmt');
                          toast.success('Opening Device Manager...');
                        }}>
                          <span className="tools-item-icon">🔧</span>
                          <span className="tools-item-text">Device Manager</span>
                        </button>
                        <button className="tools-item-btn" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'services');
                          toast.success('Opening Services Manager...');
                        }}>
                          <span className="tools-item-icon">📁</span>
                          <span className="tools-item-text">Services</span>
                        </button>
                        <button className="tools-item-btn" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'eventvwr');
                          toast.success('Opening Event Viewer...');
                        }}>
                          <span className="tools-item-icon">📊</span>
                          <span className="tools-item-text">Event Viewer</span>
                        </button>
                        <button className="tools-item-btn" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'control');
                          toast.success('Opening Control Panel...');
                        }}>
                          <span className="tools-item-icon">🎛️</span>
                          <span className="tools-item-text">Control Panel</span>
                        </button>
                      </div>
                    </div>

                    <div className="tools-dropdown-section">
                      <div className="tools-dropdown-section-title">⚡ System State & Power</div>
                      <div className="tools-grid">
                        <button className="tools-item-btn danger" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'cad');
                          toast.info('Sending Ctrl+Alt+Delete...');
                        }}>
                          <span className="tools-item-icon">🎹</span>
                          <span className="tools-item-text">Send Ctrl+Alt+Del</span>
                        </button>
                        <button className="tools-item-btn danger" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'lock');
                          toast.info('Toggling Workspace Lock overlay...');
                        }}>
                          <span className="tools-item-icon">🔒</span>
                          <span className="tools-item-text">Workspace Lock</span>
                        </button>
                        <button className="tools-item-btn danger" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'wslock');
                          toast.info('Locking Windows workstation...');
                        }}>
                          <span className="tools-item-icon">🖥️</span>
                          <span className="tools-item-text">Lock PC (Native)</span>
                        </button>
                        <button className="tools-item-btn danger" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'logoff');
                          toast.warning('Signing out remote user...');
                        }}>
                          <span className="tools-item-icon">👤</span>
                          <span className="tools-item-text">Sign Out</span>
                        </button>
                        <button className="tools-item-btn danger" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'restart');
                          toast.warning('Restarting remote host...');
                        }}>
                          <span className="tools-item-icon">🔄</span>
                          <span className="tools-item-text">Restart PC</span>
                        </button>
                        <button className="tools-item-btn danger" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'shutdown');
                          toast.warning('Shutting down remote host...');
                        }}>
                          <span className="tools-item-icon">⏻</span>
                          <span className="tools-item-text">Shut Down PC</span>
                        </button>
                        <button className="tools-item-btn danger" onClick={() => {
                          signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), 'safemode');
                          toast.warning('Rebooting to Safe Mode...');
                        }}>
                          <span className="tools-item-icon">🛡️</span>
                          <span className="tools-item-text">Safe Mode</span>
                        </button>
                      </div>
                    </div>

                    <div className="tools-dropdown-section">
                      <div className="tools-dropdown-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>☕ Keep Awake Mode</span>
                        <span style={{ fontSize: '11px', color: keepAwake ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {keepAwake ? '● ACTIVE' : '○ INACTIVE'}
                        </span>
                      </div>
                      <div style={{ padding: '4px 8px' }}>
                        <label className="tools-toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                          <input
                            type="checkbox"
                            checked={keepAwake}
                            onChange={async (e) => {
                              const enabled = e.target.checked;
                              setKeepAwake(enabled);
                              await signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), enabled ? 'awake_on' : 'awake_off');
                              toast.info(enabled ? '☕ Keep Awake enabled (prevent sleep/lock)' : '☕ Keep Awake disabled');
                            }}
                            style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                          />
                          Prevent remote PC from sleeping or locking
                        </label>
                      </div>
                    </div>

                    <div className="tools-dropdown-section" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
                      <div className="tools-dropdown-section-title">🚀 Launch Custom App / Open URL</div>
                      <div style={{ display: 'flex', gap: '8px', padding: '4px 0 8px 0' }}>
                        <input
                          className="form-input"
                          style={{ flex: 1, padding: '4px 8px', fontSize: '12px', height: '28px' }}
                          placeholder="calc.exe, notepad.exe, or https://google.com..."
                          value={customLaunchInput}
                          onChange={e => setCustomLaunchInput(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              const val = customLaunchInput.trim();
                              if (!val) return;
                              const isUrl = val.startsWith('http://') || val.startsWith('https://') || val.includes('.');
                              const cmd = isUrl ? `url:${val}` : `run:${val}`;
                              await signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), cmd);
                              toast.success(`Sent launch command for: ${val}`);
                              setCustomLaunchInput('');
                            }
                          }}
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ height: '28px', padding: '0 12px', fontSize: '12px' }}
                          onClick={async () => {
                            const val = customLaunchInput.trim();
                            if (!val) return;
                            const isUrl = val.startsWith('http://') || val.startsWith('https://') || val.includes('.');
                            const cmd = isUrl ? `url:${val}` : `run:${val}`;
                            await signalRService.sendPowerCommand(parseInt(deviceId), parseInt(sessionId), cmd);
                            toast.success(`Sent launch command for: ${val}`);
                            setCustomLaunchInput('');
                          }}
                        >
                          Launch
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Video Canvas */}
            <div
              className="viewer-canvas-wrap"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onMouseMove={handleLocalMouseMoveOnly}
              onMouseLeave={handleMouseLeave}
              style={{ position: 'relative', flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', overflow: 'hidden' }}
            >
              {/* Local Cursor Overlay */}
              <div 
                ref={localCursorRef}
                style={{
                  position: 'absolute',
                  width: '16px',
                  height: '25px',
                  pointerEvents: 'none',
                  zIndex: 100,
                  display: 'none',
                  backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'25\' viewBox=\'0 0 16 25\'><path fill=\'white\' stroke=\'black\' stroke-width=\'1.5\' d=\'M0,0 L0,18.5 L4.8,13.7 L8.8,22.8 L12.1,21.3 L8.2,12.4 L13.8,12.4 Z\'/></svg>")',
                  backgroundSize: 'contain',
                  backgroundRepeat: 'no-repeat'
                }}
              />
              {secureDesktopActive && (
                <div style={{
                  position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
                  background: 'rgba(59, 130, 246, 0.9)', backdropFilter: 'blur(8px)',
                  color: '#fff', padding: '6px 16px', borderRadius: '9999px', fontSize: 12,
                  fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', display: 'flex',
                  alignItems: 'center', gap: 6, zIndex: 10
                }}>
                  <span style={{ width: 8, height: 8, background: '#10B981', borderRadius: '50%', display: 'inline-block' }}></span>
                  SECURE DESKTOP ACTIVE ({activeDesktopName.toUpperCase()})
                </div>
              )}
              {secureDesktopActive && secureDesktopFrame ? (
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${secureDesktopFrame}`}
                  className="viewer-canvas"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${zoom / 100})`, cursor: 'none' }}
                  onMouseMove={handleMouseMove}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  onWheel={handleWheel}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onContextMenu={(e) => { e.preventDefault(); }}
                />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="viewer-canvas"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${zoom / 100})`, cursor: 'none' }}
                  onMouseMove={handleMouseMove}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  onWheel={handleWheel}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onContextMenu={(e) => { e.preventDefault(); }}
                />
              )}
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
              {!connected && !secureDesktopActive && (
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
        {activeTab === 'remote' && showFileTransferSidebar && (
          <FileTransferSidebar
            deviceId={deviceId}
            onClose={() => setShowFileTransferSidebar(false)}
            serverUrl={BASE_URL}
            remotePath={currentPath}
            remoteItems={files}
            onNavigateRemote={(path) => {
              setCurrentPath(path);
              setFileLoading(true);
              signalRService.listDirectory(parseInt(deviceId), path);
            }}
            onDownloadRequest={(fileName, localTargetFolder) => {
              targetFoldersRef.current[fileName] = localTargetFolder;
            }}
          />
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

              <input
                type="file"
                id="file-upload-input"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  setTransferringFile(file.name);
                  toast.info(`Uploading file to remote agent: ${file.name}...`);
                  try {
                    const formData = new FormData();
                    formData.append('file', file);

                    const response = await fetch(`${BASE_URL}/api/files/upload`, {
                      method: 'POST',
                      body: formData
                    });

                    if (response.ok) {
                      const data = await response.json();
                      const { fileId, fileName } = data;
                      toast.info(`Sending ${fileName} to remote PC target folder...`);
                      await signalRService.sendFileToAgent(parseInt(deviceId), fileId, fileName, currentPath);
                      toast.success(`File successfully sent to remote folder: ${currentPath}`);
                    } else {
                      toast.error('File upload failed');
                    }
                  } catch (err) {
                    toast.error(`Error sending file: ${err.message}`);
                  } finally {
                    setTransferringFile(null);
                    e.target.value = '';
                  }
                }}
              />
              <button
                className="btn btn-success btn-sm"
                onClick={() => document.getElementById('file-upload-input').click()}
                disabled={transferringFile !== null}
              >
                {transferringFile ? '⏳ Sending...' : '📤 Send File'}
              </button>
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
