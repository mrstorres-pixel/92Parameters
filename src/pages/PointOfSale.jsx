import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import db from '../db/database';
import { usePosStore } from '../stores/posStore';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { generateReceiptNo } from '../utils/formatters';
import { calcCartTotal, calcItemTotal } from '../utils/calculations';
import { recordIngredientMovement, updateDailySalesSummary } from '../utils/durability';
import ProductGrid from '../components/pos/ProductGrid';
import CartPanel from '../components/pos/CartPanel';
import PaymentModal from '../components/pos/PaymentModal';
import ReceiptModal from '../components/pos/ReceiptModal';
import { CATEGORIES } from '../config/categories';

export default function PointOfSale() {
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState('All');
  const [subCategory, setSubCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const { cart, orderType, addItem, clearCart } = usePosStore();
  const currentStaff = useAuthStore(s => s.currentStaff);
  const toast = useToast();

  useEffect(() => { db.products.toArray().then(setProducts); }, []);

  async function handlePayment(method, cashReceived) {
    try {
      const total = calcCartTotal(cart);
      const receiptNo = generateReceiptNo();
      const txn = {
        receiptNo, datetime: Date.now(), orderType,
        items: cart.map(i => ({ ...i })), paymentMethod: method,
        total, cashReceived: method === 'Cash' ? cashReceived : null,
        staffId: currentStaff?.id, staffName: currentStaff?.name, status: 'completed',
      };
      const transactionId = await db.transactions.add(txn);
      const savedTxn = { ...txn, id: transactionId };
      const summaryUpdated = await updateDailySalesSummary(savedTxn);

      // Deduct ingredients
      for (const item of cart) {
        const links = await db.productIngredients.where('productId').equals(item.productId).toArray();
        for (const link of links) {
          const ing = await db.ingredients.get(link.ingredientId);
          if (ing) {
            const deducted = link.quantity * item.quantity;
            const nextStock = Math.max(0, ing.inStock - deducted);
            await db.ingredients.update(link.ingredientId, { inStock: nextStock });
            await db.auditLog.add({
              action: 'DEDUCT',
              entity: ing.name,
              entityId: link.ingredientId,
              staffId: currentStaff?.id,
              staffName: currentStaff?.name,
              datetime: Date.now(),
              details: `Deducted ${deducted}${ing.unit} for ${item.quantity} x ${item.name} (${receiptNo}); stock ${ing.inStock}${ing.unit} -> ${nextStock}${ing.unit}`
            });
            const movementRecorded = await recordIngredientMovement({
              ingredient: ing,
              ingredientId: link.ingredientId,
              transactionId,
              receiptNo,
              type: 'DEDUCT',
              quantity: deducted,
              beforeStock: ing.inStock,
              afterStock: nextStock,
              staff: currentStaff,
              productName: item.name,
            });
            if (!movementRecorded) {
              await db.auditLog.add({
                action: 'LEDGER_ERROR',
                entity: ing.name,
                entityId: link.ingredientId,
                staffId: currentStaff?.id,
                staffName: currentStaff?.name,
                datetime: Date.now(),
                details: `Ingredient movement ledger write failed for ${receiptNo}`
              });
            }
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

      setReceipt(savedTxn);
      setShowPayment(false);
      clearCart();
      toast(summaryUpdated ? 'Transaction completed!' : 'Transaction completed, but summary update failed. Check Maintenance.', summaryUpdated ? 'success' : 'error');
    } catch (error) {
      console.error('Payment failed:', error);
      toast('Could not complete transaction. Please try again or check the connection.', 'error');
    }
  }

  return (
    <div className="pos-layout">
      <div className="pos-menu">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="tabs" style={{ marginBottom: 0 }}>
              {['All', ...Object.keys(CATEGORIES)].map(c => (
                <button key={c} className={`tab ${category === c ? 'active' : ''}`} onClick={() => { setCategory(c); setSubCategory('All'); }}>{c}</button>
              ))}
            </div>
            <div className="search-bar">
              <Search size={16} />
              <input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {category !== 'All' && CATEGORIES[category] && (
            <div className="tabs" style={{ marginBottom: 0, padding: '4px 8px', background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)' }}>
              {['All', ...CATEGORIES[category]].map(sc => (
                <button 
                  key={sc} 
                  className={`tab ${subCategory === sc ? 'active' : ''}`} 
                  onClick={() => setSubCategory(sc)}
                  style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                >
                  {sc}
                </button>
              ))}
            </div>
          )}
        </div>
        <ProductGrid products={products} category={category} subCategory={subCategory} searchQuery={search} onAdd={addItem} />
      </div>
      <CartPanel onCharge={() => setShowPayment(true)} />
      {showPayment && <PaymentModal total={calcCartTotal(cart)} onConfirm={handlePayment} onClose={() => setShowPayment(false)} />}
      {receipt && <ReceiptModal transaction={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
