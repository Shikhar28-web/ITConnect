import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { tickets as ticketsApi, devices } from '../services/api';

function TicketModal({ ticket, onClose, onSave }) {
  const [form, setForm] = useState({
    status: ticket?.status || 'Open',
    resolution: ticket?.resolution || '',
  });

  const handleUpdate = async () => {
    try {
      await ticketsApi.update(ticket.id, {
        status: form.status,
        resolution: form.resolution || null
      });
      toast.success('Ticket updated');
      onSave();
      onClose();
    } catch {
      toast.error('Failed to update ticket');
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">🎫 {ticket.ticketNumber}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <h3 style={{ marginBottom: 8 }}>{ticket.title}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>{ticket.description}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {[
              ['Device', ticket.deviceHostname],
              ['Reporter', ticket.reporterName],
              ['Priority', ticket.priority],
              ['Created', new Date(ticket.createdAt).toLocaleDateString()],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{val}</div>
              </div>
            ))}
          </div>

          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-input form-select"
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
            >
              {['Open', 'InProgress', 'OnHold', 'Resolved', 'Closed'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Resolution Notes</label>
            <textarea
              className="form-input"
              rows={4}
              placeholder="Describe how the issue was resolved..."
              value={form.resolution}
              onChange={e => setForm(f => ({ ...f, resolution: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleUpdate}>Update Ticket</button>
        </div>
      </div>
    </div>
  );
}

function CreateTicketModal({ onClose, onSave }) {
  const [allDevices, setAllDevices] = useState([]);
  const [form, setForm] = useState({
    title: '', description: '', deviceId: '', category: 'Hardware',
    reporterName: '', reporterEmail: '', priority: 'Medium'
  });

  useEffect(() => {
    devices.getAll().then(setAllDevices).catch(() => {});
  }, []);

  const handleCreate = async () => {
    try {
      await ticketsApi.create({ ...form, deviceId: parseInt(form.deviceId) });
      toast.success('Ticket created');
      onSave();
      onClose();
    } catch {
      toast.error('Failed to create ticket');
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <div className="modal-title">🎫 New Support Ticket</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {[
            { key: 'title', label: 'Title', type: 'text', placeholder: 'Brief description of the issue' },
            { key: 'reporterName', label: 'Reporter Name', type: 'text', placeholder: 'Employee name' },
            { key: 'reporterEmail', label: 'Reporter Email', type: 'email', placeholder: 'employee@company.com' },
          ].map(f => (
            <div className="form-group" key={f.key}>
              <label className="form-label">{f.label}</label>
              <input
                id={`ticket-${f.key}`}
                type={f.type}
                className="form-input"
                placeholder={f.placeholder}
                value={form[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}

          <div className="form-group">
            <label className="form-label">Device</label>
            <select
              id="ticket-device"
              className="form-input form-select"
              value={form.deviceId}
              onChange={e => setForm(f => ({ ...f, deviceId: e.target.value }))}
            >
              <option value="">Select device...</option>
              {allDevices.map(d => (
                <option key={d.id} value={d.id}>{d.hostname} ({d.ipAddress})</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-input form-select" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {['Hardware', 'Software', 'Network', 'Security', 'Performance', 'Other'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-input form-select" value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {['Low', 'Medium', 'High', 'Critical'].map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-input"
              rows={4}
              placeholder="Detailed description..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            id="create-ticket-submit"
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!form.title || !form.deviceId || !form.reporterName}
          >
            Create Ticket
          </button>
        </div>
      </div>
    </div>
  );
}

function TicketsPage() {
  const [allTickets, setAllTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { loadTickets(); }, []);

  async function loadTickets() {
    try {
      const data = await ticketsApi.getAll();
      setAllTickets(data);
    } catch { toast.error('Failed to load tickets'); }
    finally { setLoading(false); }
  }

  const filtered = allTickets.filter(t => {
    const matchSearch = t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.ticketNumber.toLowerCase().includes(search.toLowerCase()) ||
      t.reporterName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'All' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const priorityBadge = (p) => ({
    Low: 'badge-info', Medium: 'badge-success', High: 'badge-warning', Critical: 'badge-danger'
  })[p] || 'badge-info';

  const statusBadge = (s) => ({
    Open: 'badge-warning', InProgress: 'badge-insession',
    Resolved: 'badge-success', Closed: 'badge-offline', OnHold: 'badge-info'
  })[s] || 'badge-info';

  if (loading) return <div className="loading-overlay"><div className="loading-spinner lg" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2 items-center">
          <input
            id="ticket-search"
            className="form-input"
            placeholder="🔍 Search tickets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          {['All', 'Open', 'InProgress', 'Resolved', 'Closed'].map(s => (
            <button
              key={s}
              id={`status-${s.toLowerCase()}`}
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStatusFilter(s)}
            >{s}</button>
          ))}
        </div>
        <button
          id="create-ticket-btn"
          className="btn btn-primary"
          onClick={() => setShowCreate(true)}
        >+ New Ticket</button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Title</th>
              <th>Device</th>
              <th>Reporter</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.ticketNumber}</td>
                <td><strong>{t.title}</strong></td>
                <td>{t.deviceHostname}</td>
                <td>{t.reporterName}</td>
                <td><span className={`badge ${priorityBadge(t.priority)}`}>{t.priority}</span></td>
                <td><span className={`badge ${statusBadge(t.status)}`}>{t.status}</span></td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                <td>
                  <button
                    id={`view-ticket-${t.id}`}
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSelectedTicket(t)}
                  >View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedTicket && (
        <TicketModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onSave={loadTickets}
        />
      )}
      {showCreate && (
        <CreateTicketModal
          onClose={() => setShowCreate(false)}
          onSave={loadTickets}
        />
      )}
    </div>
  );
}

export default TicketsPage;
