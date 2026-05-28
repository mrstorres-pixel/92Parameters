import React, { useEffect, useState } from 'react';
import { Plus, Edit2, History, Search, CreditCard, Gift, Ban, CheckCircle } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import { useToast } from '../components/common/Toast';
import { useAuthStore } from '../stores/authStore';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import { generateMemberCode, POINTS_PER_PESO_EARNED, POINTS_PER_PESO_REDEEMED, writeLoyaltyTransaction } from '../utils/loyalty';

const empty = { name: '', phone: '', birthday: '', status: 'active' };

export default function CustomerMembership() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [historyCustomer, setHistoryCustomer] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [adjusting, setAdjusting] = useState(null);
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const currentStaff = useAuthStore(s => s.currentStaff);
  const toast = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    setCustomers(await db.customers.query({ orderBy: 'createdAt', ascending: false, limit: 1000 }));
  }

  function openNew() {
    setForm(empty);
    setEditing('new');
  }

  function openEdit(customer) {
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      birthday: customer.birthday || '',
      status: customer.status || 'active',
    });
    setEditing(customer);
  }

  async function save() {
    if (!form.name.trim()) {
      toast('Customer name is required', 'error');
      return;
    }
    try {
      const data = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        birthday: form.birthday || null,
        status: form.status,
        updatedAt: Date.now(),
      };
      if (editing === 'new') {
        const id = await db.customers.add({
          ...data,
          memberCode: generateMemberCode(),
          pointsBalance: 0,
          createdAt: Date.now(),
        });
        await db.auditLog.add({ action: 'CREATE_CUSTOMER', entity: data.name, entityId: id, staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: Date.now(), details: 'Created loyalty member' });
        toast('Customer member added');
      } else {
        await db.customers.update(editing.id, data);
        await db.auditLog.add({ action: 'UPDATE_CUSTOMER', entity: data.name, entityId: editing.id, staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: Date.now(), details: 'Updated loyalty member' });
        toast('Customer updated');
      }
      setEditing(null);
      load();
    } catch (error) {
      console.error(error);
      toast('Could not save customer. Check the connection or member code.', 'error');
    }
  }

  async function openHistory(customer) {
    setHistoryCustomer(customer);
    setHistoryRows(await db.loyaltyTransactions.query({
      filters: [{ field: 'customerId', op: 'eq', value: customer.id }],
      orderBy: 'datetime',
      ascending: false,
      limit: 100,
    }));
  }

  async function applyAdjustment() {
    const points = Number(adjustPoints || 0);
    if (!adjusting || !points || !adjustReason.trim()) {
      toast('Enter points and a reason', 'error');
      return;
    }
    try {
      await writeLoyaltyTransaction({
        customer: adjusting,
        type: 'ADJUST',
        points,
        details: adjustReason.trim(),
        staff: currentStaff,
      });
      toast('Points adjusted');
      setAdjusting(null);
      setAdjustPoints('');
      setAdjustReason('');
      load();
    } catch (error) {
      console.error(error);
      toast('Could not adjust points', 'error');
    }
  }

  const filtered = customers.filter(customer => {
    const q = search.toLowerCase();
    return !q ||
      (customer.name || '').toLowerCase().includes(q) ||
      (customer.phone || '').toLowerCase().includes(q) ||
      (customer.memberCode || '').toLowerCase().includes(q);
  });
  const activeCount = customers.filter(c => c.status !== 'inactive').length;
  const totalPoints = customers.reduce((sum, c) => sum + Number(c.pointsBalance || 0), 0);

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Customer Membership</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Add Member</button>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Members</div><div className="stat-value">{customers.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active Members</div><div className="stat-value">{activeCount}</div></div>
        <div className="stat-card"><div className="stat-label">Outstanding Points</div><div className="stat-value">{totalPoints}</div></div>
        <div className="stat-card"><div className="stat-label">Redeem Rate</div><div className="stat-value" style={{ fontSize: '1.1rem' }}>{POINTS_PER_PESO_REDEEMED} pts = {formatCurrency(1)}</div></div>
      </div>

      <div className="alert-banner alert-info mb-24">
        <Gift size={18} />
        <span>Members earn {POINTS_PER_PESO_EARNED} point per peso paid. Rewards redeem at {POINTS_PER_PESO_REDEEMED} points per peso discount.</span>
      </div>

      <div className="toolbar">
        <div className="search-bar"><Search size={16} /><input placeholder="Search name, phone, or card code..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Member</th><th>Card Code</th><th>Phone</th><th>Points</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(customer => (
              <tr key={customer.id}>
                <td style={{ fontWeight: 600 }}>{customer.name}</td>
                <td><span className="badge badge-neutral">{customer.memberCode}</span></td>
                <td>{customer.phone || '-'}</td>
                <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{customer.pointsBalance || 0}</td>
                <td>{customer.status === 'inactive' ? <span className="badge badge-danger"><Ban size={12} /> Inactive</span> : <span className="badge badge-success"><CheckCircle size={12} /> Active</span>}</td>
                <td>
                  <div className="flex gap-8">
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openHistory(customer)} title="History"><History size={14} /></button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setAdjusting(customer)} title="Adjust Points"><Gift size={14} /></button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEdit(customer)} title="Edit"><Edit2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing === 'new' ? 'Add Member' : 'Edit Member'} onClose={() => setEditing(null)} footer={
          <><button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>
        }>
          {editing !== 'new' && (
            <div className="membership-card mb-16">
              <CreditCard size={22} />
              <div>
                <div style={{ fontWeight: 800 }}>{editing.memberCode}</div>
                <div className="text-muted text-sm">Use this code on the customer's printed card or QR/barcode.</div>
              </div>
            </div>
          )}
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus /></div>
          <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Birthday</label><input className="form-input" type="date" value={form.birthday || ''} onChange={e => setForm({ ...form, birthday: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Status</label><select className="form-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          </div>
        </Modal>
      )}

      {adjusting && (
        <Modal title={`Adjust Points - ${adjusting.name}`} onClose={() => setAdjusting(null)} footer={
          <><button className="btn btn-secondary" onClick={() => setAdjusting(null)}>Cancel</button><button className="btn btn-primary" onClick={applyAdjustment}>Apply</button></>
        }>
          <div className="form-group"><label className="form-label">Current Points</label><div className="form-input" style={{ background: 'var(--bg-card)' }}>{adjusting.pointsBalance || 0}</div></div>
          <div className="form-group"><label className="form-label">Point Adjustment</label><input className="form-input" type="number" value={adjustPoints} onChange={e => setAdjustPoints(e.target.value)} placeholder="Use negative value to deduct" autoFocus /></div>
          <div className="form-group"><label className="form-label">Reason</label><input className="form-input" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="Manual correction, promo, etc." /></div>
        </Modal>
      )}

      {historyCustomer && (
        <Modal title={`${historyCustomer.name} Loyalty History`} large onClose={() => setHistoryCustomer(null)} footer={<button className="btn btn-primary" onClick={() => setHistoryCustomer(null)}>Close</button>}>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Type</th><th>Points</th><th>Balance</th><th>Receipt</th><th>Details</th></tr></thead>
              <tbody>
                {historyRows.map(row => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.datetime)}</td>
                    <td><span className="badge badge-neutral">{row.type}</span></td>
                    <td style={{ fontWeight: 700, color: row.points >= 0 ? 'var(--success)' : 'var(--danger)' }}>{row.points > 0 ? '+' : ''}{row.points}</td>
                    <td>{row.afterPoints}</td>
                    <td>{row.receiptNo || '-'}</td>
                    <td>{row.details || '-'}</td>
                  </tr>
                ))}
                {historyRows.length === 0 && <tr><td colSpan={6} className="text-center text-muted">No loyalty history yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
