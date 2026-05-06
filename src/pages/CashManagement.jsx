import React, { useState, useEffect } from 'react';
import { ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { formatCurrency, formatDateTime } from '../utils/formatters';

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

export default function CashManagement() {
  const [entries, setEntries] = useState([]);
  const [cashSales, setCashSales] = useState([]);
  const [showForm, setShowForm] = useState(null); // 'in' | 'out'
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [filterDate, setFilterDate] = useState(toDateInputValue(new Date()));
  const currentStaff = useAuthStore(s => s.currentStaff);
  const toast = useToast();

  useEffect(() => { load(); }, [filterDate]);
  async function load() {
    const start = new Date(`${filterDate}T00:00:00`).getTime();
    const end = new Date(`${filterDate}T23:59:59.999`).getTime();
    const [drawerRows, saleRows] = await Promise.all([
      db.cashDrawer.query({
        filters: [
          { field: 'datetime', op: 'gte', value: start },
          { field: 'datetime', op: 'lte', value: end },
        ],
        orderBy: 'datetime',
        ascending: false,
      }),
      db.transactions.query({
        filters: [
          { field: 'datetime', op: 'gte', value: start },
          { field: 'datetime', op: 'lte', value: end },
          { field: 'paymentMethod', op: 'eq', value: 'Cash' },
          { field: 'status', op: 'eq', value: 'completed' },
        ],
        orderBy: 'datetime',
        ascending: false,
      }),
    ]);
    setEntries(drawerRows);
    setCashSales(saleRows);
  }

  async function save() {
    if (!amount || Number(amount) <= 0) return;
    await db.cashDrawer.add({
      type: showForm, amount: Number(amount), notes,
      staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: Date.now(),
    });
    toast(`Cash ${showForm} recorded`);
    setShowForm(null); setAmount(''); setNotes(''); load();
  }

  const totalIn = entries.filter(e => e.type === 'in').reduce((s,e) => s + e.amount, 0);
  const totalOut = entries.filter(e => e.type === 'out').reduce((s,e) => s + e.amount, 0);
  const cashSalesTotal = cashSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const expectedCash = totalIn + cashSalesTotal - totalOut;

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Cash Drawer</h2>
        <div className="flex gap-8">
          <input className="form-input" type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ width: 160 }} />
          <button className="btn btn-success" onClick={() => setShowForm('in')}><ArrowUpCircle size={16} /> Cash In</button>
          <button className="btn btn-danger" onClick={() => setShowForm('out')}><ArrowDownCircle size={16} /> Cash Out</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Cash Sales</div><div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(cashSalesTotal)}</div></div>
        <div className="stat-card"><div className="stat-label">Manual Cash In</div><div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(totalIn)}</div></div>
        <div className="stat-card"><div className="stat-label">Manual Cash Out</div><div className="stat-value" style={{ color: 'var(--danger)' }}>{formatCurrency(totalOut)}</div></div>
        <div className="stat-card"><div className="stat-label">Expected Cash</div><div className="stat-value">{formatCurrency(expectedCash)}</div></div>
      </div>

      <div className="alert-banner alert-info mb-24">
        <span>Expected Cash = cash sales paid in Cash + manual cash in - manual cash out. It does not count GCash, Grab, Foodpanda, card, or bank transfer sales.</span>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Date/Time</th><th>Type</th><th>Amount</th><th>Notes</th><th>Staff</th></tr></thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td>{formatDateTime(e.datetime)}</td>
                <td><span className={`badge ${e.type === 'in' ? 'badge-success' : 'badge-danger'}`}>{e.type === 'in' ? 'Cash In' : 'Cash Out'}</span></td>
                <td style={{ fontWeight: 600 }}>{formatCurrency(e.amount)}</td>
                <td>{e.notes || '—'}</td>
                <td>{e.staffName || 'Unknown'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title={showForm === 'in' ? 'Cash In' : 'Cash Out'} onClose={() => setShowForm(null)} footer={
          <><button className="btn btn-secondary" onClick={() => setShowForm(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>
        }>
          <div className="form-group"><label className="form-label">Amount (₱)</label><input className="form-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
          <div className="form-group"><label className="form-label">Notes</label><input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for cash movement" /></div>
          <div className="form-group"><label className="form-label">Staff</label><div className="form-input" style={{ background: 'var(--bg-card)' }}>{currentStaff?.name || 'Not logged in'}</div></div>
        </Modal>
      )}
    </div>
  );
}
