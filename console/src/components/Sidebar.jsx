import React from 'react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { section: 'Main', items: [
    { to: '/dashboard', icon: '📊', label: 'Dashboard' },
    { to: '/devices', icon: '🖥️', label: 'Devices' },
  ]},
  { section: 'Admin', items: [
    { to: '/users', icon: '👤', label: 'Users' },
    { to: '/audit-logs', icon: '🛡️', label: 'Audit Logs' },
    { to: '/reports', icon: '📈', label: 'Reports' },
    { to: '/settings', icon: '⚙️', label: 'Settings' },
  ]},
];

function Sidebar({ user }) {
  const isAdmin = ['SuperAdmin', 'Admin'].includes(user?.role);

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon-wrap">🖥️</div>
        <div className="sidebar-brand">
          <span className="brand-name">IT Console</span>
          <span className="brand-sub">Remote Support</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ section, items }) => {
          // Hide Admin section for non-admins
          if (section === 'Admin' && !isAdmin) return null;

          return (
            <React.Fragment key={section}>
              <div className="nav-section-label">{section}</div>
              {items.map(({ to, icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <span className="nav-icon">{icon}</span>
                  <span>{label}</span>
                </NavLink>
              ))}
            </React.Fragment>
          );
        })}
      </nav>

      {/* User info at bottom */}
      <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--gradient-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0
          }}>
            {user?.fullName?.[0]?.toUpperCase() || 'U'}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.fullName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user?.role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
