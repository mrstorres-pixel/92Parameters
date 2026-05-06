import { create } from 'zustand';

export const usePosStore = create((set, get) => ({
  cart: [],
  orderType: 'Dine In',
  orderDiscount: 0,
  orderMarkup: 0,
  orderDiscountAmount: 0,
  orderMarkupAmount: 0,

  setOrderType: (type) => set({ orderType: type }),
  setOrderDiscount: (discount) => set({ orderDiscount: Number(discount || 0) }),
  setOrderMarkup: (markup) => set({ orderMarkup: Number(markup || 0) }),
  setOrderDiscountAmount: (amount) => set({ orderDiscountAmount: Number(amount || 0) }),
  setOrderMarkupAmount: (amount) => set({ orderMarkupAmount: Number(amount || 0) }),

  setCart: (cart, orderType = 'Dine In', orderDiscount = 0, orderMarkup = 0, orderDiscountAmount = 0, orderMarkupAmount = 0) => set({ cart, orderType, orderDiscount, orderMarkup, orderDiscountAmount, orderMarkupAmount }),

  addItem: (product) => {
    const cart = get().cart;
    const existing = cart.find(i => i.productId === product.id);
    if (existing) {
      set({ cart: cart.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i) });
    } else {
      set({ cart: [...cart, { productId: product.id, name: product.name, category: product.category, subCategory: product.subCategory, price: product.price, cost: product.cost || 0, quantity: 1, discount: 0, markup: 0, customPrice: 0 }] });
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
    set({ cart: get().cart.map(i => i.productId === productId ? { ...i, discount: Number(discount), customPrice: 0 } : i) });
  },
  setMarkup: (productId, markup) => {
    set({ cart: get().cart.map(i => i.productId === productId ? { ...i, markup: Number(markup), customPrice: 0 } : i) });
  },
  setCustomPrice: (productId, amount) => {
    const customPrice = Number(amount || 0);
    set({ cart: get().cart.map(i => i.productId === productId ? { ...i, customPrice, discount: customPrice > 0 ? 0 : i.discount, markup: customPrice > 0 ? 0 : i.markup } : i) });
  },

  clearCart: () => set({ cart: [], orderType: 'Dine In', orderDiscount: 0, orderMarkup: 0, orderDiscountAmount: 0, orderMarkupAmount: 0 }),
}));
