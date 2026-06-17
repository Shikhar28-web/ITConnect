import React, { useState, useEffect } from 'react';
import { reports } from '../services/api';
import { toast } from 'react-toastify';

function ReportsPage() {
  const [tab, setTab] = useState('engineer');
  const [engineerData, setEngineerData] = useState([]);
  const [deviceData, setDeviceData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => { fetchReports(); }, [tab]);

  async function fetchReports() {
    setLoading(true);
    try {
      if (tab === 'engineer') {
        const data = await reports.engineerPerformance(from, to);
        setEngineerData(data);
      } else {
        const data = await reports.deviceHealth(from, to);
        setDeviceData(data);
      }
    } catch { toast.error('Failed to load report'); }
    finally { setLoading(false); }
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button id="report-engineer" className={`btn btn-sm ${tab === 'engineer' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('engineer')}>👷 Engineer Performance</button>
        <button id="report-device" className={`btn btn-sm ${tab === 'device' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('device')}>🖥️ Device Health</button>
      </div>

      {/* Date range */}
      <div className="flex gap-3 items-center mb-4">
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>From</label>
        <input id="report-from" type="date" className="form-input" value={from}
          onChange={e => setFrom(e.target.value)} style={{ width: 160 }} />
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>To</label>
        <input id="report-to" type="date" className="form-input" value={to}
          onChange={e => setTo(e.target.value)} style={{ width: 160 }} />
        <button id="report-generate" className="btn btn-primary btn-sm" onClick={fetchReports}>Generate</button>
      </div>

      {loading ? (
        <div className="loading-overlay"><div className="loading-spinner lg" /></div>
      ) : tab === 'engineer' ? (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Engineer</th>
                <th>Total Sessions</th>
                <th>Tickets Resolved</th>
                <th>Avg Session Duration</th>
                <th>Period</th>
              </tr>
            </thead>
            <tbody>
              {engineerData.map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.engineerName}</strong></td>
                  <td><span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{r.totalSessions}</span></td>
                  <td><span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>{r.totalTicketsResolved}</span></td>
                  <td>{r.avgSessionDurationMinutes.toFixed(1)} min</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {new Date(r.periodStart).toLocaleDateString()} – {new Date(r.periodEnd).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {engineerData.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No data for selected period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Avg CPU</th>
                <th>Avg RAM</th>
                <th>Incidents</th>
                <th>Sessions</th>
                <th>Period</th>
              </tr>
            </thead>
            <tbody>
              {deviceData.map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.hostname}</strong></td>
                  <td>
                    <span style={{ color: r.avgCpuUsage > 80 ? 'var(--accent-red)' : 'var(--text-primary)', fontWeight: 600 }}>
                      {r.avgCpuUsage.toFixed(1)}%
                    </span>
                  </td>
                  <td>
                    <span style={{ color: r.avgRamUsage > 80 ? 'var(--accent-red)' : 'var(--text-primary)', fontWeight: 600 }}>
                      {r.avgRamUsage.toFixed(1)}%
                    </span>
                  </td>
                  <td>{r.incidentCount}</td>
                  <td>{r.sessionCount}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {new Date(r.periodStart).toLocaleDateString()} – {new Date(r.periodEnd).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {deviceData.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No data for selected period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ReportsPage;
