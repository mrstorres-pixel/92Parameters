import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { formatCurrency } from '../../utils/formatters';
import { calcItemTotal, calcCartTotal, calcCartSubtotal, calcItemAdjustedPrice } from '../../utils/calculations';

export default function CartPanel({ onCharge, activeBill, onSaveBill, onCloseBill }) {
  const { cart, orderType, orderDiscount, orderMarkup, orderDiscountAmount, orderMarkupAmount, setOrderType, setOrderDiscount, setOrderMarkup, setOrderDiscountAmount, setOrderMarkupAmount, updateQuantity, removeItem, setDiscount, setMarkup, setDiscountAmount, setMarkupAmount, clearCart } = usePosStore();
  const subtotal = calcCartSubtotal(cart);
  const total = calcCartTotal(cart, orderDiscount, orderMarkup, orderDiscountAmount, orderMarkupAmount);
  const [customDiscountItem, setCustomDiscountItem] = useState(null);
  const [customMarkupItem, setCustomMarkupItem] = useState(null);
  const [customVal, setCustomVal] = useState('');
  const [customMarkupVal, setCustomMarkupVal] = useState('');

  function applyPreset(productId, pct) {
    const item = cart.find(i => i.productId === productId);
    if (item && item.discount === pct) { setDiscount(productId, 0); }
    else { setDiscount(productId, pct); }
  }

  function openCustom(productId) { setCustomDiscountItem(productId); setCustomVal(''); }
  function applyCustom() {
    if (customDiscountItem && customVal) { setDiscount(customDiscountItem, Number(customVal)); }
    setCustomDiscountItem(null);
  }

  function applyMarkupPreset(productId, pct) {
    const item = cart.find(i => i.productId === productId);
    if (item && item.markup === pct) { setMarkup(productId, 0); }
    else { setMarkup(productId, pct); }
  }

  function openMarkupCustom(productId) { setCustomMarkupItem(productId); setCustomMarkupVal(''); }
  function applyMarkupCustom() {
    if (customMarkupItem && customMarkupVal) { setMarkup(customMarkupItem, Number(customMarkupVal)); }
    setCustomMarkupItem(null);
  }

  return (
    <div className="pos-cart-panel">
      <div className="cart-header">
        <div className="flex-between">
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{activeBill ? `Table ${activeBill.tableName}` : 'Current Order'}</h3>
          {cart.length > 0 && <button className="btn btn-ghost btn-sm" onClick={clearCart}>Clear</button>}
        </div>
        {activeBill && <div className="text-sm text-muted mt-8">Running bill opened by {activeBill.staffName || 'Staff'}</div>}
        <div className="toggle-group" style={{ marginTop: 10 }}>
          <button className={`toggle-option ${orderType === 'Dine In' ? 'active' : ''}`} onClick={() => setOrderType('Dine In')}>Dine In</button>
          <button className={`toggle-option ${orderType === 'Takeaway' ? 'active' : ''}`} onClick={() => setOrderType('Takeaway')}>Takeaway</button>
        </div>
      </div>

      <div className="cart-items">
        {cart.length === 0 ? (
          <div className="empty-state"><p>Tap products to add</p></div>
        ) : cart.map(item => (
          <div key={item.productId} className="cart-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="cart-item-info">
                <div className="cart-item-name">{item.name}</div>
                <div className="cart-item-price">
                  {item.discount > 0 && <span className="original">{formatCurrency(item.price)}</span>}
                  {formatCurrency(calcItemAdjustedPrice(item.price, item.discount, item.markup, item.discountAmount, item.markupAmount))}
                  {item.discount > 0 && <span style={{ color: 'var(--success)', marginLeft: 4, fontSize: '0.7rem' }}>-{item.discount}%</span>}
                  {item.markup > 0 && <span style={{ color: 'var(--warning)', marginLeft: 4, fontSize: '0.7rem' }}>+{item.markup}%</span>}
                  {item.discountAmount > 0 && <span style={{ color: 'var(--success)', marginLeft: 4, fontSize: '0.7rem' }}>-{formatCurrency(item.discountAmount)}</span>}
                  {item.markupAmount > 0 && <span style={{ color: 'var(--warning)', marginLeft: 4, fontSize: '0.7rem' }}>+{formatCurrency(item.markupAmount)}</span>}
                </div>
              </div>
              <div className="cart-item-qty">
                <button onClick={() => updateQuantity(item.productId, item.quantity - 1)}>−</button>
                <span>{item.quantity}</span>
                <button onClick={() => updateQuantity(item.productId, item.quantity + 1)}>+</button>
              </div>
              <div className="cart-item-total">{formatCurrency(calcItemTotal(item))}</div>
              <div className="cart-item-remove" onClick={() => removeItem(item.productId)}><Trash2 size={14} /></div>
            </div>
            <div className="discount-row">
              <span className="adjust-label">Discount</span>
              <button className={`discount-btn ${item.discount === 10 ? 'active' : ''}`} onClick={() => applyPreset(item.productId, 10)}>10%</button>
              <button className={`discount-btn ${item.discount === 20 ? 'active' : ''}`} onClick={() => applyPreset(item.productId, 20)}>20%</button>
              <button className={`discount-btn ${item.discount > 0 && item.discount !== 10 && item.discount !== 20 ? 'active' : ''}`} onClick={() => openCustom(item.productId)}>Custom</button>
            </div>
            {customDiscountItem === item.productId && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <input className="form-input" style={{ padding: '4px 8px', fontSize: '0.75rem', width: 70 }} type="number" placeholder="%" value={customVal} onChange={e => setCustomVal(e.target.value)} min="0" max="100" />
                <button className="btn btn-primary btn-sm" onClick={applyCustom} style={{ padding: '4px 10px' }}>Apply</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
              <span className="adjust-label">Cash Off</span>
              <input className="form-input" style={{ padding: '4px 8px', fontSize: '0.75rem', width: 90 }} type="number" min="0" placeholder="PHP" value={item.discountAmount || ''} onChange={e => setDiscountAmount(item.productId, e.target.value)} />
            </div>
            <div className="discount-row">
              <span className="adjust-label">Markup</span>
              <button className={`discount-btn ${item.markup === 10 ? 'active' : ''}`} onClick={() => applyMarkupPreset(item.productId, 10)}>10%</button>
              <button className={`discount-btn ${item.markup === 20 ? 'active' : ''}`} onClick={() => applyMarkupPreset(item.productId, 20)}>20%</button>
              <button className={`discount-btn ${item.markup > 0 && item.markup !== 10 && item.markup !== 20 ? 'active' : ''}`} onClick={() => openMarkupCustom(item.productId)}>Custom</button>
            </div>
            {customMarkupItem === item.productId && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <input className="form-input" style={{ padding: '4px 8px', fontSize: '0.75rem', width: 70 }} type="number" placeholder="%" value={customMarkupVal} onChange={e => setCustomMarkupVal(e.target.value)} min="0" />
                <button className="btn btn-primary btn-sm" onClick={applyMarkupCustom} style={{ padding: '4px 10px' }}>Apply</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
              <span className="adjust-label">Cash Add</span>
              <input className="form-input" style={{ padding: '4px 8px', fontSize: '0.75rem', width: 90 }} type="number" min="0" placeholder="PHP" value={item.markupAmount || ''} onChange={e => setMarkupAmount(item.productId, e.target.value)} />
            </div>
          </div>
        ))}
      </div>

      <div className="cart-footer">
        <div className="cart-total" style={{ fontSize: '0.9rem', fontWeight: 600 }}>
          <span>Subtotal</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>
        <div className="order-adjustments">
          <div className="form-group">
            <label className="form-label">Order Discount %</label>
            <input className="form-input" type="number" min="0" max="100" value={orderDiscount || ''} onChange={e => setOrderDiscount(e.target.value)} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Order Markup %</label>
            <input className="form-input" type="number" min="0" value={orderMarkup || ''} onChange={e => setOrderMarkup(e.target.value)} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Order Discount PHP</label>
            <input className="form-input" type="number" min="0" value={orderDiscountAmount || ''} onChange={e => setOrderDiscountAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Order Markup PHP</label>
            <input className="form-input" type="number" min="0" value={orderMarkupAmount || ''} onChange={e => setOrderMarkupAmount(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="cart-total">
          <span>Total</span>
          <span>{formatCurrency(total)}</span>
        </div>
        <div className="flex gap-8 mb-16">
          <button className="btn btn-secondary w-full" disabled={cart.length === 0} onClick={onSaveBill}>
            {activeBill ? 'Update Tab' : 'Save Tab'}
          </button>
          {activeBill && <button className="btn btn-danger" onClick={onCloseBill}>Close</button>}
        </div>
        <button className="btn btn-primary charge-btn" disabled={cart.length === 0} onClick={() => onCharge(total)}>
          {activeBill ? 'Bill Out' : 'Charge'} {formatCurrency(total)}
        </button>
      </div>
    </div>
  );
}
