import React, { useState, useEffect } from 'react';
import { Trash2, Plus } from 'lucide-react';
import db from '../../db/database';
import Modal from '../common/Modal';
import { useToast } from '../common/Toast';

export default function RecipeModal({ product, onClose }) {
  const [ingredients, setIngredients] = useState([]);
  const [inventory, setInventory] = useState([]);
  
  const [linkedIngredients, setLinkedIngredients] = useState([]);
  const [linkedInventory, setLinkedInventory] = useState([]);

  // Form states
  const [ingForm, setIngForm] = useState({ id: '', qty: '' });
  const [invForm, setInvForm] = useState({ id: '', qty: '' });
  
  const toast = useToast();

  useEffect(() => {
    loadOptions();
    loadLinks();
  }, [product.id]);

  async function loadOptions() {
    setIngredients(await db.ingredients.toArray());
    setInventory(await db.inventory.toArray());
  }

  async function loadLinks() {
    const pIng = await db.productIngredients.where('productId').equals(product.id).toArray();
    const pInv = await db.productInventory.where('productId').equals(product.id).toArray();
    
    // Enrich with names
    for (const item of pIng) {
      const ing = await db.ingredients.get(item.ingredientId);
      item.name = ing ? ing.name : 'Unknown';
      item.unit = ing ? ing.unit : '';
    }
    for (const item of pInv) {
      const inv = await db.inventory.get(item.inventoryId);
      item.name = inv ? inv.name : 'Unknown';
    }
    
    setLinkedIngredients(pIng);
    setLinkedInventory(pInv);
  }

  async function addIngredient() {
    if (!ingForm.id || !ingForm.qty || ingForm.qty <= 0) return;
    await db.productIngredients.add({
      productId: product.id,
      ingredientId: Number(ingForm.id),
      quantity: Number(ingForm.qty)
    });
    toast('Ingredient linked');
    setIngForm({ id: '', qty: '' });
    loadLinks();
  }

  async function addInventory() {
    if (!invForm.id || !invForm.qty || invForm.qty <= 0) return;
    await db.productInventory.add({
      productId: product.id,
      inventoryId: Number(invForm.id),
      quantity: Number(invForm.qty)
    });
    toast('Inventory linked');
    setInvForm({ id: '', qty: '' });
    loadLinks();
  }

  async function removeIngredient(id) {
    await db.productIngredients.delete(id);
    toast('Link removed', 'info');
    loadLinks();
  }

  async function removeInventory(id) {
    await db.productInventory.delete(id);
    toast('Link removed', 'info');
    loadLinks();
  }

  return (
    <Modal title={`Recipe: ${product.name}`} large onClose={onClose} footer={
      <button className="btn btn-primary" onClick={onClose}>Close</button>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Ingredients Section */}
        <div>
          <h3 style={{ fontSize: '1.1rem', marginBottom: 12, color: 'var(--accent)' }}>Raw Ingredients</h3>
          
          <div className="table-container" style={{ marginBottom: 16 }}>
            <table className="data-table">
              <thead><tr><th>Ingredient</th><th>Qty</th><th></th></tr></thead>
              <tbody>
                {linkedIngredients.length === 0 && <tr><td colSpan={3} className="text-muted text-sm text-center">No ingredients linked</td></tr>}
                {linkedIngredients.map(item => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.quantity}{item.unit}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeIngredient(item.id)}><Trash2 size={14} color="var(--danger)"/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Ingredient</label>
              <select className="form-select" value={ingForm.id} onChange={e => setIngForm({...ingForm, id: e.target.value})}>
                <option value="">Select...</option>
                {ingredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Qty</label>
              <input type="number" className="form-input" value={ingForm.qty} onChange={e => setIngForm({...ingForm, qty: e.target.value})} />
            </div>
            <div className="form-group">
              <button className="btn btn-secondary" onClick={addIngredient} disabled={!ingForm.id || !ingForm.qty}><Plus size={16}/></button>
            </div>
          </div>
        </div>

        {/* Inventory Section */}
        <div>
          <h3 style={{ fontSize: '1.1rem', marginBottom: 12, color: 'var(--accent)' }}>Disposables (Inventory)</h3>
          
          <div className="table-container" style={{ marginBottom: 16 }}>
            <table className="data-table">
              <thead><tr><th>Item</th><th>Qty</th><th></th></tr></thead>
              <tbody>
                {linkedInventory.length === 0 && <tr><td colSpan={3} className="text-muted text-sm text-center">No inventory linked</td></tr>}
                {linkedInventory.map(item => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.quantity}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeInventory(item.id)}><Trash2 size={14} color="var(--danger)"/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Inventory Item</label>
              <select className="form-select" value={invForm.id} onChange={e => setInvForm({...invForm, id: e.target.value})}>
                <option value="">Select...</option>
                {inventory.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Qty</label>
              <input type="number" className="form-input" value={invForm.qty} onChange={e => setInvForm({...invForm, qty: e.target.value})} />
            </div>
            <div className="form-group">
              <button className="btn btn-secondary" onClick={addInventory} disabled={!invForm.id || !invForm.qty}><Plus size={16}/></button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
