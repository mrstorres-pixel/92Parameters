import React, { useState } from 'react';
import { SlidersHorizontal, Trash2 } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { formatCurrency } from '../../utils/formatters';
import { calcItemTotal, calcCartTotal, calcCartSubtotal, calcItemAdjustedPrice } from '../../utils/calculations';

export default function CartPanel({ onCharge, activeBill, onSaveBill, onCloseBill }) {
  const { cart, orderType, orderDiscount, orderDiscountAmount, setOrderType, setOrderDiscount, setOrderDiscountAmount, updateQuantity, removeItem, setDiscount, setMarkup, setCustomPrice, clearCart } = usePosStore();
  const subtotal = calcCartSubtotal(cart);
  const total = calcCartTotal(cart, orderDiscount, 0, orderDiscountAmount, 0);
  const [customDiscountItem, setCustomDiscountItem] = useState(null);
  const [customMarkupItem, setCustomMarkupItem] = useState(null);
  const [customVal, setCustomVal] = useState('');
  const [customMarkupVal, setCustomMarkupVal] = useState('');
  const [adjustingItem, setAdjustingItem] = useState(null);
  const [showOrderAdjustments, setShowOrderAdjustments] = useState(false);
  const hasOrderAdjustments = orderDiscount > 0 || orderDiscountAmount > 0;

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
          <div key={item.productId} className="cart-item cart-item-expanded">
            <div className="cart-item-main">
              <div className="cart-item-info">
                <div className="cart-item-name">{item.name}</div>
                <div className="cart-item-price">
                  {Number(item.customPrice || 0) > 0 && <span className="original">{formatCurrency(item.price)}</span>}
                  {formatCurrency(calcItemAdjustedPrice(item))}
                  {item.discount > 0 && <span style={{ color: 'var(--success)', marginLeft: 4, fontSize: '0.7rem' }}>-{item.discount}%</span>}
                  {item.markup > 0 && <span style={{ color: 'var(--warning)', marginLeft: 4, fontSize: '0.7rem' }}>+{item.markup}%</span>}
                  {Number(item.customPrice || 0) > 0 && <span style={{ color: 'var(--accent)', marginLeft: 4, fontSize: '0.7rem' }}>Custom</span>}
                </div>
              </div>
              <div className="cart-item-qty">
                <button onClick={() => updateQuantity(item.productId, item.quantity - 1)}>−</button>
                <span>{item.quantity}</span>
                <button onClick={() => updateQuantity(item.productId, item.quantity + 1)}>+</button>
              </div>
              <div className="cart-item-total">{formatCurrency(calcItemTotal(item))}</div>
              <button className={`cart-adjust-toggle ${adjustingItem === item.productId ? 'active' : ''}`} onClick={() => setAdjustingItem(adjustingItem === item.productId ? null : item.productId)} title="Adjust price">
                <SlidersHorizontal size={14} />
              </button>
              <div className="cart-item-remove" onClick={() => removeItem(item.productId)}><Trash2 size={14} /></div>
            </div>
            {adjustingItem === item.productId && (
              <div className="item-adjust-panel">
                <div className="discount-row">
                  <span className="adjust-label">Discount</span>
                  <button className={`discount-btn ${item.discount === 10 ? 'active' : ''}`} onClick={() => applyPreset(item.productId, 10)}>10%</button>
                  <button className={`discount-btn ${item.discount === 20 ? 'active' : ''}`} onClick={() => applyPreset(item.productId, 20)}>20%</button>
                  <button className={`discount-btn ${item.discount > 0 && item.discount !== 10 && item.discount !== 20 ? 'active' : ''}`} onClick={() => openCustom(item.productId)}>Custom</button>
                </div>
                {customDiscountItem === item.productId && (
                  <div className="adjust-custom-row">
                    <input className="form-input adjust-mini-input" type="number" placeholder="%" value={customVal} onChange={e => setCustomVal(e.target.value)} min="0" max="100" />
                    <button className="btn btn-primary btn-sm" onClick={applyCustom}>Apply</button>
                  </div>
                )}
                <div className="custom-price-row">
                  <label>
                    <span>Custom Unit Price</span>
                    <input className="form-input" type="number" min="0" placeholder="Use regular price" value={item.customPrice || ''} onChange={e => setCustomPrice(item.productId, e.target.value)} />
                  </label>
                  {Number(item.customPrice || 0) > 0 && <button className="btn btn-secondary btn-sm" onClick={() => setCustomPrice(item.productId, 0)}>Reset</button>}
                </div>
                <div className="discount-row">
                  <span className="adjust-label">Markup</span>
                  <button className={`discount-btn ${item.markup === 10 ? 'active' : ''}`} onClick={() => applyMarkupPreset(item.productId, 10)}>10%</button>
                  <button className={`discount-btn ${item.markup === 20 ? 'active' : ''}`} onClick={() => applyMarkupPreset(item.productId, 20)}>20%</button>
                  <button className={`discount-btn ${item.markup > 0 && item.markup !== 10 && item.markup !== 20 ? 'active' : ''}`} onClick={() => openMarkupCustom(item.productId)}>Custom</button>
                </div>
                {customMarkupItem === item.productId && (
                  <div className="adjust-custom-row">
                    <input className="form-input adjust-mini-input" type="number" placeholder="%" value={customMarkupVal} onChange={e => setCustomMarkupVal(e.target.value)} min="0" />
                    <button className="btn btn-primary btn-sm" onClick={applyMarkupCustom}>Apply</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="cart-footer">
        <div className="cart-total" style={{ fontSize: '0.9rem', fontWeight: 600 }}>
          <span>Subtotal</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>
        <button className={`order-adjust-toggle ${hasOrderAdjustments ? 'active' : ''}`} onClick={() => setShowOrderAdjustments(!showOrderAdjustments)}>
          <span>Order adjustments</span>
          {hasOrderAdjustments && <strong>Applied</strong>}
        </button>
        {showOrderAdjustments && (
          <div className="order-adjustments">
            <div className="form-group">
              <label className="form-label">Discount %</label>
              <input className="form-input" type="number" min="0" max="100" value={orderDiscount || ''} onChange={e => setOrderDiscount(e.target.value)} placeholder="0" />
            </div>
            <div className="form-group">
              <label className="form-label">Discount PHP</label>
              <input className="form-input" type="number" min="0" value={orderDiscountAmount || ''} onChange={e => setOrderDiscountAmount(e.target.value)} placeholder="0" />
            </div>
          </div>
        )}
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
