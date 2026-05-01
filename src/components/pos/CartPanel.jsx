import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { formatCurrency } from '../../utils/formatters';
import { calcItemTotal, calcCartTotal, calcItemDiscountedPrice } from '../../utils/calculations';

export default function CartPanel({ onCharge }) {
  const { cart, orderType, setOrderType, updateQuantity, removeItem, setDiscount, clearCart } = usePosStore();
  const total = calcCartTotal(cart);
  const [customDiscountItem, setCustomDiscountItem] = useState(null);
  const [customVal, setCustomVal] = useState('');

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

  return (
    <div className="pos-cart-panel">
      <div className="cart-header">
        <div className="flex-between">
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Current Order</h3>
          {cart.length > 0 && <button className="btn btn-ghost btn-sm" onClick={clearCart}>Clear</button>}
        </div>
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
                  {formatCurrency(calcItemDiscountedPrice(item.price, item.discount))}
                  {item.discount > 0 && <span style={{ color: 'var(--success)', marginLeft: 4, fontSize: '0.7rem' }}>-{item.discount}%</span>}
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
          </div>
        ))}
      </div>

      <div className="cart-footer">
        <div className="cart-total">
          <span>Total</span>
          <span>{formatCurrency(total)}</span>
        </div>
        <button className="btn btn-primary charge-btn" disabled={cart.length === 0} onClick={() => onCharge(total)}>
          Charge {formatCurrency(total)}
        </button>
      </div>
    </div>
  );
}
