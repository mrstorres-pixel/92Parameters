import { create } from 'zustand';

export const usePosStore = create((set, get) => ({
  cart: [],
  orderType: 'Dine In',

  setOrderType: (type) => set({ orderType: type }),

  addItem: (product) => {
    const cart = get().cart;
    const existing = cart.find(i => i.productId === product.id);
    if (existing) {
      set({ cart: cart.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i) });
    } else {
      set({ cart: [...cart, { productId: product.id, name: product.name, price: product.price, cost: product.cost || 0, quantity: 1, discount: 0 }] });
    }
  },

  removeItem: (productId) => {
    set({ cart: get().cart.filter(i => i.productId !== productId) });
  },

  updateQuantity: (productId, qty) => {
    if (qty <= 0) { get().removeItem(productId); return; }
    set({ cart: get().cart.map(i => i.productId === productId ? { ...i, quantity: qty } : i) });
  },

  setDiscount: (productId, discount) => {
    set({ cart: get().cart.map(i => i.productId === productId ? { ...i, discount: Number(discount) } : i) });
  },

  clearCart: () => set({ cart: [], orderType: 'Dine In' }),
}));
