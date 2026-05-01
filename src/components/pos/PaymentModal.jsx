/* Version 2.1 - Forced Refresh */
import React, { useState } from 'react';
import { Banknote, Smartphone, CreditCard, Landmark } from 'lucide-react';
import Modal from '../common/Modal';
import { formatCurrency } from '../../utils/formatters';
import { calcChange } from '../../utils/calculations';

const methods = [
  { id: 'Cash', icon: Banknote, label: 'Cash' },
  { id: 'GCash', icon: Smartphone, label: 'GCash' },
  { id: 'Card', icon: CreditCard, label: 'Card' },
  { id: 'Bank Transfer', icon: Landmark, label: 'Bank Transfer' },
];

export default function PaymentModal({ total, onConfirm, onClose }) {
  const [method, setMethod] = useState('Cash');
  const [cashAmount, setCashAmount] = useState('');
  const change = calcChange(Number(cashAmount), total);
  const canConfirm = method !== 'Cash' || Number(cashAmount) >= total;

  const quickAmounts = [50, 100, 200, 500, 1000].filter(a => a >= total);

  return (
    <Modal title="Payment" onClose={onClose} footer={
      <button className="btn btn-primary btn-lg w-full" disabled={!canConfirm} onClick={() => onConfirm(method, method === 'Cash' ? Number(cashAmount) : total)}>
        Complete Payment
      </button>
    }>
      <div className="payment-methods">
        {methods.map(m => (
          <div key={m.id} className={`payment-method ${method === m.id ? 'selected' : ''}`} onClick={() => setMethod(m.id)}>
            <m.icon size={24} />
            <span>{m.label}</span>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="text-muted text-sm mb-16">Amount Due</div>
        <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(total)}</div>
      </div>

      {method === 'Cash' && (
        <>
          <div className="form-group">
            <label className="form-label">Cash Received</label>
            <input className="form-input" type="number" value={cashAmount} onChange={e => setCashAmount(e.target.value)} placeholder="Enter amount" style={{ fontSize: '1.25rem', textAlign: 'center' }} autoFocus />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {quickAmounts.map(a => (
              <button key={a} className="btn btn-secondary btn-sm" onClick={() => setCashAmount(String(a))}>{formatCurrency(a)}</button>
            ))}
          </div>
          {Number(cashAmount) >= total && (
            <div style={{ textAlign: 'center', padding: 12, background: 'var(--success-bg)', borderRadius: 'var(--radius-sm)' }}>
              <div className="text-sm" style={{ color: 'var(--success)' }}>Change</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>{formatCurrency(change)}</div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
