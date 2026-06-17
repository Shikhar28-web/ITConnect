import React, { useState, useEffect } from 'react';
import { sessions } from '../services/api';
import { toast } from 'react-toastify';

function SessionHistoryPage() {
  const [allSessions, setAllSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const data = await sessions.getAll(from || undefined, to || undefined);
      setAllSessions(data);
    } catch { toast.error('Failed to load sessions'); }
    finally { setLoading(false); }
  }

  async function downloadRecording(sessionId) {
    try {
      const blob = await sessions.getRecording(sessionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session_${sessionId}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Recording not available'); }
  }

  const filtered = allSessions.filter(s =>
    s.engineerName.toLowerCase().includes(search.toLowerCase()) ||
    s.deviceHostname.toLowerCase().includes(search.toLowerCase()) ||
    s.deviceIP.includes(search)
  );

  const statusBadge = (s) => ({
    Active: 'badge-insession', Connecting: 'badge-warning',
    Ended: 'badge-offline', Failed: 'badge-danger'
  })[s] || 'badge-info';

  function getDuration(start, end) {
    if (!end) return 'Ongoing';
    const mins = Math.round((new Date(end) - new Date(start)) / 60000);
    return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  return (
    <div>
      <div className="flex gap-3 items-center mb-4 flex-wrap">
        <input
          id="session-search"
          className="form-input"
          placeholder="🔍 Search engineer, device..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <input id="session-from" type="date" className="form-input" value={from}
          onChange={e => setFrom(e.target.value)} style={{ width: 160 }} />
        <input id="session-to" type="date" className="form-input" value={to}
          onChange={e => setTo(e.target.value)} style={{ width: 160 }} />
        <button id="session-filter" className="btn btn-primary btn-sm" onClick={loadSessions}>Filter</button>
      </div>

      <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--text-muted)' }}>
        {filtered.length} session{filtered.length !== 1 ? 's' : ''}
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Engineer</th>
              <th>Device</th>
              <th>Status</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Recorded</th>
              <th>Ticket</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }}>
                <div className="loading-spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            ) : filtered.map(s => (
              <tr key={s.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>#{s.id}</td>
                <td><strong>{s.engineerName}</strong></td>
                <td>
                  <div>{s.deviceHostname}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.deviceIP}</div>
                </td>
                <td><span className={`badge ${statusBadge(s.status)}`}>{s.status}</span></td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(s.startedAt).toLocaleString()}
                </td>
                <td>{getDuration(s.startedAt, s.endedAt)}</td>
                <td>{s.isRecorded ? '🎬 Yes' : '—'}</td>
                <td>{s.ticketId ? `#${s.ticketId}` : '—'}</td>
                <td>
                  {s.isRecorded && s.status === 'Ended' && (
                    <button
                      id={`download-${s.id}`}
                      className="btn btn-ghost btn-sm"
                      onClick={() => downloadRecording(s.id)}
                    >⬇ Recording</button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                No sessions found.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SessionHistoryPage;
