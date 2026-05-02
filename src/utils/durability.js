import db from '../db/database';

export const PAGE_SIZE = 50;

export function toBusinessDate(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function getDateRangeFilters(start, end, field = 'datetime') {
  return [
    { field, op: 'gte', value: start.getTime() },
    { field, op: 'lte', value: end.getTime() },
  ];
}

export async function recordIngredientMovement({
  ingredient,
  ingredientId,
  transactionId,
  receiptNo,
  type,
  quantity,
  beforeStock,
  afterStock,
  staff,
  productName,
}) {
  try {
    await db.ingredientMovements.add({
      ingredientId,
      ingredientName: ingredient?.name,
      transactionId,
      receiptNo,
      type,
      quantity,
      unit: ingredient?.unit,
      beforeStock,
      afterStock,
      staffId: staff?.id,
      staffName: staff?.name,
      productName,
      datetime: Date.now(),
    });
    return true;
  } catch (error) {
    console.error('Ingredient movement ledger write failed:', error);
    return false;
  }
}

export async function updateDailySalesSummary(transaction) {
  if (!transaction || transaction.status === 'void') return;

  const businessDate = toBusinessDate(transaction.datetime);
  const items = transaction.items || [];
  const revenue = Number(transaction.total || 0);
  const cost = items.reduce((sum, item) => sum + Number(item.cost || 0) * Number(item.quantity || 1), 0);
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  try {
    const existing = await db.dailySalesSummary.where('businessDate').equals(businessDate).first();
    const data = {
      businessDate,
      transactionCount: Number(existing?.transactionCount || 0) + 1,
      revenue: Number(existing?.revenue || 0) + revenue,
      cost: Number(existing?.cost || 0) + cost,
      profit: Number(existing?.profit || 0) + revenue - cost,
      itemCount: Number(existing?.itemCount || 0) + itemCount,
      updatedAt: Date.now(),
    };
    if (existing?.id) await db.dailySalesSummary.update(existing.id, data);
    else await db.dailySalesSummary.add(data);
    return true;
  } catch (error) {
    console.error('Daily sales summary write failed:', error);
    return false;
  }
}

export async function reverseDailySalesSummary(transaction) {
  if (!transaction) return;

  const businessDate = toBusinessDate(transaction.datetime);
  const items = transaction.items || [];
  const revenue = Number(transaction.total || 0);
  const cost = items.reduce((sum, item) => sum + Number(item.cost || 0) * Number(item.quantity || 1), 0);
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  try {
    const existing = await db.dailySalesSummary.where('businessDate').equals(businessDate).first();
    if (!existing) return;
    await db.dailySalesSummary.update(existing.id, {
      businessDate,
      transactionCount: Math.max(0, Number(existing.transactionCount || 0) - 1),
      revenue: Math.max(0, Number(existing.revenue || 0) - revenue),
      cost: Math.max(0, Number(existing.cost || 0) - cost),
      profit: Number(existing.profit || 0) - (revenue - cost),
      itemCount: Math.max(0, Number(existing.itemCount || 0) - itemCount),
      updatedAt: Date.now(),
    });
    return true;
  } catch (error) {
    console.error('Daily sales summary reversal failed:', error);
    return false;
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
