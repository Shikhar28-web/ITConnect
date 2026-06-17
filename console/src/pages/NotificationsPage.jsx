import React, { useState, useEffect } from 'react';
import { notifications as notifApi } from '../services/api';
import { toast } from 'react-toastify';

function NotificationsPage() {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadNotifs(); }, []);

  async function loadNotifs() {
    try {
      const data = await notifApi.getAll(false);
      setNotifs(data);
    } catch { toast.error('Failed to load notifications'); }
    finally { setLoading(false); }
  }

  async function markRead(id) {
    await notifApi.markRead(id);
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  }

  async function markAllRead() {
    await notifApi.markAllRead();
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
    toast.success('All notifications marked as read');
  }

  const severityIcon = (s) => ({ Info: 'ℹ️', Warning: '⚠️', Critical: '🚨' })[s] || 'ℹ️';
  const severityColor = (s) => ({ Info: 'var(--accent-blue)', Warning: 'var(--accent-orange)', Critical: 'var(--accent-red)' })[s] || 'var(--accent-blue)';
  const unread = notifs.filter(n => !n.isRead).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          {unread} unread · {notifs.length} total
        </div>
        {unread > 0 && (
          <button id="mark-all-read" className="btn btn-ghost btn-sm" onClick={markAllRead}>
            ✓ Mark All Read
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-overlay"><div className="loading-spinner lg" /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notifs.map(n => (
            <div
              key={n.id}
              style={{
                background: n.isRead ? 'var(--bg-card)' : 'rgba(74,158,255,0.05)',
                border: `1px solid ${n.isRead ? 'var(--border)' : 'rgba(74,158,255,0.2)'}`,
                borderLeft: `4px solid ${severityColor(n.severity)}`,
                borderRadius: 10,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                transition: 'all 0.15s'
              }}
            >
              <span style={{ fontSize: 22, flexShrink: 0 }}>{severityIcon(n.severity)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: n.isRead ? 500 : 700, fontSize: 14, marginBottom: 3 }}>
                  {n.title}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{n.message}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(n.createdAt).toLocaleString()}
                </div>
                {!n.isRead && (
                  <button
                    id={`mark-read-${n.id}`}
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 6, padding: '2px 8px', fontSize: 11 }}
                    onClick={() => markRead(n.id)}
                  >
                    Mark read
                  </button>
                )}
              </div>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: n.isRead ? 'transparent' : 'var(--accent-blue)',
                flexShrink: 0
              }} />
            </div>
          ))}
          {notifs.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              🔔 No notifications
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationsPage;
