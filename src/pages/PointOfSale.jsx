import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import db from '../db/database';
import { usePosStore } from '../stores/posStore';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { generateReceiptNo } from '../utils/formatters';
import { calcCartTotal, calcItemTotal } from '../utils/calculations';
import ProductGrid from '../components/pos/ProductGrid';
import CartPanel from '../components/pos/CartPanel';
import PaymentModal from '../components/pos/PaymentModal';
import ReceiptModal from '../components/pos/ReceiptModal';

export default function PointOfSale() {
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const { cart, orderType, addItem, clearCart } = usePosStore();
  const currentStaff = useAuthStore(s => s.currentStaff);
  const toast = useToast();

  useEffect(() => { db.products.toArray().then(setProducts); }, []);

  async function handlePayment(method, cashReceived) {
    const total = calcCartTotal(cart);
    const receiptNo = generateReceiptNo();
    const txn = {
      receiptNo, datetime: Date.now(), orderType,
      items: cart.map(i => ({ ...i })), paymentMethod: method,
      total, cashReceived: method === 'Cash' ? cashReceived : null,
      staffId: currentStaff?.id, staffName: currentStaff?.name, status: 'completed',
    };
    await db.transactions.add(txn);

    // Deduct ingredients
    for (const item of cart) {
      const links = await db.productIngredients.where('productId').equals(item.productId).toArray();
      for (const link of links) {
        const ing = await db.ingredients.get(link.ingredientId);
        if (ing) {
          await db.ingredients.update(link.ingredientId, { inStock: Math.max(0, ing.inStock - link.quantity * item.quantity) });
        }
      }

      // Deduct inventory items (cups, lids, etc.)
      const invLinks = await db.productInventory.where('productId').equals(item.productId).toArray();
      for (const link of invLinks) {
        const inv = await db.inventory.get(link.inventoryId);
        if (inv) {
          await db.inventory.update(link.inventoryId, { inStock: Math.max(0, inv.inStock - link.quantity * item.quantity) });
        }
      }
    }

    setReceipt(txn);
    setShowPayment(false);
    clearCart();
    toast('Transaction completed!', 'success');
  }

  return (
    <div className="pos-layout">
      <div className="pos-menu">
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="tabs" style={{ marginBottom: 0 }}>
            {['All', 'Drinks', 'Food'].map(c => (
              <button key={c} className={`tab ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
          <div className="search-bar">
            <Search size={16} />
            <input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <ProductGrid products={products} category={category} searchQuery={search} onAdd={addItem} />
      </div>
      <CartPanel onCharge={() => setShowPayment(true)} />
      {showPayment && <PaymentModal total={calcCartTotal(cart)} onConfirm={handlePayment} onClose={() => setShowPayment(false)} />}
      {receipt && <ReceiptModal transaction={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
