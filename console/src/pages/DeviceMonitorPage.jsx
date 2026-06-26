import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { devices as devicesApi, sessions as sessionsApi } from '../services/api';
import { signalRService } from '../services/signalr';
import * as signalR from '@microsoft/signalr';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ─── Local Storage helpers ───────────────────────────────────────────────────
const GROUPS_KEY = 'itconsole_device_groups';

function loadGroups() {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY)) || [];
  } catch { return []; }
}

function saveGroups(groups) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
}

// ─── Format helpers ───────────────────────────────────────────────────────────
function formatUptime(seconds) {
  if (!seconds) return 'N/A';
  const h = Math.floor(seconds / 3600);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

// ─── Per-device WebRTC stream manager ────────────────────────────────────────
async function createViewStream(deviceId, onStream, onStateChange) {
  const token = localStorage.getItem('accessToken') || '';

  const hub = new signalR.HubConnectionBuilder()
    .withUrl(`${BASE_URL}/hubs/remote-control`, {
      accessTokenFactory: () => token
    })
    .withAutomaticReconnect([0, 2000, 5000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      onStream(event.streams[0]);
      onStateChange('connected');
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      onStateChange('disconnected');
    }
  };

  hub.on('ReceiveAnswer', async (sdp) => {
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (e) {}
  });

  hub.on('ReceiveIceCandidate', async (candidateJson) => {
    try {
      const candidate = JSON.parse(candidateJson);
      await pc.addIceCandidate(candidate);
    } catch (e) {}
  });

  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      try {
        await hub.invoke('SendIceCandidate', 'agent', JSON.stringify(event.candidate));
      } catch (e) {}
    }
  };

  await hub.start();

  const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
  await pc.setLocalDescription(offer);
  await hub.invoke('SendOffer', deviceId.toString(), offer.sdp);

  return { hub, pc };
}

// ─── Monitor Tile ─────────────────────────────────────────────────────────────
function MonitorTile({ device, onDoubleClick }) {
  const videoRef = useRef(null);
  const hubRef = useRef(null);
  const pcRef = useRef(null);
  const [streamState, setStreamState] = useState('connecting'); // connecting | connected | disconnected | offline
  const [zoom, setZoom] = useState(100);
  const [annotation, setAnnotation] = useState(false);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);

  const cpuPct = device.metrics?.cpuUsage ?? 0;
  const ramPct = device.metrics?.ramTotal > 0
    ? (device.metrics.ramUsage / device.metrics.ramTotal) * 100 : 0;

  useEffect(() => {
    if (device.status === 'Offline') {
      setStreamState('offline');
      return;
    }

    let cancelled = false;
    setStreamState('connecting');

    createViewStream(
      device.id,
      (stream) => {
        if (cancelled) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      },
      (state) => {
        if (!cancelled) setStreamState(state);
      }
    ).then(({ hub, pc }) => {
      if (cancelled) {
        pc.close();
        hub.stop();
        return;
      }
      hubRef.current = hub;
      pcRef.current = pc;
    }).catch((err) => {
      if (!cancelled) setStreamState('disconnected');
    });

    return () => {
      cancelled = true;
      if (pcRef.current) { try { pcRef.current.close(); } catch (e) {} pcRef.current = null; }
      if (hubRef.current) { try { hubRef.current.stop(); } catch (e) {} hubRef.current = null; }
    };
  }, [device.id, device.status]);

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
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  }

  function stopDraw() { isDrawing.current = false; }

  const badgeClass = {
    Online: 'badge-online',
    Offline: 'badge-offline',
    InSession: 'badge-insession',
  }[device.status] || 'badge-offline';

  return (
    <div
      className="monitor-tile"
      onDoubleClick={() => onDoubleClick({ device, videoRef, hubRef, pcRef })}
      title={`${device.hostname} — Double-click to focus`}
    >
      {/* Video / placeholder */}
      <div className="monitor-tile-screen" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}>
        {streamState === 'offline' ? (
          <div className="monitor-tile-placeholder offline">
            <div className="monitor-placeholder-icon">🖥️</div>
            <div className="monitor-placeholder-text">Offline</div>
          </div>
        ) : streamState === 'connecting' ? (
          <div className="monitor-tile-placeholder connecting">
            <div className="monitor-placeholder-spinner" />
            <div className="monitor-placeholder-text">Connecting...</div>
          </div>
        ) : streamState === 'disconnected' ? (
          <div className="monitor-tile-placeholder disconnected">
            <div className="monitor-placeholder-icon">⚠️</div>
            <div className="monitor-placeholder-text">Stream lost</div>
          </div>
        ) : null}

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="monitor-tile-video"
          style={{ opacity: streamState === 'connected' ? 1 : 0 }}
        />

        {/* Annotation canvas */}
        <canvas
          ref={canvasRef}
          className="monitor-tile-canvas"
          style={{ pointerEvents: annotation ? 'all' : 'none', cursor: annotation ? 'crosshair' : 'default' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
        />
      </div>

      {/* Info overlay at bottom */}
      <div className="monitor-tile-overlay">
        <div className="monitor-tile-info">
          <span className="monitor-tile-hostname">{device.hostname}</span>
          <span className={`badge ${badgeClass}`} style={{ fontSize: 9, padding: '2px 6px' }}>
            {device.status}
          </span>
        </div>
        <div className="monitor-tile-metrics">
          <span style={{ color: cpuPct > 85 ? 'var(--accent-red)' : 'var(--accent-blue)' }}>
            CPU {cpuPct.toFixed(0)}%
          </span>
          <span style={{ color: ramPct > 85 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
            RAM {ramPct.toFixed(0)}%
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
            {device.iPAddress}
          </span>
        </div>
      </div>

      {/* Quick tools bar on hover */}
      <div className="monitor-tile-actions">
        <button
          className={`monitor-action-btn ${annotation ? 'active' : ''}`}
          title="Toggle Annotation"
          onClick={(e) => { e.stopPropagation(); setAnnotation(a => !a); }}
        >✏️</button>
        {annotation && (
          <button
            className="monitor-action-btn"
            title="Clear annotations"
            onClick={(e) => {
              e.stopPropagation();
              const ctx = canvasRef.current?.getContext('2d');
              ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }}
          >🗑️</button>
        )}
        <button
          className="monitor-action-btn"
          title="Zoom in"
          onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(200, z + 20)); }}
        >+</button>
        <button
          className="monitor-action-btn"
          title="Zoom out"
          onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(40, z - 20)); }}
        >−</button>
        <button
          className="monitor-action-btn"
          title="Focus (double-click)"
          onClick={(e) => { e.stopPropagation(); onDoubleClick({ device, videoRef, hubRef, pcRef }); }}
        >⛶</button>
      </div>

      {/* Double-click hint */}
      <div className="monitor-tile-dblclick-hint">⎘ Double-click to focus</div>
    </div>
  );
}

// ─── Monitor Focus Modal ──────────────────────────────────────────────────────
function MonitorFocusModal({ focusData, onClose, navigate }) {
  const { device } = focusData;
  const videoRef = useRef(null);
  const hubRef = useRef(null);
  const pcRef = useRef(null);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);

  const [streamState, setStreamState] = useState('connecting');
  const [zoom, setZoom] = useState(100);
  const [annotation, setAnnotation] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const cpuPct = device.metrics?.cpuUsage ?? 0;
  const ramPct = device.metrics?.ramTotal > 0
    ? (device.metrics.ramUsage / device.metrics.ramTotal) * 100 : 0;

  useEffect(() => {
    let cancelled = false;
    setStreamState('connecting');

    createViewStream(
      device.id,
      (stream) => {
        if (cancelled) return;
        if (videoRef.current) videoRef.current.srcObject = stream;
      },
      (state) => {
        if (!cancelled) setStreamState(state);
      }
    ).then(({ hub, pc }) => {
      if (cancelled) { pc.close(); hub.stop(); return; }
      hubRef.current = hub;
      pcRef.current = pc;
    }).catch(() => {
      if (!cancelled) setStreamState('disconnected');
    });

    return () => {
      cancelled = true;
      if (pcRef.current) { try { pcRef.current.close(); } catch (e) {} }
      if (hubRef.current) { try { hubRef.current.stop(); } catch (e) {} }
    };
  }, [device.id]);

  // Keyboard close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleFullscreen = () => {
    const el = document.querySelector('.monitor-focus-wrap');
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const handleReconnect = async () => {
    toast.info('Reconnecting stream...');
    if (pcRef.current) { try { pcRef.current.close(); } catch (e) {} }
    if (hubRef.current) { try { hubRef.current.stop(); } catch (e) {} }
    setStreamState('connecting');
    try {
      const { hub, pc } = await createViewStream(
        device.id,
        (stream) => { if (videoRef.current) videoRef.current.srcObject = stream; },
        (state) => setStreamState(state)
      );
      hubRef.current = hub;
      pcRef.current = pc;
      toast.success('Stream reconnected');
    } catch (e) {
      setStreamState('disconnected');
      toast.error('Reconnect failed');
    }
  };

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

  const badgeClass = {
    Online: 'badge-online',
    Offline: 'badge-offline',
    InSession: 'badge-insession',
  }[device.status] || 'badge-offline';

  return (
    <div className="monitor-focus-overlay" onClick={onClose}>
      <div
        className="monitor-focus-wrap"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="monitor-focus-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>← Back to Wall</button>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{device.hostname}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{device.iPAddress}</span>
            <span className={`badge ${badgeClass}`}>● {device.status}</span>
            {streamState === 'connected'
              ? <span className="badge badge-online" style={{ fontSize: 10 }}>🟢 Live</span>
              : streamState === 'connecting'
                ? <span className="badge badge-warning" style={{ fontSize: 10 }}>⟳ Connecting</span>
                : <span className="badge badge-offline" style={{ fontSize: 10 }}>⚠ Stream lost</span>
            }
          </div>

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
            {/* Metrics */}
            <span style={{ fontSize: 12, color: cpuPct > 85 ? 'var(--accent-red)' : 'var(--accent-blue)' }}>
              CPU {cpuPct.toFixed(1)}%
            </span>
            <span style={{ fontSize: 12, color: ramPct > 85 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
              RAM {ramPct.toFixed(1)}%
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              ⏱ {formatUptime(device.metrics?.uptimeSeconds)}
            </span>

            {/* View-only badge */}
            <span className="monitor-viewonly-badge">👁 View Only</span>

            {/* Connect with control */}
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                onClose();
                navigate(`/devices/${device.id}/session?viewOnly=true`);
              }}
            >
              🔗 Take Control
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="viewer-toolbar" style={{ borderRadius: 0 }}>
          <div className="toolbar-group">
            <button
              className={`toolbar-btn ${annotation ? 'active' : ''}`}
              title="Annotation"
              onClick={() => setAnnotation(a => !a)}
            >✏️</button>
            {annotation && (
              <button className="toolbar-btn" title="Clear" onClick={clearAnnotations}>🗑️</button>
            )}
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" title="Zoom Out" onClick={() => setZoom(z => Math.max(50, z - 10))}>−</button>
            <span style={{ fontSize: 12, padding: '0 4px', color: 'var(--text-muted)' }}>{zoom}%</span>
            <button className="toolbar-btn" title="Zoom In" onClick={() => setZoom(z => Math.min(300, z + 10))}>+</button>
            <button className="toolbar-btn" title="Fit" onClick={() => setZoom(100)}>⊡</button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" title="Toggle Fullscreen" onClick={toggleFullscreen}>⛶</button>
            <button
              className="toolbar-btn"
              title="Reconnect Stream"
              style={{ width: 'auto', padding: '0 10px', fontSize: 12 }}
              onClick={handleReconnect}
            >🔄 Reconnect</button>
          </div>

          <div className="toolbar-group" style={{ marginLeft: 'auto' }}>
            <div style={{ padding: '0 8px', fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              ℹ️ View-only mode — no input is sent to device
            </div>
          </div>
        </div>

        {/* Screen viewer */}
        <div className="monitor-focus-screen" style={{ overflow: 'hidden', flex: 1, position: 'relative', background: '#000' }}>
          {streamState !== 'connected' && (
            <div className="monitor-tile-placeholder" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
              {streamState === 'connecting' ? (
                <>
                  <div className="monitor-placeholder-spinner lg" />
                  <div className="monitor-placeholder-text">Establishing live view...</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Connecting to {device.hostname} via WebRTC
                  </div>
                </>
              ) : (
                <>
                  <div className="monitor-placeholder-icon" style={{ fontSize: 40 }}>⚠️</div>
                  <div className="monitor-placeholder-text">Stream disconnected</div>
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={handleReconnect}>
                    🔄 Reconnect
                  </button>
                </>
              )}
            </div>
          )}

          <div style={{
            width: '100%',
            height: '100%',
            overflow: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{ position: 'relative', transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  opacity: streamState === 'connected' ? 1 : 0,
                }}
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: annotation ? 'all' : 'none',
                  cursor: annotation ? 'crosshair' : 'default',
                }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Group Manager Drawer ────────────────────────────────────────────────────
function GroupManagerDrawer({ groups, allDevices, onGroupsChange, onClose }) {
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState(null); // group id being edited
  const [editingName, setEditingName] = useState('');

  function createGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    if (groups.find(g => g.name.toLowerCase() === name.toLowerCase())) {
      toast.warn('A group with that name already exists');
      return;
    }
    const newGroup = { id: Date.now().toString(), name, deviceIds: [] };
    const updated = [...groups, newGroup];
    onGroupsChange(updated);
    setNewGroupName('');
    toast.success(`Group "${name}" created`);
  }

  function deleteGroup(groupId) {
    const updated = groups.filter(g => g.id !== groupId);
    onGroupsChange(updated);
  }

  function renameGroup(groupId) {
    const name = editingName.trim();
    if (!name) return;
    const updated = groups.map(g => g.id === groupId ? { ...g, name } : g);
    onGroupsChange(updated);
    setEditingGroup(null);
  }

  function toggleDeviceInGroup(groupId, deviceId) {
    const updated = groups.map(g => {
      if (g.id !== groupId) return g;
      const has = g.deviceIds.includes(deviceId);
      return {
        ...g,
        deviceIds: has ? g.deviceIds.filter(id => id !== deviceId) : [...g.deviceIds, deviceId]
      };
    });
    onGroupsChange(updated);
  }

  function getGroupForDevice(deviceId) {
    return groups.find(g => g.deviceIds.includes(deviceId));
  }

  return (
    <div className="group-manager-overlay" onClick={onClose}>
      <div className="group-manager-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="group-manager-header">
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>📁 Device Groups</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Organize devices into named groups for the Monitor Wall
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Create new group */}
        <div className="group-create-row">
          <input
            className="form-input"
            placeholder="Group name (e.g. Production Team)"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createGroup()}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary btn-sm" onClick={createGroup}>+ Create</button>
        </div>

        {/* Groups list */}
        <div className="group-manager-list">
          {groups.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
              No groups yet. Create one above to organize your devices.
            </div>
          )}

          {groups.map(group => (
            <div key={group.id} className="group-manager-item">
              <div className="group-manager-item-header">
                {editingGroup === group.id ? (
                  <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                    <input
                      className="form-input"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && renameGroup(group.id)}
                      style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
                      autoFocus
                    />
                    <button className="btn btn-success btn-sm" onClick={() => renameGroup(group.id)}>✓</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingGroup(null)}>✕</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      📂 {group.name}
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                        {group.deviceIds.length} device{group.deviceIds.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => { setEditingGroup(group.id); setEditingName(group.name); }}
                      >✏️ Rename</button>
                      <button
                        className="btn btn-danger btn-sm"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => deleteGroup(group.id)}
                      >🗑️</button>
                    </div>
                  </>
                )}
              </div>

              {/* Device assignment checkboxes */}
              <div className="group-device-list">
                {allDevices.map(device => {
                  const inThisGroup = group.deviceIds.includes(device.id);
                  const inOtherGroup = !inThisGroup && !!getGroupForDevice(device.id);
                  return (
                    <label
                      key={device.id}
                      className={`group-device-item ${inThisGroup ? 'selected' : ''} ${inOtherGroup ? 'in-other' : ''}`}
                      title={inOtherGroup ? `In group: ${getGroupForDevice(device.id)?.name}` : ''}
                    >
                      <input
                        type="checkbox"
                        checked={inThisGroup}
                        onChange={() => toggleDeviceInGroup(group.id, device.id)}
                        style={{ accentColor: 'var(--accent-blue)' }}
                      />
                      <span className={`status-dot ${device.status.toLowerCase()}`} />
                      <span style={{ flex: 1, fontSize: 13 }}>{device.hostname}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{device.iPAddress}</span>
                      {inOtherGroup && (
                        <span style={{ fontSize: 10, color: 'var(--accent-orange)', marginLeft: 4 }}>
                          ({getGroupForDevice(device.id)?.name})
                        </span>
                      )}
                    </label>
                  );
                })}
                {allDevices.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>No devices available</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Group Section ────────────────────────────────────────────────────────────
function GroupSection({ title, icon, devices, onDoubleClick, collapsed, onToggle }) {
  return (
    <div className="monitor-group-section">
      <div className="monitor-group-header" onClick={onToggle}>
        <span className="monitor-group-collapse-icon">{collapsed ? '▶' : '▼'}</span>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        <span className="monitor-group-count">{devices.length}</span>
        <div className="monitor-group-stats">
          <span style={{ color: 'var(--accent-green)', fontSize: 11 }}>
            🟢 {devices.filter(d => d.status === 'Online' || d.status === 'InSession').length} online
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            ⚫ {devices.filter(d => d.status === 'Offline').length} offline
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="monitor-grid">
          {devices.map(device => (
            <MonitorTile
              key={device.id}
              device={device}
              onDoubleClick={onDoubleClick}
            />
          ))}
          {devices.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', gridColumn: '1/-1' }}>
              No devices in this group
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main DeviceMonitorPage ────────────────────────────────────────────────────
function DeviceMonitorPage() {
  const navigate = useNavigate();
  const [allDevices, setAllDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState(loadGroups);
  const [focusData, setFocusData] = useState(null); // { device, videoRef, hubRef, pcRef }
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [filter, setFilter] = useState('All'); // All | Online | Offline
  const [search, setSearch] = useState('');
  const [gridSize, setGridSize] = useState('medium'); // small | medium | large

  useEffect(() => {
    loadDevices();
    const interval = setInterval(loadDevices, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadDevices() {
    try {
      const data = await devicesApi.getAll();
      setAllDevices(data);
    } catch (e) {
      toast.error('Failed to load devices');
    } finally {
      setLoading(false);
    }
  }

  function handleGroupsChange(updated) {
    setGroups(updated);
    saveGroups(updated);
  }

  function toggleGroupCollapse(groupId) {
    setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  }

  const filteredDevices = allDevices.filter(d => {
    const matchFilter = filter === 'All' || d.status === filter || (filter === 'Online' && d.status === 'InSession');
    const matchSearch = !search || d.hostname.toLowerCase().includes(search.toLowerCase()) || d.iPAddress.includes(search);
    return matchFilter && matchSearch;
  });

  // Build grouped view
  const assignedIds = new Set(groups.flatMap(g => g.deviceIds));
  const ungrouped = filteredDevices.filter(d => !assignedIds.has(d.id));
  const groupedSections = groups.map(group => ({
    ...group,
    devices: filteredDevices.filter(d => group.deviceIds.includes(d.id))
  }));

  const onlineCounts = {
    all: allDevices.length,
    online: allDevices.filter(d => d.status === 'Online' || d.status === 'InSession').length,
    offline: allDevices.filter(d => d.status === 'Offline').length,
  };

  if (loading) return (
    <div className="loading-overlay">
      <div className="loading-spinner lg" />
    </div>
  );

  return (
    <div className="monitor-wall-page">
      {/* ─── Header ─────────────────────────────────── */}
      <div className="monitor-wall-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🖥️</span> Monitor Wall
              <span className="monitor-live-badge">● LIVE</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              View-only surveillance — {onlineCounts.online} online · {onlineCounts.offline} offline · {onlineCounts.all} total
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {/* Search */}
          <input
            className="form-input"
            placeholder="🔍 Search devices..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 200, padding: '6px 12px', fontSize: 13 }}
          />

          {/* Filter */}
          {['All', 'Online', 'Offline'].map(f => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}

          <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

          {/* Grid size */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { key: 'small', icon: '⊞', title: 'Small tiles' },
              { key: 'medium', icon: '⊟', title: 'Medium tiles' },
              { key: 'large', icon: '⊠', title: 'Large tiles' },
            ].map(({ key, icon, title }) => (
              <button
                key={key}
                className={`btn btn-sm ${gridSize === key ? 'btn-primary' : 'btn-ghost'}`}
                title={title}
                onClick={() => setGridSize(key)}
              >{icon}</button>
            ))}
          </div>

          <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

          {/* Groups manager */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowGroupManager(true)}
          >
            📁 Manage Groups
            {groups.length > 0 && (
              <span style={{ background: 'var(--accent-blue)', color: '#fff', fontSize: 10, borderRadius: 10, padding: '1px 6px' }}>
                {groups.length}
              </span>
            )}
          </button>

          {/* Refresh */}
          <button className="btn btn-ghost btn-sm" onClick={loadDevices} title="Refresh device list">
            🔄
          </button>
        </div>
      </div>

      {/* ─── Wall Content ─────────────────────────── */}
      <div className="monitor-wall-content" data-grid-size={gridSize}>

        {/* Named groups */}
        {groupedSections.map(group => (
          <GroupSection
            key={group.id}
            title={group.name}
            icon="📂"
            devices={group.devices}
            onDoubleClick={setFocusData}
            collapsed={!!collapsedGroups[group.id]}
            onToggle={() => toggleGroupCollapse(group.id)}
          />
        ))}

        {/* Ungrouped */}
        {ungrouped.length > 0 && (
          <GroupSection
            title="Ungrouped Devices"
            icon="🖥️"
            devices={ungrouped}
            onDoubleClick={setFocusData}
            collapsed={!!collapsedGroups['__ungrouped__']}
            onToggle={() => toggleGroupCollapse('__ungrouped__')}
          />
        )}

        {filteredDevices.length === 0 && (
          <div className="monitor-empty-state">
            <div style={{ fontSize: 48, marginBottom: 16 }}>🖥️</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No devices match your filter</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Try changing the filter or search term
            </div>
          </div>
        )}
      </div>

      {/* ─── Focus Modal ─────────────────────────── */}
      {focusData && (
        <MonitorFocusModal
          focusData={focusData}
          onClose={() => setFocusData(null)}
          navigate={navigate}
        />
      )}

      {/* ─── Group Manager ───────────────────────── */}
      {showGroupManager && (
        <GroupManagerDrawer
          groups={groups}
          allDevices={allDevices}
          onGroupsChange={handleGroupsChange}
          onClose={() => setShowGroupManager(false)}
        />
      )}
    </div>
  );
}

export default DeviceMonitorPage;
