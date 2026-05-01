export function calcStockValue(quantity, cost) {
  return Number(quantity || 0) * Number(cost || 0);
}

export function calcCartTotal(items) {
  return items.reduce((sum, item) => sum + calcItemTotal(item), 0);
}

export function calcItemTotal(item) {
  const price = Number(item.price || 0);
  const qty = Number(item.quantity || 1);
  const discount = Number(item.discount || 0);
  const discounted = price * (1 - discount / 100);
  return discounted * qty;
}

export function calcItemDiscountedPrice(price, discount) {
  return Number(price) * (1 - Number(discount || 0) / 100);
}

export function calcChange(paid, total) {
  return Math.max(0, Number(paid) - Number(total));
}

export function calcGrossProfit(transactions) {
  let revenue = 0;
  let cost = 0;
  transactions.forEach(t => {
    if (t.status === 'void') return;
    (t.items || []).forEach(item => {
      const qty = item.quantity || 1;
      const disc = item.discount || 0;
      revenue += item.price * (1 - disc / 100) * qty;
      cost += (item.cost || 0) * qty;
    });
  });
  return { revenue, cost, profit: revenue - cost };
}
