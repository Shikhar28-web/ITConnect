import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { devices, sessions } from '../services/api';
import DeviceMonitorPage from './DeviceMonitorPage';

function DeviceCard({ device, onConnect, onWoL, onAuthorize }) {
  const statusClass = device.status.toLowerCase().replace('insession', 'insession');
  const badgeClass = {
    Online: 'badge-online',
    Offline: 'badge-offline',
    InSession: 'badge-insession',
    Maintenance: 'badge-warning'
  }[device.status] || 'badge-offline';

  const cpuPct = device.metrics?.cpuUsage ?? 0;
  const ramPct = device.metrics?.ramTotal > 0
    ? (device.metrics.ramUsage / device.metrics.ramTotal) * 100 : 0;
  const diskPct = device.metrics?.diskTotal > 0
    ? (device.metrics.diskUsage / device.metrics.diskTotal) * 100 : 0;

  return (
    <div className={`device-card ${statusClass}`}>
      <div className="device-card-header">
        <div>
          <div className="device-name">{device.hostname}</div>
          <div className="device-ip">{device.iPAddress} · {device.oS}</div>
        </div>
        <span className={`badge ${badgeClass}`}>
          ● {device.status}
        </span>
      </div>

      {device.assignedUser && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          👤 {device.assignedUser} · {device.department}
        </div>
      )}

      {device.metrics && (
        <div className="device-metrics">
          <div className="metric-item">
            <div className="metric-label">CPU</div>
            <div className={`metric-value`} style={{ color: cpuPct > 85 ? 'var(--accent-red)' : 'var(--accent-blue)' }}>
              {cpuPct.toFixed(1)}%
            </div>
            <div className="metric-bar">
              <div className={`metric-fill ${cpuPct > 85 ? 'danger' : 'cpu'}`} style={{ width: `${cpuPct}%` }} />
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">RAM</div>
            <div className="metric-value" style={{ color: ramPct > 85 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
              {ramPct.toFixed(1)}%
            </div>
            <div className="metric-bar">
              <div className={`metric-fill ${ramPct > 85 ? 'danger' : 'ram'}`} style={{ width: `${ramPct}%` }} />
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Disk</div>
            <div className="metric-value" style={{ color: diskPct > 85 ? 'var(--accent-red)' : 'var(--accent-yellow)' }}>
              {diskPct.toFixed(1)}%
            </div>
            <div className="metric-bar">
              <div className={`metric-fill ${diskPct > 85 ? 'danger' : 'disk'}`} style={{ width: `${diskPct}%` }} />
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Uptime</div>
            <div className="metric-value" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {formatUptime(device.metrics.uptimeSeconds)}
            </div>
          </div>
        </div>
      )}

      {device.antivirusStatus && (
        <div style={{ marginTop: 8, fontSize: 12, color: device.antivirusStatus === 'Active' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
          🛡️ {device.antivirusName} — {device.antivirusStatus}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
        {device.status !== 'Offline' && device.isAuthorized && (
          <button
            id={`connect-${device.id}`}
            className="btn btn-primary btn-sm"
            onClick={() => onConnect(device)}
          >
            🔗 Connect
          </button>
        )}
        {device.status === 'Offline' && device.wakeOnLanEnabled && (
          <button
            id={`wol-${device.id}`}
            className="btn btn-warning btn-sm"
            onClick={() => onWoL(device)}
          >
            ⚡ Wake
          </button>
        )}
        {!device.isAuthorized && (
          <button
            id={`authorize-${device.id}`}
            className="btn btn-success btn-sm"
            onClick={() => onAuthorize(device.id)}
          >
            ✅ Authorize
          </button>
        )}
      </div>
    </div>
  );
}

function formatUptime(seconds) {
  if (!seconds) return 'N/A';
  const h = Math.floor(seconds / 3600);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

function DevicesPage() {
  const [allDevices, setAllDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [view, setView] = useState('grid'); // 'grid' | 'table'
  const [mainTab, setMainTab] = useState(() => sessionStorage.getItem('devices_main_tab') || 'list'); // 'list' | 'monitor'
  const navigate = useNavigate();

  function switchMainTab(tab) {
    setMainTab(tab);
    sessionStorage.setItem('devices_main_tab', tab);
  }

  useEffect(() => {
    loadDevices();
    const interval = setInterval(loadDevices, 15000);
    return () => clearInterval(interval);
  }, []);

  async function loadDevices() {
    try {
      const data = await devices.getAll();
      setAllDevices(data);
    } catch (e) {
      toast.error('Failed to load devices');
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect(device) {
    try {
      const session = await sessions.start(device.id, null, true);
      navigate(`/devices/${device.id}/session?sessionId=${session.id}`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to start session');
    }
  }

  async function handleWoL(device) {
    try {
      const broadcastIP = device.iPAddress.split('.').slice(0, 3).join('.') + '.255';
      await devices.wakeOnLan(device.mACAddress, broadcastIP);
      toast.success(`Wake-on-LAN sent to ${device.hostname}`);
    } catch (e) {
      toast.error('Failed to send WoL packet');
    }
  }

  async function handleAuthorize(id) {
    try {
      await devices.authorize(id);
      toast.success('Device authorized successfully');
      loadDevices();
    } catch (e) {
      toast.error('Failed to authorize device');
    }
  }

  const filtered = allDevices.filter(d => {
    const matchSearch = d.hostname.toLowerCase().includes(search.toLowerCase()) ||
      d.iPAddress.includes(search) ||
      d.assignedUser?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'All' || d.status === filter;
    return matchSearch && matchFilter;
  });

  const counts = {
    All: allDevices.length,
    Online: allDevices.filter(d => d.status === 'Online').length,
    Offline: allDevices.filter(d => d.status === 'Offline').length,
    InSession: allDevices.filter(d => d.status === 'InSession').length,
  };

  if (loading) return <div className="loading-overlay"><div className="loading-spinner lg" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ─── Main tab bar ─── */}
      <div className="devices-main-tabs">
        <button
          id="tab-device-list"
          className={`devices-main-tab ${mainTab === 'list' ? 'active' : ''}`}
          onClick={() => switchMainTab('list')}
        >
          🖥️ Device List
        </button>
        <button
          id="tab-monitor-wall"
          className={`devices-main-tab ${mainTab === 'monitor' ? 'active' : ''}`}
          onClick={() => switchMainTab('monitor')}
        >
          📺 Monitor Wall
          <span className="devices-main-tab-badge">NEW</span>
        </button>
      </div>

      {/* Monitor Wall */}
      {mainTab === 'monitor' && <DeviceMonitorPage />}

      {/* Device List */}
      {mainTab === 'list' && (
      <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          {filtered.length} device{filtered.length !== 1 ? 's' : ''} shown
        </div>
        <div className="flex gap-2">
          <button
            id="view-grid"
            className={`btn btn-ghost btn-sm ${view === 'grid' ? 'active' : ''}`}
            onClick={() => setView('grid')}
          >⊞ Grid</button>
          <button
            id="view-table"
            className={`btn btn-ghost btn-sm ${view === 'table' ? 'active' : ''}`}
            onClick={() => setView('table')}
          >☰ Table</button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex gap-2 mb-4">
        <input
          id="device-search"
          className="form-input"
          placeholder="🔍 Search by hostname, IP, user..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <div className="flex gap-2">
          {['All', 'Online', 'Offline', 'InSession'].map(f => (
            <button
              key={f}
              id={`filter-${f.toLowerCase()}`}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f)}
            >
              {f} <span style={{ opacity: 0.7, fontSize: 11 }}>({counts[f]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Device Grid or Table */}
      {view === 'grid' ? (
        <div className="device-grid">
          {filtered.map(d => (
            <DeviceCard
              key={d.id}
              device={d}
              onConnect={handleConnect}
              onWoL={handleWoL}
              onAuthorize={handleAuthorize}
            />
          ))}
          {filtered.length === 0 && (
            <div style={{ color: 'var(--text-muted)', gridColumn: '1/-1', textAlign: 'center', padding: 40 }}>
              No devices match your search.
            </div>
          )}
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>IP Address</th>
                <th>OS</th>
                <th>Status</th>
                <th>CPU</th>
                <th>RAM</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const badgeClass = { Online: 'badge-online', Offline: 'badge-offline', InSession: 'badge-insession' }[d.status] || 'badge-offline';
                const cpuPct = d.metrics?.cpuUsage ?? 0;
                const ramPct = d.metrics?.ramTotal > 0 ? (d.metrics.ramUsage / d.metrics.ramTotal) * 100 : 0;
                return (
                  <tr key={d.id}>
                    <td><strong>{d.hostname}</strong></td>
                    <td style={{ fontFamily: 'monospace' }}>{d.iPAddress}</td>
                    <td>{d.oS}</td>
                    <td><span className={`badge ${badgeClass}`}>{d.status}</span></td>
                    <td><span style={{ color: cpuPct > 85 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{cpuPct.toFixed(1)}%</span></td>
                    <td><span style={{ color: ramPct > 85 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{ramPct.toFixed(1)}%</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}</td>
                    <td>
                      <div className="flex gap-2">
                        {d.status !== 'Offline' && d.isAuthorized && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleConnect(d)}>Connect</button>
                        )}
                        {!d.isAuthorized && (
                          <button className="btn btn-success btn-sm" onClick={() => handleAuthorize(d.id)}>Authorize</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
      )}
    </div>
  );
}

export default DevicesPage;
