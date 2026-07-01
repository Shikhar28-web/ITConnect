import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { users as usersApi } from '../services/api';

function UserModal({ user, onClose, onSave }) {
  const isEdit = !!user;
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
    password: '',
    fullName: user?.fullName || '',
    department: user?.department || '',
    role: user?.role || 'Engineer',
    isActive: user?.isActive ?? true,
    location: user?.location || '12',
  });

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (isEdit) {
        await usersApi.update(user.id, {
          email: form.email,
          fullName: form.fullName,
          department: form.department,
          role: form.role,
          isActive: form.isActive,
          location: form.location,
        });
        toast.success('User updated');
      } else {
        await usersApi.create(form);
        toast.success('User created');
      }
      onSave();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save user');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{isEdit ? '✏️ Edit User' : '👤 New User'}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!isEdit && (
            <>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input id="user-username" type="text" className="form-input" value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input id="user-password" type="password" className="form-input" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              </div>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input id="user-fullname" type="text" className="form-input" value={form.fullName}
                onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input id="user-email" type="email" className="form-input" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Department</label>
              <input id="user-dept" type="text" className="form-input" value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select id="user-role" className="form-input form-select" value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {['SuperAdmin', 'Admin', 'Engineer', 'ReadOnly'].map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Location</label>
            <select id="user-location" className="form-input form-select" value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}>
              {['12', '78', '64', '13'].map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>

          {isEdit && (
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isActive}
                  onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
                <span style={{ fontSize: 14 }}>Account Active</span>
              </label>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            id="user-submit"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !form.fullName || !form.email || (!isEdit && (!form.username || !form.password))}
          >
            {submitting ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create User')}
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersPage() {
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    try {
      const data = await usersApi.getAll();
      setAllUsers(data);
    } catch { toast.error('Failed to load users'); }
    finally { setLoading(false); }
  }

  async function handleDelete(user) {
    if (!window.confirm(`Deactivate user "${user.username}"?`)) return;
    try {
      await usersApi.delete(user.id);
      toast.success('User deactivated');
      loadUsers();
    } catch { toast.error('Failed to deactivate user'); }
  }

  const filtered = allUsers.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.fullName.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const roleBadge = (r) => ({
    SuperAdmin: 'badge-danger', Admin: 'badge-warning',
    Engineer: 'badge-insession', ReadOnly: 'badge-offline'
  })[r] || 'badge-info';

  if (loading) return <div className="loading-overlay"><div className="loading-spinner lg" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <input
          id="user-search"
          className="form-input"
          placeholder="🔍 Search users..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <button id="create-user-btn" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New User
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Department</th>
              <th>Location</th>
              <th>Role</th>
              <th>MFA</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%',
                      background: 'var(--gradient-primary)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0
                    }}>
                      {u.fullName[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{u.fullName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{u.username}</div>
                    </div>
                  </div>
                </td>
                <td style={{ fontSize: 13 }}>{u.email}</td>
                <td>{u.department}</td>
                <td><span className="badge badge-info">{u.location || '—'}</span></td>
                <td><span className={`badge ${roleBadge(u.role)}`}>{u.role}</span></td>
                <td>{u.mFAEnabled ? '🔐 On' : '—'}</td>
                <td>
                  <span className={`badge ${u.isActive ? 'badge-online' : 'badge-offline'}`}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                </td>
                <td>
                  <div className="flex gap-2">
                    <button id={`edit-user-${u.id}`} className="btn btn-ghost btn-sm" onClick={() => setSelected(u)}>Edit</button>
                    <button id={`delete-user-${u.id}`} className="btn btn-danger btn-sm" onClick={() => handleDelete(u)}>Deactivate</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && <UserModal user={selected} onClose={() => setSelected(null)} onSave={loadUsers} />}
      {showCreate && <UserModal onClose={() => setShowCreate(false)} onSave={loadUsers} />}
    </div>
  );
}

export default UsersPage;
