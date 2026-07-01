import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ─── Axios Instance ───────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

// Attach JWT token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = localStorage.getItem('refreshToken');
      if (refresh) {
        try {
          const res = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken: refresh });
          localStorage.setItem('accessToken', res.data.accessToken);
          localStorage.setItem('refreshToken', res.data.refreshToken);
          original.headers.Authorization = `Bearer ${res.data.accessToken}`;
          return api(original);
        } catch {
          localStorage.clear();
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const auth = {
  login: (username, password, mfaCode) =>
    api.post('/api/auth/login', { username, password, mFACode: mfaCode }).then(r => r.data),
  logout: () => api.post('/api/auth/logout'),
  refresh: (refreshToken) => api.post('/api/auth/refresh', { refreshToken }).then(r => r.data),
  setupMFA: () => api.post('/api/auth/mfa/setup').then(r => r.data),
  verifyMFA: (code) => api.post('/api/auth/mfa/verify', JSON.stringify(code)).then(r => r.data),
  disableMFA: (code) => api.post('/api/auth/mfa/disable', JSON.stringify(code)).then(r => r.data),
  changePassword: (data) => api.post('/api/auth/change-password', data).then(r => r.data),
  getMe: () => api.get('/api/users/me').then(r => r.data),
};

// ─── Devices ──────────────────────────────────────────────────────────────────
export const devices = {
  getAll: () => api.get('/api/devices').then(r => r.data),
  getById: (id) => api.get(`/api/devices/${id}`).then(r => r.data),
  getOnline: () => api.get('/api/devices/online').then(r => r.data),
  getOffline: () => api.get('/api/devices/offline').then(r => r.data),
  getByIP: (ip) => api.get(`/api/devices/ip/${ip}`).then(r => r.data),
  authorize: (id) => api.post(`/api/devices/${id}/authorize`).then(r => r.data),
  revoke: (id) => api.post(`/api/devices/${id}/revoke`).then(r => r.data),
  wakeOnLan: (macAddress, broadcastIP) =>
    api.post('/api/devices/wol', { macAddress, broadcastIP }).then(r => r.data),
};

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const sessions = {
  getAll: (from, to) => api.get('/api/sessions', { params: { from, to } }).then(r => r.data),
  getActive: () => api.get('/api/sessions/active').then(r => r.data),
  getById: (id) => api.get(`/api/sessions/${id}`).then(r => r.data),
  getByDevice: (deviceId) => api.get(`/api/sessions/device/${deviceId}`).then(r => r.data),
  getByEngineer: (engineerId) => api.get(`/api/sessions/engineer/${engineerId}`).then(r => r.data),
  start: (deviceId, ticketId, record = true) =>
    api.post('/api/sessions/start', { deviceId, ticketId, record }).then(r => r.data),
  end: (sessionId, notes) =>
    api.post('/api/sessions/end', { sessionId, notes }).then(r => r.data),
  getRecording: (id) => api.get(`/api/sessions/${id}/recording`, { responseType: 'blob' }).then(r => r.data),
};

// ─── Tickets ──────────────────────────────────────────────────────────────────
export const tickets = {
  getAll: () => api.get('/api/tickets').then(r => r.data),
  getById: (id) => api.get(`/api/tickets/${id}`).then(r => r.data),
  getByDevice: (deviceId) => api.get(`/api/tickets/device/${deviceId}`).then(r => r.data),
  create: (data) => api.post('/api/tickets', data).then(r => r.data),
  update: (id, data) => api.put(`/api/tickets/${id}`, data).then(r => r.data),
  delete: (id) => api.delete(`/api/tickets/${id}`),
};

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = {
  getAll: () => api.get('/api/users').then(r => r.data),
  getById: (id) => api.get(`/api/users/${id}`).then(r => r.data),
  create: (data) => api.post('/api/users', data).then(r => r.data),
  update: (id, data) => api.put(`/api/users/${id}`, data).then(r => r.data),
  delete: (id) => api.delete(`/api/users/${id}`),
};

// ─── Reports ──────────────────────────────────────────────────────────────────
export const reports = {
  dashboard: () => api.get('/api/reports/dashboard').then(r => r.data),
  engineerPerformance: (from, to) =>
    api.get('/api/reports/engineer-performance', { params: { from, to } }).then(r => r.data),
  deviceHealth: (from, to) =>
    api.get('/api/reports/device-health', { params: { from, to } }).then(r => r.data),
};

// ─── Notifications ────────────────────────────────────────────────────────────
export const notifications = {
  getAll: (unreadOnly = false) =>
    api.get('/api/notifications', { params: { unreadOnly } }).then(r => r.data),
  markRead: (id) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post('/api/notifications/read-all'),
};

// ─── Audit Logs ───────────────────────────────────────────────────────────────
export const auditLogs = {
  get: (from, to, userId, action) =>
    api.get('/api/auditlogs', { params: { from, to, userId, action } }).then(r => r.data),
};

// ─── Device Groups ────────────────────────────────────────────────────────────
export const deviceGroups = {
  getAll: () => api.get('/api/devicegroups').then(r => r.data),
  create: (data) => api.post('/api/devicegroups', data).then(r => r.data),
  update: (id, data) => api.put(`/api/devicegroups/${id}`, data).then(r => r.data),
  delete: (id) => api.delete(`/api/devicegroups/${id}`).then(r => r.data),
};

export default api;
