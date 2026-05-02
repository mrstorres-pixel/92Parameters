import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Search, AlertTriangle, History } from 'lucide-react';
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
  const [form, setForm] = useState(empty);
  const { currentStaff } = useAuthStore();
  const toast = useToast();

  useEffect(() => { load(); }, []);
  async function load() { setItems(await db.ingredients.toArray()); }

  function openNew() { setForm(empty); setEditing('new'); }
  function openEdit(item) { setForm({ ...item }); setEditing(item.id); }

  async function openHistory(item) {
    setHistoryItem(item);
    const logs = await db.auditLog.toArray();
    setHistoryLogs(logs.filter(log => log.entity === item.name).sort((a, b) => b.datetime - a.datetime));
  }

  async function save() {
    if (!form.name) return;
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
  }

  async function remove(id) {
    if (!confirm('Delete this ingredient?')) return;
    const item = await db.ingredients.get(id);
    await db.ingredients.delete(id);
    await db.productIngredients.where('ingredientId').equals(id).delete();
    await db.auditLog.add({ action: 'DELETE', entity: item?.name || 'Unknown', entityId: id, staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: Date.now(), details: `Deleted` });
    toast('Ingredient deleted', 'info'); load();
  }

  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
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
          <thead><tr><th>Name</th><th>Unit</th><th>In Stock</th><th>Status</th><th>Unit Cost</th><th>Stock Value</th><th>Threshold</th><th>Actions</th></tr></thead>
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
