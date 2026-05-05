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
  const [sortBy, setSortBy] = useState({ field: 'name', direction: 'asc' });
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [subCategoryFilter, setSubCategoryFilter] = useState('All');
  const { currentStaff } = useAuthStore();
  const isOwner = currentStaff?.role === 'owner';
  const toast = useToast();

  useEffect(() => { load(); }, []);
  async function load() { setProducts(await db.products.toArray()); }

  function openNew() { setForm(empty); setEditing('new'); }
  function openEdit(p) { setForm({ ...p }); setEditing(p.id); }

  async function save() {
    if (!form.name || form.price === '') { toast('Name and price are required', 'error'); return; }
    if (Number(form.price) < 0 || Number(form.cost || 0) < 0) { toast('Price and cost cannot be negative', 'error'); return; }
    try {
      const data = { ...form, price: Number(form.price), cost: Number(form.cost || 0) };
      if (editing === 'new') { await db.products.add(data); toast('Product added'); }
      else { await db.products.update(editing, data); toast('Product updated'); }
      setEditing(null); load();
    } catch {
      toast('Could not save product. Please check the connection.', 'error');
    }
  }

  async function remove(id) {
    if (!confirm('Delete this product?')) return;
    await db.products.delete(id);
    await db.productIngredients.where('productId').equals(id).delete();
    toast('Product deleted', 'info'); load();
  }

  const allSubCategories = Array.from(new Set(Object.values(CATEGORIES).flat())).sort((a, b) => a.localeCompare(b));

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

  const sorted = [...products].sort((a, b) => {
    const direction = sortBy.direction === 'asc' ? 1 : -1;
    const getValue = (product) => {
      if (sortBy.field === 'status') return product.isAvailable ? 'Available' : 'Unavailable';
      return product[sortBy.field] ?? '';
    };
    const av = getValue(a);
    const bv = getValue(b);
    if (typeof av === 'number' || typeof bv === 'number') return (Number(av || 0) - Number(bv || 0)) * direction;
    return String(av).localeCompare(String(bv)) * direction;
  });

  const filtered = sorted.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'All' || p.category === categoryFilter;
    const matchesSubCategory = subCategoryFilter === 'All' || p.subCategory === subCategoryFilter;
    return matchesSearch && matchesCategory && matchesSubCategory;
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
          <span className="text-sm text-muted">Category:</span>
          <select className="form-select" style={{ width: 150 }} value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setSubCategoryFilter('All'); }}>
            <option value="All">All Categories</option>
            {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="text-sm text-muted">Sub-category:</span>
          <select className="form-select" style={{ width: 210 }} value={subCategoryFilter} onChange={e => setSubCategoryFilter(e.target.value)}>
            <option value="All">All Sub-categories</option>
            {(categoryFilter === 'All' ? allSubCategories : CATEGORIES[categoryFilter] || []).map(sc => <option key={sc} value={sc}>{sc}</option>)}
          </select>
        </div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead><tr>
            <th><button className={`table-sort ${sortBy.field === 'name' ? 'active' : ''}`} onClick={() => toggleSort('name')}>Name <SortIcon field="name" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'category' ? 'active' : ''}`} onClick={() => toggleSort('category')}>Category <SortIcon field="category" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'subCategory' ? 'active' : ''}`} onClick={() => toggleSort('subCategory')}>Sub-Category <SortIcon field="subCategory" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'price' ? 'active' : ''}`} onClick={() => toggleSort('price')}>Price <SortIcon field="price" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'cost' ? 'active' : ''}`} onClick={() => toggleSort('cost')}>Cost <SortIcon field="cost" /></button></th>
            <th><button className={`table-sort ${sortBy.field === 'status' ? 'active' : ''}`} onClick={() => toggleSort('status')}>Status <SortIcon field="status" /></button></th>
            <th>Actions</th>
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
