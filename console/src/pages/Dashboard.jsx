import React, { useState, useEffect } from 'react';
import { reports } from '../services/api';

function StatCard({ icon, value, label, color }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className={`stat-value ${color}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function MetricBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const fillClass = pct > 85 ? 'danger' : color;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div className="metric-bar">
        <div className={`metric-fill ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchStats() {
    try {
      const data = await reports.dashboard();
      setStats(data);
    } catch (e) {
      console.error('Failed to load dashboard stats', e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="loading-spinner lg" />
        <span>Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Stat Cards */}
      <div className="stats-grid">
        <StatCard icon="🖥️" value={stats?.totalDevices ?? 0} label="Total Devices" color="blue" />
        <StatCard icon="🟢" value={stats?.onlineDevices ?? 0} label="Online" color="green" />
        <StatCard icon="🔴" value={stats?.offlineDevices ?? 0} label="Offline" color="red" />
        <StatCard icon="🔗" value={stats?.activeSessions ?? 0} label="Active Sessions" color="blue" />
        <StatCard icon="🎫" value={stats?.openTickets ?? 0} label="Open Tickets" color="orange" />
        <StatCard icon="🚨" value={stats?.criticalTickets ?? 0} label="Critical" color="red" />
        <StatCard icon="⚙️" value={`${stats?.avgCpuUsage ?? 0}%`} label="Avg CPU" color="blue" />
        <StatCard icon="💾" value={`${stats?.avgRamUsage ?? 0}%`} label="Avg RAM" color="green" />
      </div>

      {/* Two columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Active Sessions */}
        <div className="card">
          <div className="card-title">⚡ Active Sessions</div>
          {stats?.activeSessionsList?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stats.activeSessionsList.map((s) => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', background: 'var(--bg-secondary)',
                  borderRadius: 8, border: '1px solid var(--border)'
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{s.deviceHostname}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Engineer: {s.engineerName}
                    </div>
                  </div>
                  <span className="badge badge-insession">● Live</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              No active sessions
            </div>
          )}
        </div>

        {/* Recently Online Devices */}
        <div className="card">
          <div className="card-title">🖥️ Online Devices</div>
          {stats?.recentlyOnline?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.recentlyOnline.map((d) => (
                <div key={d.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', background: 'var(--bg-secondary)',
                  borderRadius: 8, border: '1px solid var(--border)'
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{d.hostname}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.iPAddress}</div>
                  </div>
                  {d.metrics && (
                    <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                      <span>CPU {d.metrics.cpuUsage?.toFixed(0)}%</span>
                      <span>RAM {(d.metrics.ramUsage / d.metrics.ramTotal * 100).toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              No devices online
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
