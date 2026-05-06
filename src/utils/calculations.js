export function calcStockValue(quantity, cost) {
  return Number(quantity || 0) * Number(cost || 0);
}

export function calcCartSubtotal(items) {
  return items.reduce((sum, item) => sum + calcItemTotal(item), 0);
}

export function calcCartTotal(items, orderDiscount = 0, orderMarkup = 0) {
  const subtotal = calcCartSubtotal(items);
  return subtotal * (1 - Number(orderDiscount || 0) / 100) * (1 + Number(orderMarkup || 0) / 100);
}

export function calcItemTotal(item) {
  const price = Number(item.price || 0);
  const qty = Number(item.quantity || 1);
  const discount = Number(item.discount || 0);
  const markup = Number(item.markup || 0);
  return calcItemAdjustedPrice(price, discount, markup) * qty;
}

export function calcItemDiscountedPrice(price, discount) {
  return Number(price) * (1 - Number(discount || 0) / 100);
}

export function calcItemAdjustedPrice(price, discount = 0, markup = 0) {
  return Number(price || 0) * (1 - Number(discount || 0) / 100) * (1 + Number(markup || 0) / 100);
}

export function calcChange(paid, total) {
  return Math.max(0, Number(paid) - Number(total));
}

export function calcGrossProfit(transactions) {
  let revenue = 0;
  let cost = 0;
  transactions.forEach(t => {
    if (t.status === 'void') return;
    revenue += Number(t.total || 0);
    (t.items || []).forEach(item => {
      const qty = item.quantity || 1;
      cost += (item.cost || 0) * qty;
    });
  });
  return { revenue, cost, profit: revenue - cost };
}
