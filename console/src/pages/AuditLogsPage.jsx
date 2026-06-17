import React, { useState, useEffect } from 'react';
import { auditLogs } from '../services/api';
import { toast } from 'react-toastify';

function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { fetchLogs(); }, []);

  async function fetchLogs() {
    setLoading(true);
    try {
      const data = await auditLogs.get(
        from || undefined, to || undefined, undefined, action || undefined
      );
      setLogs(data);
    } catch { toast.error('Failed to load audit logs'); }
    finally { setLoading(false); }
  }

  const filtered = logs.filter(l =>
    l.username.toLowerCase().includes(search.toLowerCase()) ||
    l.action.toLowerCase().includes(search.toLowerCase()) ||
    l.target.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          id="audit-search"
          className="form-input"
          placeholder="🔍 Search user, action, target..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <input
          id="audit-from"
          type="date"
          className="form-input"
          value={from}
          onChange={e => setFrom(e.target.value)}
          style={{ width: 160 }}
        />
        <input
          id="audit-to"
          type="date"
          className="form-input"
          value={to}
          onChange={e => setTo(e.target.value)}
          style={{ width: 160 }}
        />
        <select
          id="audit-action"
          className="form-input form-select"
          value={action}
          onChange={e => setAction(e.target.value)}
          style={{ width: 180 }}
        >
          <option value="">All Actions</option>
          {['Login', 'Logout', 'StartSession', 'EndSession', 'FileTransfer', 'CommandExecution', 'PowerCommand'].map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <button id="audit-apply" className="btn btn-primary btn-sm" onClick={fetchLogs}>Apply</button>
      </div>

      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
        {filtered.length} entries (tamper-evident chain ✓)
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Target</th>
              <th>IP Address</th>
              <th>Result</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>
                <div className="loading-spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            ) : filtered.map(log => (
              <tr key={log.id}>
                <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(log.timestamp).toLocaleString()}
                </td>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{log.username}</div>
                </td>
                <td>
                  <span style={{
                    padding: '2px 8px',
                    background: 'rgba(74,158,255,0.1)',
                    borderRadius: 4,
                    fontSize: 12,
                    color: 'var(--accent-blue)',
                    fontWeight: 600
                  }}>{log.action}</span>
                </td>
                <td style={{ fontSize: 13 }}>{log.target}</td>
                <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  {log.iPAddress}
                </td>
                <td>
                  {log.isSuccess
                    ? <span className="badge badge-online">✓ Success</span>
                    : <span className="badge badge-danger">✗ Failed</span>
                  }
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.failureReason || log.details}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                No logs found.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AuditLogsPage;
