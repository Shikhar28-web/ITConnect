import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [status, setStatus] = useState('Connecting...');
  const [connected, setConnected] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [engineerName, setEngineerName] = useState('');

  useEffect(() => {
    // Listen for status updates from main process
    const handleStatusChange = (event) => {
      setConnected(event.detail.connected);
      setStatus(event.detail.message);
    };

    window.addEventListener('agent-status', handleStatusChange);
    return () => window.removeEventListener('agent-status', handleStatusChange);
  }, []);

  return (
    <div className="agent-app">
      <div className="agent-header">
        <div className="agent-logo">
          <span className="logo-icon">🖥️</span>
          <span className="logo-text">IT Support Agent</span>
        </div>
        <div className={`status-badge ${connected ? 'status-online' : 'status-offline'}`}>
          <span className="status-dot"></span>
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div className="agent-body">
        <div className="info-card">
          <h3>Agent Status</h3>
          <p className="status-text">{status}</p>
        </div>

        {sessionActive && (
          <div className="session-card active">
            <div className="session-icon">👷</div>
            <div className="session-info">
              <h4>Session Active</h4>
              <p>Engineer: <strong>{engineerName}</strong></p>
              <p>Your screen is being accessed by the IT Department.</p>
            </div>
          </div>
        )}

        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">Version</span>
            <span className="info-value">1.0.0</span>
          </div>
          <div className="info-item">
            <span className="info-label">Server</span>
            <span className="info-value">localhost:5000</span>
          </div>
        </div>

        <div className="privacy-notice">
          <span>🔒</span>
          <p>This agent only allows access from authorized IT engineers. All sessions are logged and recorded.</p>
        </div>
      </div>
    </div>
  );
}

export default App;
