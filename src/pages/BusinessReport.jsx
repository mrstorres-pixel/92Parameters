import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import db from '../db/database';
import { formatCurrency } from '../utils/formatters';
import { calcGrossProfit } from '../utils/calculations';
import { buildMerchandiseSummary, buildCashOutSummary, fetchReportRows } from '../utils/businessReport';
import { getDateRangeFilters } from '../utils/durability';
import { buildPaymentTotals, PAYMENT_METHODS, paymentMethodMatches } from '../utils/payments';

const COLORS = ['#d4982a', '#f59e0b', '#34d399', '#60a5fa', '#a78bfa', '#f87171'];

function toDateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getRangeBounds(range, customStart, customEnd, lookbackAmount, lookbackUnit) {
  const now = new Date();
  let start = new Date();
  let end = new Date(now);
  start.setHours(0,0,0,0);
  end.setHours(23,59,59,999);

  if (range === 'week') start.setDate(start.getDate() - 6);
  else if (range === 'month') start.setDate(start.getDate() - 29);
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
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState(toDateInputValue(new Date()));
  const [lookbackAmount, setLookbackAmount] = useState(8);
  const [lookbackUnit, setLookbackUnit] = useState('months');
  const [txns, setTxns] = useState([]);
  const [cashEntries, setCashEntries] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [reloadAttempt, setReloadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoadState('loading');
      const { start, end } = getRangeBounds(range, customStart, customEnd, lookbackAmount, lookbackUnit);
      if (start > end) {
        if (active) setLoadState('invalid');
        return;
      }
      try {
        const filters = getDateRangeFilters(start, end);
        const [all, cashOuts] = await Promise.all([
          fetchReportRows(db.transactions, filters),
          fetchReportRows(db.cashDrawer, [...filters, { field: 'type', op: 'eq', value: 'out' }]),
        ]);
        if (!active) return;
        setTxns(all);
        setCashEntries(cashOuts);
        setLoadState('ready');
      } catch (error) {
        console.error('Could not load business report:', error);
        if (active) setLoadState('error');
      }
    }
    load();
    return () => { active = false; };
  }, [range, customStart, customEnd, lookbackAmount, lookbackUnit, reloadAttempt]);

  const { start, end } = getRangeBounds(range, customStart, customEnd, lookbackAmount, lookbackUnit);

  const validAll = txns.filter(t => t.status !== 'void');
  const paymentMethods = ['All', ...PAYMENT_METHODS];
  const valid = validAll.filter(t => paymentMethodMatches(t, paymentFilter));
  const filteredStats = calcGrossProfit(valid);
  const totalSales = filteredStats.revenue;
  const avgTicket = valid.length ? totalSales / valid.length : 0;
  const { totalItems, categoryRows: tabRows, categoryData: catData, topProducts, categoryTotals } = buildMerchandiseSummary(valid);
  const { totalCashOut, netAfterCashOut } = buildCashOutSummary(validAll, cashEntries);

  // Payment breakdown
  const payRows = Object.entries(buildPaymentTotals(validAll)).map(([name, totals]) => ({ name, quantity: totals.quantity, value: totals.amount })).sort((a, b) => b.value - a.value);
  const payData = payRows.filter(row => row.value > 0).map(({ name, value }) => ({ name, value }));
  const payTotalQty = payRows.reduce((sum, row) => sum + row.quantity, 0);
  const payTotalAmount = payRows.reduce((sum, row) => sum + row.value, 0);

  // Hourly sales
  const hourMap = {};
  valid.forEach(t => { const h = new Date(t.datetime).getHours(); hourMap[h] = (hourMap[h] || 0) + Number(t.total || 0); });
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

      <div className="toolbar">
        <span className="text-sm text-muted">Payment method:</span>
        <select className="form-select" style={{ width: 190 }} value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}>
          {paymentMethods.map(method => <option key={method} value={method}>{method}</option>)}
        </select>
        <span className="text-sm text-muted">{paymentFilter === 'All' ? 'Showing all settlements' : `Showing ${paymentFilter} sales only`}</span>
      </div>

      <p className="text-sm text-muted mb-16">Report period: {start.toLocaleDateString()} to {end.toLocaleDateString()}</p>
      {loadState === 'loading' && <div className="card" role="status">Loading business report...</div>}
      {loadState === 'invalid' && <div className="alert-banner alert-warning" role="alert">Choose an end date on or after the start date.</div>}
      {loadState === 'error' && (
        <div className="alert-banner alert-warning" role="alert">
          <span>Could not load sales and cash-outs. Try again to get a complete report.</span>
          <button className="btn btn-secondary" onClick={() => setReloadAttempt(attempt => attempt + 1)}>Try again</button>
        </div>
      )}
      {loadState === 'ready' && <>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Total Sales</div><div className="stat-value">{formatCurrency(totalSales)}</div></div>
        <div className="stat-card"><div className="stat-label">Transactions</div><div className="stat-value">{valid.length}</div></div>
        <div className="stat-card"><div className="stat-label">Avg Ticket</div><div className="stat-value">{formatCurrency(avgTicket)}</div></div>
        <div className="stat-card"><div className="stat-label">Items Sold</div><div className="stat-value">{totalItems}</div></div>
        <div className="stat-card"><div className="stat-label">Cost of Goods</div><div className="stat-value">{formatCurrency(filteredStats.cost)}</div></div>
        <div className="stat-card"><div className="stat-label">Gross Profit</div><div className="stat-value" style={{ color: filteredStats.profit < 0 ? 'var(--danger)' : 'var(--success)' }}>{formatCurrency(filteredStats.profit)}</div></div>
        <div className="stat-card"><div className="stat-label">Total Cash Out</div><div className="stat-value" style={{ color: 'var(--danger)' }}>{formatCurrency(totalCashOut)}</div><div className="text-sm text-muted">All payment methods · selected period</div></div>
        <div className="stat-card"><div className="stat-label">Net after Cash-outs</div><div className="stat-value" style={{ color: netAfterCashOut < 0 ? 'var(--danger)' : 'var(--success)' }}>{formatCurrency(netAfterCashOut)}</div><div className="text-sm text-muted">All sales − total cash out</div></div>
      </div>

      <div className="alert-banner alert-info mb-24">
        <span>Net after cash-outs = sales across all payment methods − recorded cash-outs for this period. It is not net profit: cash-outs also include stock purchases and owner withdrawals. Cost of goods is shown separately and is not deducted again here.</span>
      </div>

      <div className="report-grid">
        <div className="card report-table-card">
          <div className="card-title mb-16">Sales Information</div>
          <table className="summary-table">
            <tbody>
              <tr><th>Total Sales</th><td>{formatCurrency(totalSales)}</td></tr>
              <tr><th>Total Cost</th><td>{formatCurrency(filteredStats.cost)}</td></tr>
              <tr><th>Gross Profit</th><td>{formatCurrency(filteredStats.profit)}</td></tr>
              <tr><th>Total Cash Out (all payment methods)</th><td>{formatCurrency(totalCashOut)}</td></tr>
              <tr><th>Net after Cash-outs (all payment methods)</th><td>{formatCurrency(netAfterCashOut)}</td></tr>
              <tr><th>Transactions</th><td>{valid.length}</td></tr>
              <tr><th>Items Sold</th><td>{totalItems}</td></tr>
              <tr><th>Average Ticket</th><td>{formatCurrency(avgTicket)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card report-table-card">
          <div className="card-title mb-16">Total Settlement by Payment Method</div>
          <table className="data-table compact-table mobile-card-table">
            <thead><tr><th>Method</th><th>Quantity</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {payRows.map(row => (
                <tr key={row.name}><td data-label="Method">{row.name}</td><td data-label="Quantity">{row.quantity}</td><td data-label="Amount" className="text-right">{formatCurrency(row.value)}</td></tr>
              ))}
              <tr><td data-label="Method" style={{ fontWeight: 700 }}>Total Settlement</td><td data-label="Quantity" style={{ fontWeight: 700 }}>{payTotalQty}</td><td data-label="Amount" className="text-right" style={{ fontWeight: 700 }}>{formatCurrency(payTotalAmount)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card report-table-card mb-16">
        <div className="card-title mb-16">Category Breakdown</div>
        <p className="text-sm text-muted mb-16">Packaging is excluded from items sold, top products, and category breakdowns. Its charges and costs remain in financial totals. Item sales include item adjustments; order discounts are reflected in Total Sales.</p>
        <table className="data-table compact-table mobile-card-table">
          <thead><tr><th>Category</th><th>Quantity Sold</th><th className="text-right">Item Sales</th><th className="text-right">Cost</th><th className="text-right">Item Profit</th></tr></thead>
          <tbody>
            {tabRows.map(row => (
              <tr key={row.name}>
                <td data-label="Category">{row.name}</td>
                <td data-label="Quantity Sold">{row.quantity}</td>
                <td data-label="Item Sales" className="text-right">{formatCurrency(row.grossSales)}</td>
                <td data-label="Cost" className="text-right">{formatCurrency(row.cost)}</td>
                <td data-label="Item Profit" className="text-right">{formatCurrency(row.netSales)}</td>
              </tr>
            ))}
            <tr>
              <td data-label="Category" style={{ fontWeight: 700 }}>Total</td>
              <td data-label="Quantity Sold" style={{ fontWeight: 700 }}>{totalItems}</td>
              <td data-label="Item Sales" className="text-right" style={{ fontWeight: 700 }}>{formatCurrency(categoryTotals.grossSales)}</td>
              <td data-label="Cost" className="text-right" style={{ fontWeight: 700 }}>{formatCurrency(categoryTotals.cost)}</td>
              <td data-label="Item Profit" className="text-right" style={{ fontWeight: 700 }}>{formatCurrency(categoryTotals.netSales)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="report-grid">
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

      <div className="report-grid">
        <div className="card">
          <div className="card-title mb-16">Top Products</div>
          {topProducts.length === 0 ? <p className="text-sm text-muted">No product sales in this selection.</p> : <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topProducts} layout="vertical"><XAxis type="number" tick={{ fill: '#7a6e5f', fontSize: 11 }} /><YAxis dataKey="name" type="category" width={120} tick={{ fill: '#b8a692', fontSize: 11 }} /><Tooltip {...tooltipStyle} /><Bar dataKey="qty" fill="#34d399" radius={[0,4,4,0]} /></BarChart>
          </ResponsiveContainer>}
        </div>
        <div className="card">
          <div className="card-title mb-16">Sales by Category</div>
          {catData.length === 0 ? <p className="text-sm text-muted">No category sales in this selection.</p> : <ResponsiveContainer width="100%" height={220}>
            <PieChart><Pie data={catData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({name, percent}) => `${name} ${(percent*100).toFixed(0)}%`}>
              {catData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie><Tooltip {...tooltipStyle} /></PieChart>
          </ResponsiveContainer>}
        </div>
      </div>
      </>}
    </div>
  );
}
