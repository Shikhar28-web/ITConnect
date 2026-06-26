import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './index.css';

import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import DevicesPage from './pages/DevicesPage';
import DeviceMonitorPage from './pages/DeviceMonitorPage';
import RemoteSessionPage from './pages/RemoteSessionPage';
import UsersPage from './pages/UsersPage';
import AuditLogsPage from './pages/AuditLogsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import { signalRService } from './services/signalr';

function App() {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const handleLogin = (userData, tokens) => {
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const handleLogout = async () => {
    await signalRService.disconnect();
    localStorage.clear();
    setUser(null);
  };

  if (!user) {
    return (
      <>
        <LoginPage onLogin={handleLogin} />
        <ToastContainer theme="dark" position="top-right" />
      </>
    );
  }

  return (
    <HashRouter>
      <div className="app-layout">
        <Sidebar user={user} />
        <div className="main-content">
          <Topbar user={user} onLogout={handleLogout} />
          <div className="page-content">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/devices" element={<DevicesPage />} />
              <Route path="/devices/monitor" element={<DeviceMonitorPage />} />
              <Route path="/devices/:deviceId/session" element={<RemoteSessionPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/audit-logs" element={<AuditLogsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </div>
      <ToastContainer
        theme="dark"
        position="top-right"
        toastStyle={{
          background: '#111827',
          border: '1px solid #1e2d4a',
          color: '#e2e8f0'
        }}
      />
    </HashRouter>
  );
}

export default App;
