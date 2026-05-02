import React, { useState, useEffect } from 'react';
import { Search, Eye, Ban } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import ReceiptModal from '../components/pos/ReceiptModal';
import { useToast } from '../components/common/Toast';
import { formatCurrency, formatDate, formatTime, formatDateTime } from '../utils/formatters';
import { calcItemTotal } from '../utils/calculations';
import { PAGE_SIZE, recordIngredientMovement, reverseDailySalesSummary } from '../utils/durability';

export default function TransactionReport() {
  const [txns, setTxns] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [showReceipt, setShowReceipt] = useState(null);
  const [showVoid, setShowVoid] = useState(null);
  const [page, setPage] = useState(0);
  const [voidReason, setVoidReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [voidError, setVoidError] = useState('');
  const toast = useToast();

  useEffect(() => { load(); }, [page]);
  async function load() {
    setTxns(await db.transactions.query({ orderBy: 'datetime', ascending: false, limit: PAGE_SIZE, offset: page * PAGE_SIZE }));
  }

  async function handleVoid() {
    try {
      const manager = await db.staff.where('pin').equals(managerPin).first();
      if (!manager || (manager.role !== 'manager' && manager.role !== 'owner')) {
        setVoidError('Invalid manager or owner PIN');
        return;
      }

      const txn = showVoid;
      await db.transactions.update(txn.id, { status: 'void' });
      await db.voidLog.add({
        transactionId: txn.id, receiptNo: txn.receiptNo, reason: voidReason,
        staffId: manager.id, staffName: manager.name, datetime: Date.now(),
        originalData: JSON.parse(JSON.stringify(txn)),
      });
      await reverseDailySalesSummary(txn);

      // Reverse ingredient deductions
      for (const item of (txn.items || [])) {
        const links = await db.productIngredients.where('productId').equals(item.productId).toArray();
        for (const link of links) {
          const ing = await db.ingredients.get(link.ingredientId);
          if (ing) {
            const restored = link.quantity * item.quantity;
            const nextStock = ing.inStock + restored;
            await db.ingredients.update(link.ingredientId, { inStock: nextStock });
            await db.auditLog.add({
              action: 'RESTOCK',
              entity: ing.name,
              entityId: link.ingredientId,
              staffId: manager.id,
              staffName: manager.name,
              datetime: Date.now(),
              details: `Restored ${restored}${ing.unit} from voided ${txn.receiptNo}; stock ${ing.inStock}${ing.unit} -> ${nextStock}${ing.unit}`
            });
            await recordIngredientMovement({
              ingredient: ing,
              ingredientId: link.ingredientId,
              transactionId: txn.id,
              receiptNo: txn.receiptNo,
              type: 'RESTOCK',
              quantity: restored,
              beforeStock: ing.inStock,
              afterStock: nextStock,
              staff: manager,
              productName: item.name,
            });
          }
        }
      }

      toast('Transaction voided');
      setShowVoid(null); setVoidReason(''); setManagerPin(''); setVoidError('');
      setSelected(null); load();
    } catch (error) {
      console.error('Void failed:', error);
      setVoidError('Could not void transaction. Please check the connection and try again.');
    }
  }

  const filtered = txns.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (t.receiptNo || '').toLowerCase().includes(q) || (t.staffName || '').toLowerCase().includes(q) || (t.paymentMethod || '').toLowerCase().includes(q);
  });

  return (
    <div className="animate-fade">
      <div className="page-header"><h2>Transaction Report</h2></div>
      <div className="toolbar">
        <div className="search-bar"><Search size={16} /><input placeholder="Search receipt #, staff, payment..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <span className="text-muted text-sm">Showing {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Time</th><th>Receipt #</th><th>Date</th><th>Type</th><th>Items</th><th>Payment</th><th>Staff</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.id} className="clickable" onClick={() => setSelected(t)}>
                <td>{formatTime(t.datetime)}</td>
                <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{t.receiptNo}</td>
                <td>{formatDate(t.datetime)}</td>
                <td><span className="badge badge-neutral">{t.orderType}</span></td>
                <td className="truncate" style={{ maxWidth: 200 }}>{(t.items||[]).map(i => `${i.name}×${i.quantity}`).join(', ')}</td>
                <td>{t.paymentMethod}</td>
                <td>{t.staffName || '—'}</td>
                <td style={{ fontWeight: 600 }}>{formatCurrency(t.total)}</td>
                <td>{t.status === 'void' ? <span className="void-stamp">VOID</span> : <span className="badge badge-success">Completed</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Previous</button>
        <span className="text-sm text-muted">Page {page + 1}</span>
        <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => p + 1)} disabled={txns.length < PAGE_SIZE}>Next</button>
      </div>

      {selected && (
        <Modal title={`Transaction ${selected.receiptNo}`} large onClose={() => setSelected(null)} footer={
          <>
            {selected.status !== 'void' && <button className="btn btn-danger" onClick={() => { setShowVoid(selected); setSelected(null); }}><Ban size={14} /> Void</button>}
            <button className="btn btn-secondary" onClick={() => { setShowReceipt(selected); setSelected(null); }}>View Receipt</button>
            <button className="btn btn-primary" onClick={() => setSelected(null)}>Close</button>
          </>
        }>
          <div className="form-row mb-16">
            <div><span className="form-label">Receipt #</span><div style={{ fontWeight: 600 }}>{selected.receiptNo}</div></div>
            <div><span className="form-label">Date & Time</span><div>{formatDateTime(selected.datetime)}</div></div>
          </div>
          <div className="form-row mb-16">
            <div><span className="form-label">Order Type</span><div><span className="badge badge-neutral">{selected.orderType}</span></div></div>
            <div><span className="form-label">Payment</span><div>{selected.paymentMethod}</div></div>
          </div>
          <div className="form-row mb-16">
            <div><span className="form-label">Staff</span><div>{selected.staffName || '—'}</div></div>
            <div><span className="form-label">Status</span><div>{selected.status === 'void' ? <span className="void-stamp">VOID</span> : <span className="badge badge-success">Completed</span>}</div></div>
          </div>

          <h4 style={{ fontSize: '0.9rem', marginBottom: 8, color: 'var(--text-secondary)' }}>Items</h4>
          <div className="table-container" style={{ marginBottom: 16 }}>
            <table className="data-table">
              <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Discount</th><th>Subtotal</th></tr></thead>
              <tbody>
                {(selected.items || []).map((item, i) => (
                  <tr key={i}>
                    <td>{item.name}</td><td>{item.quantity}</td><td>{formatCurrency(item.price)}</td>
                    <td>{item.discount > 0 ? `${item.discount}%` : '—'}</td><td style={{ fontWeight: 600 }}>{formatCurrency(calcItemTotal(item))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex-between" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
            <span>Total</span><span>{formatCurrency(selected.total)}</span>
          </div>
        </Modal>
      )}

      {showVoid && (
        <Modal title="Void Transaction" onClose={() => { setShowVoid(null); setVoidError(''); }} footer={
          <><button className="btn btn-secondary" onClick={() => setShowVoid(null)}>Cancel</button><button className="btn btn-danger" onClick={handleVoid} disabled={!voidReason || !managerPin}>Confirm Void</button></>
        }>
          <p style={{ marginBottom: 16, fontSize: '0.9rem' }}>Voiding <strong>{showVoid.receiptNo}</strong> — {formatCurrency(showVoid.total)}</p>
          <div className="form-group"><label className="form-label">Reason for voiding *</label><input className="form-input" value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Enter reason" /></div>
          <div className="form-group"><label className="form-label">Manager PIN *</label><input className="form-input" type="password" maxLength={4} value={managerPin} onChange={e => { setManagerPin(e.target.value); setVoidError(''); }} placeholder="Enter manager PIN" /></div>
          {voidError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{voidError}</p>}
        </Modal>
      )}

      {showReceipt && <ReceiptModal transaction={showReceipt} onClose={() => setShowReceipt(null)} />}
    </div>
  );
}
