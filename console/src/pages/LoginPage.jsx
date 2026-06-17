import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { auth } from '../services/api';

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [requiresMFA, setRequiresMFA] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await auth.login(username, password, requiresMFA ? mfaCode : undefined);

      if (result.requiresMFA && !requiresMFA) {
        setRequiresMFA(true);
        setLoading(false);
        return;
      }

      onLogin(result.user, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
      });

      toast.success(`Welcome back, ${result.user.fullName}!`);
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg-gradient" />

      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">🖥️</div>
          <div>
            <div className="login-logo-text">IT Console</div>
            <div className="login-subtitle">Internal Remote Support System</div>
          </div>
        </div>

        {error && <div className="login-error">⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          {!requiresMFA ? (
            <>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  id="login-username"
                  type="text"
                  className="form-input"
                  placeholder="Enter your username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  id="login-password"
                  type="password"
                  className="form-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          ) : (
            <div className="form-group">
              <label className="form-label">MFA Code</label>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                Enter the 6-digit code from your authenticator app.
              </p>
              <input
                id="login-mfa"
                type="text"
                className="form-input"
                placeholder="000000"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                autoFocus
                style={{ letterSpacing: '0.3em', fontSize: 20, textAlign: 'center' }}
              />
            </div>
          )}

          <button
            id="login-submit"
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '12px' }}
          >
            {loading ? (
              <><span className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Signing in...</>
            ) : requiresMFA ? '🔐 Verify MFA' : '🔑 Sign In'}
          </button>

          {requiresMFA && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={() => { setRequiresMFA(false); setMfaCode(''); }}
            >
              ← Back
            </button>
          )}
        </form>

        <div style={{ marginTop: 24, padding: '12px 16px', background: 'rgba(74,158,255,0.06)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', border: '1px solid rgba(74,158,255,0.15)' }}>
          🔒 This system is for authorized IT personnel only. All access is monitored and logged.
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
