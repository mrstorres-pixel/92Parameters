import React, { useRef, useState, useEffect } from 'react';
import { Search, Clock, CreditCard, X } from 'lucide-react';
import db from '../db/database';
import { usePosStore } from '../stores/posStore';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { formatCurrency, generateReceiptNo } from '../utils/formatters';
import { calcCartSubtotal, calcCartTotal } from '../utils/calculations';
import { recordIngredientMovement, updateDailySalesSummary } from '../utils/durability';
import { closeRunningBill, deleteRunningBill, loadOpenBills, saveRunningBill } from '../utils/runningBills';
import { adjustIngredientStock } from '../utils/stockAdjustments';
import { formatPaymentLabel } from '../utils/payments';
import { calculateEarnedPoints, calculateRedeemPoints, extractMemberCode, getBirthdayRewardStatus, getRedeemableAmount, isMembershipExpired, writeLoyaltyTransaction } from '../utils/loyalty';
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
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loyaltyRedeemAmount, setLoyaltyRedeemAmount] = useState('');
  const [birthdayReward, setBirthdayReward] = useState(false);
  const [runningBills, setRunningBills] = useState([]);
  const [activeBill, setActiveBill] = useState(null);
  const { cart, orderType, orderDiscount, orderDiscountAmount, addItem, clearCart, setCart } = usePosStore();
  const currentStaff = useAuthStore(s => s.currentStaff);
  const paymentLockRef = useRef(false);
  const toast = useToast();

  useEffect(() => {
    db.products.toArray().then(setProducts);
    refreshBills();
    const interval = setInterval(refreshBills, 10000);
    const onFocus = () => refreshBills();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  async function refreshBills() {
    setRunningBills(await loadOpenBills());
  }

  async function searchCustomers(query) {
    setCustomerSearch(query);
    if (!query.trim()) {
      setCustomerResults([]);
      return;
    }
    const q = query.trim();
    const code = extractMemberCode(q);
    const [byCard, byCode, byName, byPhone] = await Promise.all([
      db.membershipCards.where('cardCode').equals(code).first(),
      db.customers.query({ filters: [{ field: 'memberCode', op: 'ilike', value: `%${code || q}%` }], limit: 5 }),
      db.customers.query({ filters: [{ field: 'name', op: 'ilike', value: `%${q}%` }], limit: 5 }),
      db.customers.query({ filters: [{ field: 'phone', op: 'ilike', value: `%${q}%` }], limit: 5 }),
    ]);
    const cardCustomer = byCard?.customerId ? await db.customers.get(byCard.customerId) : null;
    const unique = [cardCustomer, ...byCode, ...byName, ...byPhone].filter(Boolean).filter((customer, index, arr) => arr.findIndex(c => c.id === customer.id) === index);
    setCustomerResults(unique.filter(customer => customer.status !== 'inactive' && !isMembershipExpired(customer)).slice(0, 8));
  }

  function selectCustomer(customer) {
    setSelectedCustomer(customer);
    setCustomerSearch('');
    setCustomerResults([]);
    setLoyaltyRedeemAmount('');
    setBirthdayReward(false);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerSearch('');
    setCustomerResults([]);
    setLoyaltyRedeemAmount('');
    setBirthdayReward(false);
  }

  async function saveBill() {
    if (cart.length === 0) return;
    const tableName = activeBill?.tableName || window.prompt('Table name / number?');
    if (!tableName) return;
    try {
      const id = await saveRunningBill({
        billId: activeBill?.id,
        tableName,
        items: cart.map(i => ({ ...i })),
        orderType,
        orderDiscount,
        orderMarkup: 0,
        orderDiscountAmount,
        orderMarkupAmount: 0,
        total: calcCartTotal(cart, orderDiscount, 0, orderDiscountAmount, 0),
        staff: currentStaff,
        expectedUpdatedAt: activeBill?.updatedAt,
      });
      setActiveBill({ ...(activeBill || {}), id, tableName, items: cart.map(i => ({ ...i })), orderType, orderDiscount, orderMarkup: 0, orderDiscountAmount, orderMarkupAmount: 0, total: calcCartTotal(cart, orderDiscount, 0, orderDiscountAmount, 0), staffName: currentStaff?.name, updatedAt: Date.now() });
      await refreshBills();
      toast(activeBill ? 'Running bill updated' : 'Running bill saved', 'success');
      clearCart();
      setActiveBill(null);
    } catch (error) {
      await refreshBills();
      toast(error.message || 'Running bill changed on another device. Reload it and try again.', 'error');
    }
  }

  function loadBill(bill) {
    setActiveBill(bill);
    setCart(bill.items || [], bill.orderType || 'Dine In', bill.orderDiscount || 0, 0, bill.orderDiscountAmount || 0, 0);
  }

  async function closeBill() {
    if (!activeBill) return;
    if (!window.confirm(`Close running bill for ${activeBill.tableName}? This will discard the open tab without charging.`)) return;
    await deleteRunningBill(activeBill.id);
    clearCart();
    setActiveBill(null);
    await refreshBills();
    toast('Running bill closed', 'info');
  }

  function createCheckoutKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function openPayment() {
    if (cart.length === 0 || showPayment || isProcessingPayment) return;
    setCheckoutKey(createCheckoutKey());
    setShowPayment(true);
  }

  async function handlePayment(paymentLines, cashReceived) {
    if (paymentLockRef.current) return;
    paymentLockRef.current = true;
    setIsProcessingPayment(true);
    try {
      const orderTotal = calcCartTotal(cart, orderDiscount, 0, orderDiscountAmount, 0);
      const maxLoyaltyDiscount = selectedCustomer ? getRedeemableAmount(selectedCustomer, orderTotal) : 0;
      const loyaltyDiscount = Math.min(maxLoyaltyDiscount, Math.max(0, Number(loyaltyRedeemAmount || 0)));
      const loyaltyRedeemed = calculateRedeemPoints(loyaltyDiscount);
      const total = Math.max(0, orderTotal - loyaltyDiscount);
      const loyaltyEarned = selectedCustomer ? calculateEarnedPoints(total) : 0;
      const birthdayStatus = selectedCustomer ? getBirthdayRewardStatus(selectedCustomer) : { eligible: false };
      const birthdayRewardRedeemed = Boolean(selectedCustomer && birthdayReward && birthdayStatus.eligible);
      const cleanPaymentLines = paymentLines.map(line => ({ method: line.method, amount: Number(line.amount || 0) })).filter(line => line.amount > 0);
      const paidTotal = cleanPaymentLines.reduce((sum, line) => sum + line.amount, 0);
      if (paidTotal < total) throw new Error('Payment is not complete yet.');
      if (paidTotal > total && !cleanPaymentLines.some(line => line.method === 'Cash')) throw new Error('Only cash payments can be above the amount due.');
      const changeDue = Math.max(0, paidTotal - total);
      const appliedPaymentLines = cleanPaymentLines
        .map(line => line.method === 'Cash' ? { ...line, amount: Math.max(0, line.amount - changeDue) } : line)
        .filter(line => line.amount > 0);
      const method = appliedPaymentLines.length ? formatPaymentLabel(appliedPaymentLines) : 'Loyalty';
      const receiptNo = generateReceiptNo();
      const currentCheckoutKey = checkoutKey || createCheckoutKey();
      const txn = {
        receiptNo, checkoutKey: currentCheckoutKey, datetime: Date.now(), orderType,
        items: cart.map(i => ({ ...i })), paymentMethod: method,
        paymentLines: appliedPaymentLines,
        orderDiscount, orderMarkup: 0, orderDiscountAmount, orderMarkupAmount: 0, subtotal: calcCartSubtotal(cart),
        customerId: selectedCustomer?.id || null, customerName: selectedCustomer?.name || null, memberCode: selectedCustomer?.memberCode || null,
        loyaltyEarned, loyaltyRedeemed, loyaltyDiscount, birthdayRewardRedeemed,
        total, cashReceived,
        staffId: currentStaff?.id, staffName: currentStaff?.name, status: 'completed',
      };
      let transactionId;
      try {
        transactionId = await db.transactions.add(txn);
      } catch (error) {
        if (error?.code === '23505') {
          throw new Error('This payment is already being processed.');
        }
        const message = String(error?.message || '');
        const canUseLegacyInsert = error?.code === 'PGRST204' || error?.code === '42703' || message.includes('checkoutKey');
        if (!canUseLegacyInsert) throw error;
        if (selectedCustomer) {
          throw new Error('Membership database migration is required before charging member sales.');
        }
        const { checkoutKey: _checkoutKey, paymentLines: _paymentLines, customerId: _customerId, customerName: _customerName, memberCode: _memberCode, loyaltyEarned: _loyaltyEarned, loyaltyRedeemed: _loyaltyRedeemed, loyaltyDiscount: _loyaltyDiscount, birthdayRewardRedeemed: _birthdayRewardRedeemed, orderDiscount: _orderDiscount, orderMarkup: _orderMarkup, orderDiscountAmount: _orderDiscountAmount, orderMarkupAmount: _orderMarkupAmount, subtotal: _subtotal, ...legacyTxn } = txn;
        transactionId = await db.transactions.add(legacyTxn);
      }
      const savedTxn = { ...txn, id: transactionId };
      const summaryUpdated = await updateDailySalesSummary(savedTxn);
      if (selectedCustomer && (loyaltyEarned || loyaltyRedeemed || birthdayRewardRedeemed)) {
        if (loyaltyRedeemed) {
          await writeLoyaltyTransaction({
            customer: selectedCustomer,
            transactionId,
            receiptNo,
            type: 'REDEEM',
            points: -loyaltyRedeemed,
            amount: loyaltyDiscount,
            details: `Redeemed ${loyaltyRedeemed} points for ${formatCurrency(loyaltyDiscount)} discount`,
            staff: currentStaff,
          });
        }
        if (loyaltyEarned) {
          await writeLoyaltyTransaction({
            customer: selectedCustomer,
            transactionId,
            receiptNo,
            type: 'EARN',
            points: loyaltyEarned,
            amount: total,
            details: `Earned from sale ${receiptNo}`,
            staff: currentStaff,
          });
        }
        if (birthdayRewardRedeemed) {
          const year = new Date().getFullYear();
          await db.customers.update(selectedCustomer.id, { birthdayRewardYear: year, updatedAt: Date.now() });
          await db.loyaltyTransactions.add({
            customerId: selectedCustomer.id,
            customerName: selectedCustomer.name,
            memberCode: selectedCustomer.memberCode,
            transactionId,
            receiptNo,
            type: 'BIRTHDAY_REWARD',
            points: 0,
            amount: 0,
            beforePoints: Number(selectedCustomer.pointsBalance || 0),
            afterPoints: Number(selectedCustomer.pointsBalance || 0),
            details: 'Birthday month reward redeemed: free cake slice and coffee',
            staffId: currentStaff?.id,
            staffName: currentStaff?.name,
            datetime: Date.now(),
          });
        }
      }
      if (activeBill) await closeRunningBill(activeBill.id, transactionId);

      // Deduct ingredients
      for (const item of cart) {
        const links = await db.productIngredients.where('productId').equals(item.productId).toArray();
        for (const link of links) {
          const ing = await db.ingredients.get(link.ingredientId);
          if (ing) {
            const deducted = link.quantity * item.quantity;
            const { beforeStock, afterStock } = await adjustIngredientStock(ing, -deducted);
            await db.auditLog.add({
              action: 'DEDUCT',
              entity: ing.name,
              entityId: link.ingredientId,
              staffId: currentStaff?.id,
              staffName: currentStaff?.name,
              datetime: Date.now(),
              details: `Deducted ${deducted}${ing.unit} for ${item.quantity} x ${item.name} (${receiptNo}); stock ${beforeStock}${ing.unit} -> ${afterStock}${ing.unit}`
            });
            const movementRecorded = await recordIngredientMovement({
              ingredient: ing,
              ingredientId: link.ingredientId,
              transactionId,
              receiptNo,
              type: 'DEDUCT',
              quantity: deducted,
              beforeStock,
              afterStock,
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
      setCheckoutKey(null);
      clearCart();
      setActiveBill(null);
      clearCustomer();
      refreshBills();
      toast(summaryUpdated ? 'Transaction completed!' : 'Transaction completed, but summary update failed. Check Maintenance.', summaryUpdated ? 'success' : 'error');
    } catch (error) {
      console.error('Payment failed:', error);
      toast(error.message || 'Could not complete transaction. Please try again or check the connection.', 'error');
    } finally {
      paymentLockRef.current = false;
      setIsProcessingPayment(false);
    }
  }

  return (
    <div className="pos-layout">
      <div className="pos-menu">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {runningBills.length > 0 && (
            <div className="running-bills">
              <div className="text-sm text-muted" style={{ fontWeight: 700, textTransform: 'uppercase' }}>Running Bills</div>
              <div className="running-bill-list">
                {runningBills.map(bill => (
                  <button key={bill.id} className={`running-bill ${activeBill?.id === bill.id ? 'active' : ''}`} onClick={() => loadBill(bill)}>
                    <Clock size={14} />
                    <span>Table {bill.tableName}</span>
                    <strong>{formatCurrency(bill.total || 0)}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
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
          <div className="loyalty-panel">
            <div className="loyalty-member-row">
              <div className="text-sm text-muted" style={{ fontWeight: 700, textTransform: 'uppercase' }}><CreditCard size={14} /> Member</div>
              {selectedCustomer && <button className="btn btn-ghost btn-sm" onClick={clearCustomer}><X size={14} /> Remove</button>}
            </div>
            {selectedCustomer ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="flex-between">
                  <div>
                    <div style={{ fontWeight: 700 }}>{selectedCustomer.name}</div>
                    <div className="text-muted text-sm">{selectedCustomer.memberCode} - {selectedCustomer.pointsBalance || 0} pts</div>
                  </div>
                  <span className="badge badge-success">Active</span>
                </div>
                {getBirthdayRewardStatus(selectedCustomer).eligible ? (
                  <label className="checkbox-row">
                    <input type="checkbox" checked={birthdayReward} onChange={e => setBirthdayReward(e.target.checked)} />
                    <span>Redeem birthday reward: free cake slice and coffee</span>
                  </label>
                ) : (
                  <div className="text-muted text-sm">Birthday promo: {getBirthdayRewardStatus(selectedCustomer).reason}</div>
                )}
                <div className="form-row">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Redeem PHP</label>
                    <input className="form-input" type="number" min="0" max={getRedeemableAmount(selectedCustomer, calcCartTotal(cart, orderDiscount, 0, orderDiscountAmount, 0))} value={loyaltyRedeemAmount} onChange={e => setLoyaltyRedeemAmount(e.target.value)} placeholder="0" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Available</label>
                    <div className="form-input" style={{ background: 'var(--bg-card)' }}>{formatCurrency(getRedeemableAmount(selectedCustomer, calcCartTotal(cart, orderDiscount, 0, orderDiscountAmount, 0)))}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <div className="search-bar" style={{ maxWidth: '100%', width: '100%' }}>
                  <Search size={16} />
                  <input placeholder="Scan card or search member..." value={customerSearch} onChange={e => searchCustomers(e.target.value)} />
                </div>
                {customerResults.length > 0 && (
                  <div className="card" style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)', zIndex: 20, padding: 8 }}>
                    {customerResults.map(customer => (
                      <button key={customer.id} className="btn btn-ghost w-full" style={{ justifyContent: 'space-between' }} onClick={() => selectCustomer(customer)}>
                        <span>{customer.name}</span>
                        <span className="text-muted text-sm">{customer.pointsBalance || 0} pts</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <ProductGrid products={products} category={category} subCategory={subCategory} searchQuery={search} onAdd={addItem} />
      </div>
      <CartPanel onCharge={openPayment} activeBill={activeBill} onSaveBill={saveBill} onCloseBill={closeBill} checkoutDisabled={showPayment || isProcessingPayment} loyaltyCustomer={selectedCustomer} loyaltyDiscount={Math.min(selectedCustomer ? getRedeemableAmount(selectedCustomer, calcCartTotal(cart, orderDiscount, 0, orderDiscountAmount, 0)) : 0, Math.max(0, Number(loyaltyRedeemAmount || 0)))} />
      {showPayment && <PaymentModal total={Math.max(0, calcCartTotal(cart, orderDiscount, 0, orderDiscountAmount, 0) - Math.min(selectedCustomer ? getRedeemableAmount(selectedCustomer, calcCartTotal(cart, orderDiscount, 0, orderDiscountAmount, 0)) : 0, Math.max(0, Number(loyaltyRedeemAmount || 0))))} onConfirm={handlePayment} onClose={() => { if (!isProcessingPayment) setShowPayment(false); }} isProcessing={isProcessingPayment} />}
      {receipt && <ReceiptModal transaction={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
