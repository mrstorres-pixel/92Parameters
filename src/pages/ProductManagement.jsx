import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Search, Link as LinkIcon } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import RecipeModal from '../components/products/RecipeModal';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { formatCurrency } from '../utils/formatters';

const empty = { name: '', category: 'Drinks', price: '', cost: '', isAvailable: true };

export default function ProductManagement() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [recipeProduct, setRecipeProduct] = useState(null);
  const [form, setForm] = useState(empty);
  const { currentStaff } = useAuthStore();
  const isOwner = currentStaff?.role === 'owner';
  const toast = useToast();

  useEffect(() => { load(); }, []);
  async function load() { setProducts(await db.products.toArray()); }

  function openNew() { setForm(empty); setEditing('new'); }
  function openEdit(p) { setForm({ ...p }); setEditing(p.id); }

  async function save() {
    if (!form.name || !form.price) return;
    const data = { ...form, price: Number(form.price), cost: Number(form.cost || 0) };
    if (editing === 'new') { await db.products.add(data); toast('Product added'); }
    else { await db.products.update(editing, data); toast('Product updated'); }
    setEditing(null); load();
  }

  async function remove(id) {
    if (!confirm('Delete this product?')) return;
    await db.products.delete(id);
    await db.productIngredients.where('productId').equals(id).delete();
    toast('Product deleted', 'info'); load();
  }

  const filtered = products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Product Management</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Add Product</button>
      </div>
      <div className="toolbar">
        <div className="search-bar"><Search size={16} /><input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Cost</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td><span className="badge badge-info">{p.category}</span></td>
                <td>{formatCurrency(p.price)}</td>
                <td>{formatCurrency(p.cost)}</td>
                <td><span className={`badge ${p.isAvailable ? 'badge-success' : 'badge-danger'}`}>{p.isAvailable ? 'Available' : 'Unavailable'}</span></td>
                <td>
                  <div className="flex gap-8">
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setRecipeProduct(p)} title="Manage Recipe"><LinkIcon size={14} /></button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEdit(p)} title="Edit"><Edit2 size={14} /></button>
                    {isOwner && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(p.id)} title="Delete"><Trash2 size={14} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <Modal title={editing === 'new' ? 'Add Product' : 'Edit Product'} onClose={() => setEditing(null)} footer={
          <><button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>
        }>
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Category</label>
            <select className="form-select" value={form.category} onChange={e => setForm({...form, category: e.target.value})}><option>Drinks</option><option>Food</option></select>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Price (₱)</label><input className="form-input" type="number" value={form.price} onChange={e => setForm({...form, price: e.target.value})} /></div>
            <div className="form-group"><label className="form-label">Cost (₱)</label><input className="form-input" type="number" value={form.cost} onChange={e => setForm({...form, cost: e.target.value})} /></div>
          </div>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.isAvailable} onChange={e => setForm({...form, isAvailable: e.target.checked})} /> Available for sale
            </label>
          </div>
        </Modal>
      )}

      {recipeProduct && (
        <RecipeModal product={recipeProduct} onClose={() => setRecipeProduct(null)} />
      )}
    </div>
  );
}
