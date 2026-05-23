/* Version 2.1 - Forced Refresh */
import React, { useState } from 'react';
import { Banknote, Smartphone, CreditCard, Landmark, ShoppingBag } from 'lucide-react';
import Modal from '../common/Modal';
import { formatCurrency } from '../../utils/formatters';
import { calcChange } from '../../utils/calculations';
import { formatPaymentLabel } from '../../utils/payments';

const methods = [
  { id: 'Cash', icon: Banknote, label: 'Cash' },
  { id: 'GCash', icon: Smartphone, label: 'GCash' },
  { id: 'Card', icon: CreditCard, label: 'Card' },
  { id: 'Bank Transfer', icon: Landmark, label: 'Bank Transfer' },
  { id: 'Grab', icon: ShoppingBag, label: 'Grab' },
  { id: 'Foodpanda', icon: ShoppingBag, label: 'Foodpanda' },
];

export default function PaymentModal({ total, onConfirm, onClose, isProcessing = false }) {
  const [paymentLines, setPaymentLines] = useState([{ method: 'Cash', amount: '' }]);
  const paidTotal = paymentLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const remaining = Math.max(0, Number(total || 0) - paidTotal);
  const cashPaid = paymentLines.filter(line => line.method === 'Cash').reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const nonCashPaid = paidTotal - cashPaid;
  const change = calcChange(paidTotal, total);
  const hasCash = paymentLines.some(line => line.method === 'Cash');
  const canConfirm = !isProcessing && paidTotal >= total && nonCashPaid <= total && (paidTotal <= total || hasCash);

  const quickAmounts = [50, 100, 200, 500, 1000].filter(a => a >= total);

  function isSelected(methodId) {
    return paymentLines.some(line => line.method === methodId);
  }

  function toggleMethod(methodId) {
    if (isProcessing) return;
    setPaymentLines(current => {
      if (current.some(line => line.method === methodId)) {
        if (current.length === 1) return current;
        return current.filter(line => line.method !== methodId);
      }
      if (current.length === 1 && Number(current[0].amount || 0) === 0) {
        return [{ method: methodId, amount: String(Number(total || 0)) }];
      }
      const paid = current.reduce((sum, line) => sum + Number(line.amount || 0), 0);
      const amount = Math.max(0, Number(total || 0) - paid);
      return [...current, { method: methodId, amount: amount ? String(amount) : '' }];
    });
  }

  function setLineAmount(methodId, amount) {
    setPaymentLines(current => current.map(line => line.method === methodId ? { ...line, amount } : line));
  }

  function fillRemaining(methodId) {
    setPaymentLines(current => {
      const otherPaid = current
        .filter(line => line.method !== methodId)
        .reduce((sum, line) => sum + Number(line.amount || 0), 0);
      const amount = Math.max(0, Number(total || 0) - otherPaid);
      return current.map(line => line.method === methodId ? { ...line, amount: String(amount) } : line);
    });
  }

  return (
    <Modal title="Payment" onClose={onClose} footer={
      <button className="btn btn-primary btn-lg w-full" disabled={!canConfirm} onClick={() => onConfirm(paymentLines.map(line => ({ method: line.method, amount: Number(line.amount || 0) })).filter(line => line.amount > 0), cashPaid || null)}>
        {isProcessing ? 'Processing...' : 'Complete Payment'}
      </button>
    }>
      <div className="payment-methods">
        {methods.map(m => (
          <div key={m.id} className={`payment-method ${isSelected(m.id) ? 'selected' : ''}`} onClick={() => toggleMethod(m.id)}>
            <m.icon size={24} />
            <span>{m.label}</span>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="text-muted text-sm mb-16">Amount Due</div>
        <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(total)}</div>
      </div>

      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {paymentLines.map(line => (
          <div key={line.method} className="payment-split-row">
            <div>
              <div style={{ fontWeight: 700 }}>{line.method}</div>
              <button className="btn btn-ghost btn-sm" type="button" disabled={isProcessing} onClick={() => fillRemaining(line.method)}>Fill remaining</button>
            </div>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={line.amount}
              onChange={e => setLineAmount(line.method, e.target.value)}
              placeholder="Amount"
              style={{ fontSize: '1.1rem', textAlign: 'right' }}
              disabled={isProcessing}
              autoFocus={line.method === 'Cash'}
            />
          </div>
        ))}
      </div>

      {hasCash && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {quickAmounts.map(a => (
              <button key={a} className="btn btn-secondary btn-sm" disabled={isProcessing} onClick={() => setLineAmount('Cash', String(a))}>{formatCurrency(a)}</button>
            ))}
          </div>
          {change > 0 && (
            <div style={{ textAlign: 'center', padding: 12, background: 'var(--success-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 16 }}>
              <div className="text-sm" style={{ color: 'var(--success)' }}>Change</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>{formatCurrency(change)}</div>
            </div>
          )}
        </>
      )}

      <div className={`alert-banner ${paidTotal >= total ? 'alert-success' : 'alert-info'}`} style={{ marginBottom: 0 }}>
        <span>
          {formatPaymentLabel(paymentLines)} paid {formatCurrency(paidTotal)}.
          {' '}
          {paidTotal < total ? `${formatCurrency(remaining)} remaining.` : change > 0 ? `${formatCurrency(change)} change.` : 'Fully paid.'}
        </span>
      </div>
    </Modal>
  );
}
