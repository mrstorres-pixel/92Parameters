import React from 'react';
import { formatCurrency } from '../../utils/formatters';

const EMOJIS = {
  'Espresso': '☕', 'Americano': '☕', 'Café Latte': '🥛', 'Cappuccino': '☕',
  'Caramel Macchiato': '🍮', 'Mocha': '🍫', 'Matcha Latte': '🍵', 'Iced Tea': '🧊',
  'Hot Chocolate': '🍫', 'Croissant': '🥐', 'Blueberry Muffin': '🧁', 'Chocolate Cake Slice': '🍰',
  'Cheesecake Slice': '🍰', 'Ham & Cheese Sandwich': '🥪', 'Chicken Pesto Panini': '🥪', 'Caesar Salad': '🥗',
};

export default function ProductGrid({ products, category, searchQuery, onAdd }) {
  const filtered = products.filter(p => {
    if (category && category !== 'All' && p.category !== category) return false;
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="product-grid">
      {filtered.map(p => (
        <div key={p.id} className={`product-card ${!p.isAvailable ? 'unavailable' : ''}`} onClick={() => p.isAvailable && onAdd(p)}>
          <div className="product-emoji">{EMOJIS[p.name] || '☕'}</div>
          <div className="product-name">{p.name}</div>
          <div className="product-price">{formatCurrency(p.price)}</div>
          {!p.isAvailable && <span className="badge badge-danger" style={{ position: 'absolute', top: 8, right: 8 }}>Off</span>}
        </div>
      ))}
      {filtered.length === 0 && <div className="empty-state"><p>No products found</p></div>}
    </div>
  );
}
