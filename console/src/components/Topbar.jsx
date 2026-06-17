import React from 'react';
import { useLocation } from 'react-router-dom';

const pageTitles = {
  '/dashboard': 'Dashboard',
  '/devices': 'Device Management',
  '/tickets': 'Support Tickets',
  '/sessions': 'Session History',
  '/notifications': 'Notifications',
  '/users': 'User Management',
  '/audit-logs': 'Audit Logs',
  '/reports': 'Reports & Analytics',
  '/settings': 'Settings',
};

function Topbar({ user, onLogout, unreadNotifs }) {
  const location = useLocation();
  const title = pageTitles[location.pathname] || 'IT Console';

  return (
    <div className="topbar">
      <h1 className="topbar-title">{title}</h1>

      <div className="topbar-actions">
        <button
          className="topbar-btn"
          title="Notifications"
          onClick={() => window.location.href = '#/notifications'}
        >
          🔔
          {unreadNotifs > 0 && <span className="topbar-notif-dot" />}
        </button>

        <button className="topbar-btn" title="Help">❓</button>

        <div
          className="topbar-avatar"
          title={`${user?.fullName} (${user?.role})`}
        >
          {user?.fullName?.[0]?.toUpperCase() || 'U'}
        </div>

        <button
          className="btn btn-ghost btn-sm"
          onClick={onLogout}
          style={{ marginLeft: 4 }}
        >
          🚪 Logout
        </button>
      </div>
    </div>
  );
}

export default Topbar;
