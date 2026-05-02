import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import db from '../db/database';
import { formatCurrency } from '../utils/formatters';
import { calcGrossProfit } from '../utils/calculations';
import { getDateRangeFilters } from '../utils/durability';

const COLORS = ['#d4982a', '#f59e0b', '#34d399', '#60a5fa', '#a78bfa', '#f87171'];

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function getRangeBounds(range, customStart, customEnd, lookbackAmount, lookbackUnit) {
  const now = new Date();
  let start = new Date();
  let end = new Date(now);
  start.setHours(0,0,0,0);
  end.setHours(23,59,59,999);

  if (range === 'week') start.setDate(start.getDate() - 7);
  else if (range === 'month') start.setMonth(start.getMonth() - 1);
  else if (range === 'year') start.setFullYear(start.getFullYear() - 1);
  else if (range === 'lookback') {
    const amount = Math.max(1, Number(lookbackAmount || 1));
    if (lookbackUnit === 'years') start.setFullYear(start.getFullYear() - amount);
    else if (lookbackUnit === 'months') start.setMonth(start.getMonth() - amount);
    else start.setDate(start.getDate() - amount);
  } else if (range === 'custom') {
    start = customStart ? new Date(`${customStart}T00:00:00`) : new Date(0);
    end = customEnd ? new Date(`${customEnd}T23:59:59.999`) : new Date(now);
  } else if (range === 'all') {
    start = new Date(0);
  }

  return { start, end };
}

export default function BusinessReport() {
  const [range, setRange] = useState('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState(toDateInputValue(new Date()));
  const [lookbackAmount, setLookbackAmount] = useState(8);
  const [lookbackUnit, setLookbackUnit] = useState('months');
  const [txns, setTxns] = useState([]);
  const [stats, setStats] = useState({ revenue: 0, cost: 0, profit: 0 });

  useEffect(() => { load(); }, [range, customStart, customEnd, lookbackAmount, lookbackUnit]);

  async function load() {
    const { start, end } = getRangeBounds(range, customStart, customEnd, lookbackAmount, lookbackUnit);
    const all = await db.transactions.query({
      filters: getDateRangeFilters(start, end),
      orderBy: 'datetime',
      ascending: true,
      limit: 5000,
    });
    setTxns(all);
    setStats(calcGrossProfit(all));
  }

  const { start, end } = getRangeBounds(range, customStart, customEnd, lookbackAmount, lookbackUnit);

  const valid = txns.filter(t => t.status !== 'void');
  const totalSales = valid.reduce((s,t) => s + (t.total || 0), 0);
  const avgTicket = valid.length ? totalSales / valid.length : 0;
  const totalItems = valid.reduce((s,t) => s + (t.items || []).reduce((a,i) => a + i.quantity, 0), 0);

  // Sales by category
  const catMap = {};
  valid.forEach(t => (t.items||[]).forEach(i => {
    const cat = i.category || 'Other';
    catMap[cat] = (catMap[cat] || 0) + (i.price * (1 - (i.discount||0)/100) * i.quantity);
  }));
  const catData = Object.entries(catMap).map(([name, value]) => ({ name, value: Math.round(value) }));

  // Payment breakdown
  const payMap = {};
  valid.forEach(t => { payMap[t.paymentMethod] = (payMap[t.paymentMethod] || 0) + t.total; });
  const payData = Object.entries(payMap).map(([name, value]) => ({ name, value: Math.round(value) }));

  // Top products
  const prodMap = {};
  valid.forEach(t => (t.items||[]).forEach(i => {
    prodMap[i.name] = (prodMap[i.name] || 0) + i.quantity;
  }));
  const topProducts = Object.entries(prodMap).map(([name, qty]) => ({ name, qty })).sort((a,b) => b.qty - a.qty).slice(0, 8);

  // Hourly sales
  const hourMap = {};
  valid.forEach(t => { const h = new Date(t.datetime).getHours(); hourMap[h] = (hourMap[h] || 0) + t.total; });
  const hourData = Array.from({length: 24}, (_, h) => ({ hour: `${h}:00`, sales: Math.round(hourMap[h] || 0) })).filter(d => d.sales > 0);

  const tooltipStyle = { contentStyle: { background: '#231f19', border: '1px solid #3a332a', borderRadius: 8, color: '#f5e6d0', fontSize: '0.8rem' } };

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Business Report</h2>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {[['today','Today'],['week','7 Days'],['month','30 Days'],['year','Last Year'],['lookback','Look Back'],['custom','Custom'],['all','All Time']].map(([k,l]) => (
            <button key={k} className={`tab ${range === k ? 'active' : ''}`} onClick={() => setRange(k)}>{l}</button>
          ))}
        </div>
      </div>

      {(range === 'lookback' || range === 'custom') && (
        <div className="toolbar">
          {range === 'lookback' && (
            <>
              <input className="form-input" style={{ width: 100 }} type="number" min="1" value={lookbackAmount} onChange={e => setLookbackAmount(e.target.value)} />
              <select className="form-select" style={{ width: 140 }} value={lookbackUnit} onChange={e => setLookbackUnit(e.target.value)}>
                <option value="days">Days ago</option>
                <option value="months">Months ago</option>
                <option value="years">Years ago</option>
              </select>
            </>
          )}
          {range === 'custom' && (
            <>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">From</label><input className="form-input" type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} /></div>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">To</label><input className="form-input" type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></div>
            </>
          )}
          <span className="text-sm text-muted">Showing {start.toLocaleDateString()} to {end.toLocaleDateString()}</span>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Total Sales</div><div className="stat-value">{formatCurrency(totalSales)}</div></div>
        <div className="stat-card"><div className="stat-label">Transactions</div><div className="stat-value">{valid.length}</div></div>
        <div className="stat-card"><div className="stat-label">Avg Ticket</div><div className="stat-value">{formatCurrency(avgTicket)}</div></div>
        <div className="stat-card"><div className="stat-label">Items Sold</div><div className="stat-value">{totalItems}</div></div>
        <div className="stat-card"><div className="stat-label">Cost of Goods</div><div className="stat-value">{formatCurrency(stats.cost)}</div></div>
        <div className="stat-card"><div className="stat-label">Gross Profit</div><div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(stats.profit)}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-title mb-16">Hourly Sales</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourData}><XAxis dataKey="hour" tick={{ fill: '#7a6e5f', fontSize: 11 }} /><YAxis tick={{ fill: '#7a6e5f', fontSize: 11 }} /><Tooltip {...tooltipStyle} /><Bar dataKey="sales" fill="#d4982a" radius={[4,4,0,0]} /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="card-title mb-16">Payment Methods</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart><Pie data={payData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({name, percent}) => `${name} ${(percent*100).toFixed(0)}%`}>
              {payData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie><Tooltip {...tooltipStyle} /></PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-title mb-16">Top Products</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topProducts} layout="vertical"><XAxis type="number" tick={{ fill: '#7a6e5f', fontSize: 11 }} /><YAxis dataKey="name" type="category" width={120} tick={{ fill: '#b8a692', fontSize: 11 }} /><Tooltip {...tooltipStyle} /><Bar dataKey="qty" fill="#34d399" radius={[0,4,4,0]} /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="card-title mb-16">Sales by Category</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart><Pie data={catData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({name, percent}) => `${name} ${(percent*100).toFixed(0)}%`}>
              {catData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie><Tooltip {...tooltipStyle} /></PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
