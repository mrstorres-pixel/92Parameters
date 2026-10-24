import React, { useState, useEffect, useRef } from 'react';
import { ArrowUpCircle, ArrowDownCircle, BarChart3, CalendarDays, Search } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import { sumPaymentMethod } from '../utils/payments';
import CashOutCategoryField from '../components/cash/CashOutCategoryField';
import { getCashOutCategory, cashOutCategoryLabel, suggestCashOutCategory, cashCategorySaveError } from '../utils/cashOutCategories';
import { fetchReportRows } from '../utils/businessReport';

function toDateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toMonthInputValue(date = new Date()) {
  return toDateInputValue(date).slice(0, 7);
}

function getMonthBounds(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 0, 23, 59, 59, 999).getTime();
  return { start, end };
}

export default function CashManagement() {
  const [entries, setEntries] = useState([]);
  const [cashSales, setCashSales] = useState([]);
  const [monthlyEntries, setMonthlyEntries] = useState([]);
  const [showForm, setShowForm] = useState(null); // 'in' | 'out'
  const [showMonthlyReport, setShowMonthlyReport] = useState(false);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState(null);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [reviewEntry, setReviewEntry] = useState(null);
  const [reviewCategory, setReviewCategory] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadState, setLoadState] = useState('loading');
  const [monthlyState, setMonthlyState] = useState('loading');
  const dailyRequest = useRef(0);
  const monthlyRequest = useRef(0);
  const [filterDate, setFilterDate] = useState(toDateInputValue(new Date()));
  const [reportMonth, setReportMonth] = useState(toMonthInputValue());
  const [reportSearch, setReportSearch] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const currentStaff = useAuthStore(s => s.currentStaff);
  const toast = useToast();
  const canReviewCategories = currentStaff?.role === 'owner';

  useEffect(() => { load(); return () => { dailyRequest.current += 1; }; }, [filterDate]);
  useEffect(() => { loadMonthlyReport(); return () => { monthlyRequest.current += 1; }; }, [reportMonth]);

  async function load() {
    const request = ++dailyRequest.current;
    setLoadState('loading');
    const start = new Date(`${filterDate}T00:00:00`).getTime();
    const end = new Date(`${filterDate}T23:59:59.999`).getTime();
    try {
      const [drawerRows, saleRows] = await Promise.all([
        fetchReportRows(db.cashDrawer, [
          { field: 'datetime', op: 'gte', value: start },
          { field: 'datetime', op: 'lte', value: end },
        ]),
        fetchReportRows(db.transactions, [
          { field: 'datetime', op: 'gte', value: start },
          { field: 'datetime', op: 'lte', value: end },
          { field: 'status', op: 'eq', value: 'completed' },
        ]),
      ]);
      if (request !== dailyRequest.current) return;
      setEntries(drawerRows.sort((a, b) => b.datetime - a.datetime));
      setCashSales(saleRows);
      setLoadState('ready');
    } catch (error) {
      console.error('Could not load cash drawer:', error);
      if (request === dailyRequest.current) setLoadState('error');
    }
  }

  async function loadMonthlyReport() {
    const request = ++monthlyRequest.current;
    setMonthlyState('loading');
    const { start, end } = getMonthBounds(reportMonth);
    try {
      const rows = await fetchReportRows(db.cashDrawer, [
        { field: 'datetime', op: 'gte', value: start },
        { field: 'datetime', op: 'lte', value: end },
      ]);
      if (request !== monthlyRequest.current) return;
      setMonthlyEntries(rows.sort((a, b) => b.datetime - a.datetime));
      setMonthlyState('ready');
    } catch (error) {
      console.error('Could not load monthly cash report:', error);
      if (request === monthlyRequest.current) setMonthlyState('error');
    }
  }

  function openForm(type) {
    setAmount(''); setNotes(''); setCategory(null); setCategoryTouched(false); setShowForm(type);
  }

  function changeNotes(value) {
    setNotes(value);
    if (!categoryTouched) setCategory(suggestCashOutCategory(value));
  }

  function openCategoryReview(entry) {
    setReviewEntry(entry);
    setReviewCategory(getCashOutCategory(entry) || suggestCashOutCategory(entry.notes));
  }

  async function saveCategory() {
    if (!reviewEntry || saving || !canReviewCategories) return;
    setSaving(true);
    try {
      await db.cashDrawer.setCategory(reviewEntry.id, reviewCategory);
      toast('Cash-out category saved');
      setReviewEntry(null);
      await Promise.all([load(), loadMonthlyReport()]);
    } catch (error) {
      toast(cashCategorySaveError(error), 'error');
    } finally { setSaving(false); }
  }

  async function save() {
    if (saving) return;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) { toast('Enter a valid amount greater than zero.', 'error'); return; }
    setSaving(true);
    try {
      await db.cashDrawer.add({
        type: showForm, amount: Number(amount), notes,
        ...(showForm === 'out' && category ? { category } : {}),
        staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: Date.now(),
      });
      toast(`Cash ${showForm} recorded`);
      setShowForm(null); setAmount(''); setNotes(''); setCategory(null);
      await Promise.all([load(), loadMonthlyReport()]);
    } catch (error) {
      toast(showForm === 'out' ? cashCategorySaveError(error) : 'Could not record cash in. Please try again.', 'error');
    } finally { setSaving(false); }
  }

  const totalIn = entries.filter(e => e.type === 'in').reduce((s,e) => s + Number(e.amount || 0), 0);
  const totalOut = entries.filter(e => e.type === 'out').reduce((s,e) => s + Number(e.amount || 0), 0);
  const cashSalesTotal = cashSales.reduce((sum, sale) => sum + sumPaymentMethod(sale, 'Cash'), 0);
  const expectedCash = totalIn + cashSalesTotal - totalOut;
  const reportQuery = reportSearch.trim().toLowerCase();
  const filteredMonthlyEntries = monthlyEntries.filter(entry => {
    if (reviewOnly && (entry.type !== 'out' || getCashOutCategory(entry))) return false;
    if (!reportQuery) return true;
    return [
      entry.notes,
      entry.staffName,
      entry.type === 'in' ? 'cash in' : 'cash out',
      cashOutCategoryLabel(entry),
      formatCurrency(entry.amount),
    ].some(value => String(value || '').toLowerCase().includes(reportQuery));
  });
  const monthlyIn = filteredMonthlyEntries.filter(e => e.type === 'in').reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const monthlyOut = filteredMonthlyEntries.filter(e => e.type === 'out').reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const monthlyNet = monthlyIn - monthlyOut;

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Cash Drawer</h2>
        <div className="flex gap-8">
          <input className="form-input" type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ width: 160 }} />
          <button className="btn btn-secondary" onClick={() => setShowMonthlyReport(true)}><BarChart3 size={16} /> Monthly Reports</button>
          <button className="btn btn-success" onClick={() => openForm('in')}><ArrowUpCircle size={16} /> Cash In</button>
          <button className="btn btn-danger" onClick={() => openForm('out')}><ArrowDownCircle size={16} /> Cash Out</button>
        </div>
      </div>

      {loadState === 'loading' && <div className="card" role="status">Loading cash drawer...</div>}
      {loadState === 'error' && <div className="alert-banner alert-warning" role="alert"><span>Could not load the cash drawer.</span><button className="btn btn-secondary" onClick={load}>Try again</button></div>}
      {loadState === 'ready' && <>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Cash Sales</div><div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(cashSalesTotal)}</div></div>
        <div className="stat-card"><div className="stat-label">Manual Cash In</div><div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(totalIn)}</div></div>
        <div className="stat-card"><div className="stat-label">Manual Cash Out</div><div className="stat-value" style={{ color: 'var(--danger)' }}>{formatCurrency(totalOut)}</div></div>
        <div className="stat-card"><div className="stat-label">Expected Cash</div><div className="stat-value">{formatCurrency(expectedCash)}</div></div>
      </div>

      <div className="alert-banner alert-info mb-24">
        <span>Expected Cash = cash portions of completed sales + manual cash in - manual cash out. Split payments only add the cash portion to the drawer.</span>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Date/Time</th><th>Type</th><th>Amount</th><th>Category</th><th>Notes</th><th>Staff</th></tr></thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td>{formatDateTime(e.datetime)}</td>
                <td><span className={`badge ${e.type === 'in' ? 'badge-success' : 'badge-danger'}`}>{e.type === 'in' ? 'Cash In' : 'Cash Out'}</span></td>
                <td style={{ fontWeight: 600 }}>{formatCurrency(e.amount)}</td>
                <td>{e.type === 'out' ? <><span>{cashOutCategoryLabel(e)}</span>{canReviewCategories && <button className="btn btn-ghost btn-sm" onClick={() => openCategoryReview(e)}>Review category</button>}</> : '-'}</td>
                <td>{e.notes || '—'}</td>
                <td>{e.staffName || 'Unknown'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}

      {showMonthlyReport && (
        <Modal title="Monthly Cash Movement Report" large onClose={() => setShowMonthlyReport(false)} footer={
          <button className="btn btn-primary" onClick={() => setShowMonthlyReport(false)}>Done</button>
        }>
        <div style={{ marginBottom: 16 }}>
          <div>
            <p className="text-muted text-sm">Review cash-out categories here to improve the operating profit report. Notes and original cash amounts stay unchanged.</p>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <div className="search-bar" style={{ background: 'var(--bg-card)' }}>
              <Search size={16} />
              <input placeholder="Search notes, staff, type..." value={reportSearch} onChange={e => setReportSearch(e.target.value)} />
            </div>
            <div className="search-bar" style={{ background: 'var(--bg-card)' }}>
              <CalendarDays size={16} />
              <input type="month" value={reportMonth} onChange={e => setReportMonth(e.target.value)} />
            </div>
          </div>
          <label className="text-sm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)} /> Only cash-outs needing category review
          </label>
        </div>

        {monthlyState === 'loading' && <div role="status">Loading monthly cash report...</div>}
        {monthlyState === 'error' && <div className="alert-banner alert-warning" role="alert"><span>Could not load the monthly report.</span><button className="btn btn-secondary" onClick={loadMonthlyReport}>Try again</button></div>}
        {monthlyState === 'ready' && <>
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-label">Report Cash In</div><div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(monthlyIn)}</div></div>
          <div className="stat-card"><div className="stat-label">Report Cash Out</div><div className="stat-value" style={{ color: 'var(--danger)' }}>{formatCurrency(monthlyOut)}</div></div>
          <div className="stat-card"><div className="stat-label">Net Movement</div><div className="stat-value">{formatCurrency(monthlyNet)}</div></div>
          <div className="stat-card"><div className="stat-label">Matching Records</div><div className="stat-value">{filteredMonthlyEntries.length}</div></div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead><tr><th>Date/Time</th><th>Type</th><th>Amount</th><th>Category</th><th>Notes</th><th>Staff</th></tr></thead>
            <tbody>
              {filteredMonthlyEntries.map(e => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.datetime)}</td>
                  <td><span className={`badge ${e.type === 'in' ? 'badge-success' : 'badge-danger'}`}>{e.type === 'in' ? 'Cash In' : 'Cash Out'}</span></td>
                  <td style={{ fontWeight: 600 }}>{formatCurrency(e.amount)}</td>
                  <td>{e.type === 'out' ? <><span>{cashOutCategoryLabel(e)}</span>{canReviewCategories && <button className="btn btn-ghost btn-sm" onClick={() => openCategoryReview(e)}>Review category</button>}</> : '-'}</td>
                  <td>{e.notes || '—'}</td>
                  <td>{e.staffName || 'Unknown'}</td>
                </tr>
              ))}
              {filteredMonthlyEntries.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted" style={{ padding: 24 }}>No cash drawer records match this report.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </>}
        </Modal>
      )}

      {showForm && (
        <Modal title={showForm === 'in' ? 'Cash In' : 'Cash Out'} onClose={() => { if (!saving) setShowForm(null); }} footer={
          <><button className="btn btn-secondary" disabled={saving} onClick={() => setShowForm(null)}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button></>
        }>
          <div className="form-group"><label className="form-label">Amount (₱)</label><input className="form-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
          <div className="form-group"><label className="form-label" htmlFor="cash-notes">Notes</label><input id="cash-notes" className="form-input" value={notes} disabled={saving} onChange={e => changeNotes(e.target.value)} placeholder="Reason for cash movement" /></div>
          {showForm === 'out' && <CashOutCategoryField value={category} onChange={value => { setCategory(value); setCategoryTouched(true); }} suggested={!categoryTouched && Boolean(category)} disabled={saving} />}
          <div className="form-group"><label className="form-label">Staff</label><div className="form-input" style={{ background: 'var(--bg-card)' }}>{currentStaff?.name || 'Not logged in'}</div></div>
        </Modal>
      )}

      {reviewEntry && (
        <Modal title="Review Cash-out Category" onClose={() => { if (!saving) setReviewEntry(null); }} footer={
          <><button className="btn btn-secondary" disabled={saving} onClick={() => setReviewEntry(null)}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={saveCategory}>{saving ? 'Saving...' : 'Save category'}</button></>
        }>
          <p className="mb-16">{formatDateTime(reviewEntry.datetime)} · {formatCurrency(reviewEntry.amount)}</p>
          <p className="mb-16" style={{ whiteSpace: 'pre-wrap' }}>{reviewEntry.notes || 'No notes recorded.'}</p>
          <CashOutCategoryField value={reviewCategory} onChange={setReviewCategory} suggested={!getCashOutCategory(reviewEntry) && Boolean(reviewCategory) && reviewCategory === suggestCashOutCategory(reviewEntry.notes)} disabled={saving} />
          <p className="text-sm text-muted">For mixed expenses, leave this record unclassified until the amounts can be separated. Only the category is updated here.</p>
        </Modal>
      )}
    </div>
  );
}
