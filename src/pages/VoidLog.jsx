import React, { useState, useEffect } from 'react';
import db from '../db/database';
import { formatCurrency, formatDateTime } from '../utils/formatters';

export default function VoidLog() {
  const [voids, setVoids] = useState([]);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() { setVoids((await db.voidLog.toArray()).sort((a,b) => b.datetime - a.datetime)); }

  return (
    <div className="animate-fade">
      <div className="page-header"><h2>Void Log</h2></div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Total Voids</div><div className="stat-value">{voids.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Voided Amount</div><div className="stat-value" style={{ color: 'var(--danger)' }}>{formatCurrency(voids.reduce((s,v) => s + (v.originalData?.total || 0), 0))}</div></div>
      </div>

      {voids.length === 0 ? (
        <div className="empty-state"><p>No voided transactions</p></div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead><tr><th>Void Date</th><th>Receipt #</th><th>Original Amount</th><th>Reason</th><th>Voided By</th></tr></thead>
            <tbody>
              {voids.map(v => (
                <React.Fragment key={v.id}>
                  <tr className="clickable" onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                    <td>{formatDateTime(v.datetime)}</td>
                    <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{v.receiptNo}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(v.originalData?.total || 0)}</td>
                    <td>{v.reason}</td>
                    <td>{v.staffName || 'Unknown'}</td>
                  </tr>
                  {expanded === v.id && v.originalData && (
                    <tr><td colSpan={5} style={{ padding: '16px', background: 'var(--bg-card)' }}>
                      <div style={{ fontSize: '0.85rem' }}>
                        <div className="form-row mb-16">
                          <div><span className="form-label">Original Date</span><div>{formatDateTime(v.originalData.datetime)}</div></div>
                          <div><span className="form-label">Order Type</span><div>{v.originalData.orderType}</div></div>
                          <div><span className="form-label">Payment</span><div>{v.originalData.paymentMethod}</div></div>
                          <div><span className="form-label">Staff</span><div>{v.originalData.staffName}</div></div>
                        </div>
                        <h4 style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>Items</h4>
                        {(v.originalData.items || []).map((item, i) => (
                          <div key={i} className="flex-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                            <span>{item.name} × {item.quantity}{item.discount > 0 ? ` (${item.discount}% off)` : ''}</span>
                            <span style={{ fontWeight: 600 }}>{formatCurrency(item.price * (1-(item.discount||0)/100) * item.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
