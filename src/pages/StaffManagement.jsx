import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Search, Users } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';

const emptyForm = { name: '', pin: '', role: 'cashier' };

export default function StaffManagement() {
  const [staff, setStaff] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // 'new' or staff ID
  const [form, setForm] = useState(emptyForm);
  const [showPin, setShowPin] = useState(false);
  
  const { currentStaff } = useAuthStore();
  const toast = useToast();

  useEffect(() => { load(); }, []);
  
  async function load() {
    const allStaff = await db.staff.toArray();
    // Sort by role (owner -> manager -> cashier)
    const roleOrder = { owner: 1, manager: 2, cashier: 3 };
    allStaff.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);
    setStaff(allStaff);
  }

  function openNew() {
    setForm(emptyForm);
    setShowPin(false);
    setEditing('new');
  }

  function openEdit(s) {
    setForm({ ...s });
    setShowPin(false);
    setEditing(s.id);
  }

  async function save() {
    if (!form.name || !form.pin || !form.role) {
      toast('Please fill all required fields', 'error');
      return;
    }
    
    // Check if PIN is exactly 4 digits
    if (!/^\d{4}$/.test(form.pin)) {
      toast('PIN must be exactly 4 digits', 'error');
      return;
    }

    // Ensure PIN is unique
    const existing = await db.staff.where('pin').equals(form.pin).first();
    if (existing && existing.id !== editing) {
      toast('This PIN is already in use by another staff member', 'error');
      return;
    }

    const data = { name: form.name, pin: form.pin, role: form.role };

    if (editing === 'new') {
      await db.staff.add(data);
      toast('Staff member added successfully');
    } else {
      await db.staff.update(editing, data);
      toast('Staff member updated successfully');
      
      // If the owner edits themselves, maybe update authStore?
      if (currentStaff.id === editing) {
        useAuthStore.getState().login(await db.staff.get(editing));
      }
    }
    
    setEditing(null);
    load();
  }

  async function remove(id) {
    // Prevent owner from deleting themselves to avoid locking out the system
    if (id === currentStaff.id) {
      toast('You cannot delete your own account', 'error');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this staff member? This will not delete their past records.')) return;
    
    await db.staff.delete(id);
    toast('Staff member removed', 'info');
    load();
  }

  const filtered = staff.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.role.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Staff Management</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Add Staff</button>
      </div>

      <div className="toolbar">
        <div className="search-bar">
          <Search size={16} />
          <input placeholder="Search name or role..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>PIN</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 500 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="staff-avatar" style={{ width: 32, height: 32, fontSize: '0.9rem' }}>{s.name.charAt(0)}</div>
                    {s.name}
                    {s.id === currentStaff.id && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>You</span>}
                  </div>
                </td>
                <td>
                  <span className={`badge ${s.role === 'owner' ? 'badge-danger' : s.role === 'manager' ? 'badge-primary' : 'badge-neutral'}`} style={{ textTransform: 'capitalize' }}>
                    {s.role}
                  </span>
                </td>
                <td style={{ fontFamily: 'monospace', letterSpacing: 2 }}>****</td>
                <td>
                  <div className="flex gap-8">
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEdit(s)} title="Edit">
                      <Edit2 size={14} />
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(s.id)} title="Delete" disabled={s.id === currentStaff.id}>
                      <Trash2 size={14} color={s.id === currentStaff.id ? "var(--text-muted)" : "var(--danger)"} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-muted" style={{ padding: 24 }}>No staff found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <Modal title={editing === 'new' ? 'Add Staff Member' : 'Edit Staff Member'} onClose={() => setEditing(null)} footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </>
        }>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input 
              className="form-input" 
              placeholder="e.g. Maria Santos"
              value={form.name} 
              onChange={e => setForm({...form, name: e.target.value})} 
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Role</label>
              <select 
                className="form-select" 
                value={form.role} 
                onChange={e => setForm({...form, role: e.target.value})}
                style={{ textTransform: 'capitalize' }}
              >
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">4-Digit PIN</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input 
                  className="form-input" 
                  type={showPin ? "text" : "password"}
                  maxLength={4}
                  placeholder="e.g. 1234"
                  value={form.pin} 
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, ''); // only allow digits
                    setForm({...form, pin: val});
                  }} 
                  style={{ fontFamily: 'monospace', letterSpacing: 2 }}
                />
                <button 
                  className="btn btn-secondary" 
                  onClick={() => setShowPin(!showPin)}
                  style={{ width: 80 }}
                >
                  {showPin ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>
          
          {editing === currentStaff.id && (
            <p className="text-sm text-muted" style={{ marginTop: 16 }}>
              Note: You are editing your own account. If you change your PIN, make sure to remember it for your next login!
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
