import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, DollarSign, Clock, TrendingUp, AlertTriangle, ArrowUpRight } from 'lucide-react';
import db from '../db/database';
import { formatCurrency, formatTime } from '../utils/formatters';
import { calcCartTotal, calcItemTotal } from '../utils/calculations';

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ sales: 0, count: 0, avg: 0 });
  const [recent, setRecent] = useState([]);
  const [lowIngredients, setLowIngredients] = useState([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const today = new Date(); today.setHours(0,0,0,0);
    const txns = await db.transactions.where('datetime').above(today.getTime()).toArray();
    const valid = txns.filter(t => t.status !== 'void');
    const totalSales = valid.reduce((s, t) => s + (t.total || 0), 0);

    setStats({ sales: totalSales, count: valid.length, avg: valid.length ? totalSales / valid.length : 0 });
    setRecent(txns.sort((a,b) => b.datetime - a.datetime).slice(0, 5));

    const ings = await db.ingredients.toArray();
    setLowIngredients(ings.filter(i => i.inStock <= (i.lowThreshold || 0)));
  }

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Today's Overview</h2>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total Sales</div>
          <div className="stat-value">{formatCurrency(stats.sales)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Transactions</div>
          <div className="stat-value">{stats.count}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg. Ticket</div>
          <div className="stat-value">{formatCurrency(stats.avg)}</div>
        </div>
      </div>

      {lowIngredients.length > 0 && (
        <div className="alert-banner alert-warning mb-24">
          <AlertTriangle size={18} />
          <span><strong>{lowIngredients.length} ingredient{lowIngredients.length > 1 ? 's' : ''}</strong> running low: {lowIngredients.map(i => i.name).join(', ')}</span>
        </div>
      )}

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Quick Actions</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-primary btn-lg w-full" onClick={() => navigate('/pos')}>
              <ShoppingCart size={18} /> New Sale
            </button>
            <button className="btn btn-secondary w-full" onClick={() => navigate('/time-tracking')}>
              <Clock size={18} /> Time In / Out
            </button>
            <button className="btn btn-secondary w-full" onClick={() => navigate('/cash')}>
              <DollarSign size={18} /> Cash In / Out
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Transactions</span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/transactions')}>View All <ArrowUpRight size={14} /></button>
          </div>
          {recent.length === 0 ? (
            <div className="empty-state"><p>No transactions today</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {recent.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{t.receiptNo}</span>
                  <span style={{ fontWeight: 600 }}>{formatCurrency(t.total)}</span>
                  {t.status === 'void' && <span className="void-stamp">VOID</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
