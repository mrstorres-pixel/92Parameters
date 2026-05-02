import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Search, Link as LinkIcon, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import RecipeModal from '../components/products/RecipeModal';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { formatCurrency } from '../utils/formatters';
import { CATEGORIES } from '../config/categories';

const empty = { name: '', category: 'Drinks', subCategory: '', price: '', cost: '', isAvailable: true, emoji: '☕' };

export default function ProductManagement() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [recipeProduct, setRecipeProduct] = useState(null);
  const [form, setForm] = useState(empty);
  const [sortBy, setSortBy] = useState('name-asc');
  const [subCategoryFilter, setSubCategoryFilter] = useState('All');
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

  const allSubCategories = Array.from(new Set(Object.values(CATEGORIES).flat())).sort((a, b) => a.localeCompare(b));

  function toggleSort(field) {
    setSortBy(current => {
      if (field === 'name') return current === 'name-asc' ? 'name-desc' : 'name-asc';
      if (field === 'price') return current === 'price-asc' ? 'price-desc' : 'price-asc';
      return current;
    });
  }

  function SortIcon({ field }) {
    const active = sortBy.startsWith(field);
    if (!active) return <ArrowUpDown size={13} />;
    return sortBy.endsWith('asc') ? <ArrowUp size={13} /> : <ArrowDown size={13} />;
  }

  const sorted = [...products].sort((a, b) => {
    if (sortBy === 'name-asc') return a.name.localeCompare(b.name);
    if (sortBy === 'name-desc') return b.name.localeCompare(a.name);
    if (sortBy === 'price-asc') return a.price - b.price;
    if (sortBy === 'price-desc') return b.price - a.price;
    if (sortBy === 'category') return a.category.localeCompare(b.category);
    return 0;
  });

  const filtered = sorted.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesSubCategory = subCategoryFilter === 'All' || p.subCategory === subCategoryFilter;
    return matchesSearch && matchesSubCategory;
  });

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Product Management</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Add Product</button>
      </div>
      <div className="toolbar">
        <div className="search-bar"><Search size={16} /><input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="flex gap-8 items-center" style={{ marginLeft: 'auto' }}>
          <span className="text-sm text-muted">Sub-category:</span>
          <select className="form-select" style={{ width: 210 }} value={subCategoryFilter} onChange={e => setSubCategoryFilter(e.target.value)}>
            <option value="All">All Sub-categories</option>
            {allSubCategories.map(sc => <option key={sc} value={sc}>{sc}</option>)}
          </select>
        </div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead><tr>
            <th><button className={`table-sort ${sortBy.startsWith('name') ? 'active' : ''}`} onClick={() => toggleSort('name')}>Name <SortIcon field="name" /></button></th>
            <th>Category</th><th>Sub-Category</th>
            <th><button className={`table-sort ${sortBy.startsWith('price') ? 'active' : ''}`} onClick={() => toggleSort('price')}>Price <SortIcon field="price" /></button></th>
            <th>Cost</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500 }}>
                  <span style={{ marginRight: 8, fontSize: '1.2rem' }}>{p.emoji || '☕'}</span>
                  {p.name}
                </td>
                <td><span className="badge badge-info">{p.category}</span></td>
                <td><span className="badge badge-neutral">{p.subCategory || '—'}</span></td>
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
          <div className="form-row">
            <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="form-group">
              <label className="form-label">Emoji (1 max)</label>
              <input 
                className="form-input" 
                value={form.emoji} 
                onChange={e => {
                  const val = e.target.value;
                  if (Array.from(val).length <= 1) {
                    setForm({...form, emoji: val});
                  }
                }} 
                placeholder="☕" 
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={e => setForm({...form, category: e.target.value, subCategory: ''})}>
                {Object.keys(CATEGORIES).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Sub-Category</label>
              <select className="form-select" value={form.subCategory} onChange={e => setForm({...form, subCategory: e.target.value})}>
                <option value="">Select Sub-Category</option>
                {CATEGORIES[form.category]?.map(sc => <option key={sc}>{sc}</option>)}
              </select>
            </div>
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
