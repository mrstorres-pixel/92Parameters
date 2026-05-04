import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Search, AlertTriangle, History, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import { calcStockValue } from '../utils/calculations';
import { getStockStatusLabel, getStockStatus } from '../utils/formatters';

const empty = { name: '', unit: 'g', inStock: '', unitCost: '', lowThreshold: '' };

export default function Ingredients() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [historyItem, setHistoryItem] = useState(null);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [sortBy, setSortBy] = useState({ field: 'name', direction: 'asc' });
  const [form, setForm] = useState(empty);
  const { currentStaff } = useAuthStore();
  const toast = useToast();

  useEffect(() => { load(); }, []);
  async function load() { setItems(await db.ingredients.toArray()); }

  function openNew() { setForm(empty); setEditing('new'); }
  function openEdit(item) { setForm({ ...item }); setEditing(item.id); }

  async function openHistory(item) {
    setHistoryItem(item);
    const [logs, movements] = await Promise.all([
      db.auditLog.query({ filters: [{ field: 'entity', op: 'eq', value: item.name }], orderBy: 'datetime', ascending: false, limit: 100 }),
      db.ingredientMovements.query({ filters: [{ field: 'ingredientId', op: 'eq', value: item.id }], orderBy: 'datetime', ascending: false, limit: 100 }),
    ]);
    const movementLogs = movements.map(m => ({
      id: `movement-${m.id}`,
      action: m.type,
      datetime: m.datetime,
      staffName: m.staffName,
      details: `${m.type === 'RESTOCK' ? 'Restored' : 'Deducted'} ${m.quantity}${m.unit || ''}${m.receiptNo ? ` (${m.receiptNo})` : ''}; stock ${m.beforeStock}${m.unit || ''} -> ${m.afterStock}${m.unit || ''}`,
    }));
    setHistoryLogs([...logs, ...movementLogs].sort((a, b) => b.datetime - a.datetime));
  }

  async function save() {
    if (!form.name) { toast('Ingredient name is required', 'error'); return; }
    if ([form.inStock, form.unitCost, form.lowThreshold].some(v => Number(v || 0) < 0)) { toast('Stock, cost, and threshold cannot be negative', 'error'); return; }
    try {
      const data = { ...form, inStock: Number(form.inStock || 0), unitCost: Number(form.unitCost || 0), lowThreshold: Number(form.lowThreshold || 0) };
      if (editing === 'new') { 
        const id = await db.ingredients.add(data); 
        await db.auditLog.add({ action: 'CREATE', entity: data.name, entityId: id, staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: Date.now(), details: `Added with stock ${data.inStock}${data.unit}` });
        toast('Ingredient added'); 
      }
      else { 
        await db.ingredients.update(editing, data); 
        await db.auditLog.add({ action: 'UPDATE', entity: data.name, entityId: editing, staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: Date.now(), details: `Updated stock to ${data.inStock}${data.unit}` });
        toast('Ingredient updated'); 
      }
      setEditing(null); load();
    } catch {
      toast('Could not save ingredient. Please check the connection.', 'error');
    }
  }

  async function remove(id) {
    if (!confirm('Delete this ingredient?')) return;
    const item = await db.ingredients.get(id);
    await db.ingredients.delete(id);
    await db.productIngredients.where('ingredientId').equals(id).delete();
    await db.auditLog.add({ action: 'DELETE', entity: item?.name || 'Unknown', entityId: id, staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: Date.now(), details: `Deleted` });
    toast('Ingredient deleted', 'info'); load();
  }

  function toggleSort(field) {
    setSortBy(current => ({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  function SortIcon({ field }) {
    if (sortBy.field !== field) return <ArrowUpDown size={13} />;
    return sortBy.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />;
  }

  const filtered = [...items]
    .filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const direction = sortBy.direction === 'asc' ? 1 : -1;
      const getValue = (item) => {
        if (sortBy.field === 'stockValue') return calcStockValue(item.inStock, item.unitCost);
        if (sortBy.field === 'status') return getStockStatusLabel(item.inStock, item.lowThreshold || 0);
        return item[sortBy.field] ?? '';
      };
      const av = getValue(a);
      const bv = getValue(b);
      if (typeof av === 'number' || typeof bv === 'number') return (Number(av || 0) - Number(bv || 0)) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  const lowItems = items.filter(i => i.inStock <= (i.lowThreshold || 0));

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Ingredient Management</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Add Ingredient</button>
      </div>

      {lowItems.length > 0 && (
        <div className="alert-banner alert-danger mb-24">
          <AlertTriangle size={18} />
          <span><strong>Low Stock Alert:</strong> {lowItems.map(i => `${i.name} (${i.inStock}${i.unit})`).join(', ')}</span>
        </div>
      )}

      <div className="toolbar">
        <div className="search-bar"><Search size={16} /><input placeholder="Search ingredients..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead><tr>
            <th><button className={`table-sort ${sortBy.field === 'name' ? 'active' : ''}`} onClick={() => toggleSort('name')}>Name <SortIcon field="name" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'unit' ? 'active' : ''}`} onClick={() => toggleSort('unit')}>Unit <SortIcon field="unit" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'inStock' ? 'active' : ''}`} onClick={() => toggleSort('inStock')}>In Stock <SortIcon field="inStock" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'status' ? 'active' : ''}`} onClick={() => toggleSort('status')}>Status <SortIcon field="status" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'unitCost' ? 'active' : ''}`} onClick={() => toggleSort('unitCost')}>Unit Cost <SortIcon field="unitCost" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'stockValue' ? 'active' : ''}`} onClick={() => toggleSort('stockValue')}>Stock Value <SortIcon field="stockValue" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'lowThreshold' ? 'active' : ''}`} onClick={() => toggleSort('lowThreshold')}>Threshold <SortIcon field="lowThreshold" /></button></th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map(item => {
              const status = getStockStatus(item.inStock, item.lowThreshold || 0);
              const badgeClass = status === 'out' ? 'badge-danger' : status === 'low' ? 'badge-warning' : 'badge-success';
              return (
                <tr key={item.id} className="clickable" onClick={() => openHistory(item)}>
                  <td style={{ fontWeight: 500 }}>{item.name}</td>
                  <td>{item.unit}</td>
                  <td>{item.inStock} {item.unit}</td>
                  <td><span className={`badge ${badgeClass}`}>{getStockStatusLabel(item.inStock, item.lowThreshold || 0)}</span></td>
                  <td>{formatCurrency(item.unitCost)}</td>
                  <td>{formatCurrency(calcStockValue(item.inStock, item.unitCost))}</td>
                  <td>{item.lowThreshold || 0} {item.unit}</td>
                  <td>
                    <div className="flex gap-8">
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); openHistory(item); }} title="History"><History size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(item); }} title="Edit"><Edit2 size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); remove(item.id); }} title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <Modal title={editing === 'new' ? 'Add Ingredient' : 'Edit Ingredient'} onClose={() => setEditing(null)} footer={
          <><button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>
        }>
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Unit</label>
              <select className="form-select" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})}>
                <option value="g">Grams (g)</option><option value="ml">Milliliters (ml)</option><option value="pcs">Pieces (pcs)</option><option value="kg">Kilograms (kg)</option><option value="L">Liters (L)</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">In Stock</label><input className="form-input" type="number" value={form.inStock} onChange={e => setForm({...form, inStock: e.target.value})} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Unit Cost (₱)</label><input className="form-input" type="number" value={form.unitCost} onChange={e => setForm({...form, unitCost: e.target.value})} /></div>
            <div className="form-group"><label className="form-label">Low Stock Threshold</label><input className="form-input" type="number" value={form.lowThreshold} onChange={e => setForm({...form, lowThreshold: e.target.value})} /></div>
          </div>
        </Modal>
      )}

      {historyItem && (
        <Modal title={`${historyItem.name} History`} large onClose={() => setHistoryItem(null)} footer={
          <button className="btn btn-primary" onClick={() => setHistoryItem(null)}>Close</button>
        }>
          {historyLogs.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 20px' }}>
              <History size={40} />
              <p>No history recorded for this ingredient yet.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Date & Time</th><th>Action</th><th>Staff</th><th>Details</th></tr></thead>
                <tbody>
                  {historyLogs.map(log => {
                    const badgeClass = log.action === 'CREATE' || log.action === 'RESTOCK' ? 'badge-success' : log.action === 'UPDATE' ? 'badge-warning' : log.action === 'DEDUCT' || log.action === 'DELETE' ? 'badge-danger' : 'badge-neutral';
                    return (
                      <tr key={log.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.datetime)}</td>
                        <td><span className={`badge ${badgeClass}`}>{log.action}</span></td>
                        <td>{log.staffName || 'System'}</td>
                        <td style={{ color: 'var(--text-secondary)', maxWidth: 360 }}>{log.details}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
