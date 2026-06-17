import React, { useState } from 'react';
import { toast } from 'react-toastify';

function SettingsPage() {
  const [settings, setSettings] = useState({
    serverUrl: localStorage.getItem('serverUrl') || 'http://localhost:5000',
    theme: localStorage.getItem('theme') || 'dark',
    sessionRecording: localStorage.getItem('sessionRecording') !== 'false',
    companyName: localStorage.getItem('companyName') || 'IT Department',
    companyLogo: localStorage.getItem('companyLogo') || '',
    notifSound: localStorage.getItem('notifSound') !== 'false',
    autoConnect: localStorage.getItem('autoConnect') === 'true',
  });

  const save = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    localStorage.setItem(key, value.toString());
  };

  const handleSave = () => {
    Object.entries(settings).forEach(([k, v]) => localStorage.setItem(k, v.toString()));
    toast.success('Settings saved');
  };

  return (
    <div style={{ maxWidth: 680 }}>
      {/* Server */}
      <div className="card mb-4">
        <div className="card-title">🌐 Server Configuration</div>
        <div className="form-group">
          <label className="form-label">Server URL</label>
          <input
            id="setting-server-url"
            type="url"
            className="form-input"
            value={settings.serverUrl}
            onChange={e => save('serverUrl', e.target.value)}
            placeholder="http://your-server:5000"
          />
          <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            The URL of your ITComputer Management Server
          </small>
        </div>
      </div>

      {/* Branding */}
      <div className="card mb-4">
        <div className="card-title">🏢 Company Branding</div>
        <div className="form-group">
          <label className="form-label">Company Name</label>
          <input
            id="setting-company-name"
            type="text"
            className="form-input"
            value={settings.companyName}
            onChange={e => save('companyName', e.target.value)}
            placeholder="Your Company IT Department"
          />
          <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Shown on the blackout screen during maintenance sessions
          </small>
        </div>
      </div>

      {/* Appearance */}
      <div className="card mb-4">
        <div className="card-title">🎨 Appearance</div>
        <div className="form-group">
          <label className="form-label">Theme</label>
          <div className="flex gap-2">
            {['dark', 'light'].map(t => (
              <button
                key={t}
                id={`theme-${t}`}
                className={`btn btn-sm ${settings.theme === t ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => save('theme', t)}
              >
                {t === 'dark' ? '🌙 Dark' : '☀️ Light'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Session */}
      <div className="card mb-4">
        <div className="card-title">🎬 Session Settings</div>
        {[
          { key: 'sessionRecording', label: 'Record all sessions by default', icon: '🎬' },
          { key: 'notifSound', label: 'Play sound on notifications', icon: '🔔' },
          { key: 'autoConnect', label: 'Auto-reconnect on disconnect', icon: '🔗' },
        ].map(({ key, label, icon }) => (
          <div key={key} className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <div style={{
                width: 40, height: 22, borderRadius: 11,
                background: settings[key] ? 'var(--accent-blue)' : 'var(--border)',
                position: 'relative', transition: 'background 0.2s',
                cursor: 'pointer'
              }}
                onClick={() => save(key, !settings[key])}
              >
                <div style={{
                  position: 'absolute', top: 3, left: settings[key] ? 20 : 3,
                  width: 16, height: 16, borderRadius: '50%',
                  background: '#fff', transition: 'left 0.2s'
                }} />
              </div>
              <span style={{ fontSize: 14 }}>{icon} {label}</span>
            </label>
          </div>
        ))}
      </div>

      {/* Security */}
      <div className="card mb-6">
        <div className="card-title">🔒 Security</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <p>✅ TLS 1.3 encryption enabled</p>
          <p>✅ AES-256 end-to-end encryption on WebRTC data channels</p>
          <p>✅ JWT tokens expire in 8 hours</p>
          <p>✅ All sessions audited and logged</p>
          <p>✅ Device authorization required before connection</p>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          IT Console v1.0.0 — Enterprise Remote Support System
        </div>
        <button id="save-settings" className="btn btn-primary" onClick={handleSave}>
          💾 Save Settings
        </button>
      </div>
    </div>
  );
}

export default SettingsPage;
