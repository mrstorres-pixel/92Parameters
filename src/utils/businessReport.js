import { calcGrossProfit, calcItemTotal } from './calculations.js';
import { summarizeCashOutCategories } from './cashOutCategories.js';

const normalizeCategory = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const packagingCategories = new Set(['takeoutbox', 'takeoutboxes', 'packaging', 'paperbag', 'paperbags']);

export function isPackagingItem(item) {
  if ([item.category, item.subCategory].some(value => packagingCategories.has(normalizeCategory(value)))) return true;
  // Older receipts may not have a category; recognize the cafe's packaging names too.
  return /^(?:take[\s-]*out\s*box(?:es)?|paper[\s-]*bags?|bagasse)(?:\b|\s|#)/i.test(String(item.name || '').trim());
}

export function buildMerchandiseSummary(transactions) {
  const categories = new Map();
  const products = new Map();
  let totalItems = 0;
  transactions.filter(t => t.status !== 'void').forEach(transaction => {
    (transaction.items || []).filter(item => !isPackagingItem(item)).forEach(item => {
      const quantity = Number(item.quantity ?? 1);
      if (quantity <= 0) return;
      const name = item.category || 'Other';
      const row = categories.get(name) || { name, quantity: 0, grossSales: 0, cost: 0, netSales: 0 };
      row.quantity += quantity;
      row.grossSales += calcItemTotal(item);
      row.cost += Number(item.cost || 0) * quantity;
      row.netSales = row.grossSales - row.cost;
      categories.set(name, row);
      products.set(item.name, (products.get(item.name) || 0) + quantity);
      totalItems += quantity;
    });
  });
  const categoryRows = [...categories.values()].sort((a, b) => b.grossSales - a.grossSales);
  return {
    totalItems,
    categoryRows,
    categoryData: categoryRows.filter(row => row.grossSales > 0).map(row => ({ name: row.name, value: row.grossSales })),
    topProducts: [...products].map(([name, qty]) => ({ name, qty })).filter(row => row.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 8),
    categoryTotals: categoryRows.reduce((totals, row) => ({
      grossSales: totals.grossSales + row.grossSales,
      cost: totals.cost + row.cost,
      netSales: totals.netSales + row.netSales,
    }), { grossSales: 0, cost: 0, netSales: 0 }),
  };
}

export function buildCashOutSummary(transactions, cashEntries) {
  const { revenue } = calcGrossProfit(transactions);
  const totalCashOut = cashEntries.filter(entry => entry.type === 'out').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return { totalCashOut, netAfterCashOut: revenue - totalCashOut };
}

export function buildOperatingProfitSummary(transactions, cashEntries) {
  const gross = calcGrossProfit(transactions);
  const cashOuts = summarizeCashOutCategories(cashEntries);
  return {
    ...cashOuts,
    revenue: gross.revenue,
    cost: gross.cost,
    grossProfit: gross.profit,
    estimatedOperatingProfit: gross.profit - cashOuts.operatingExpenses,
  };
}

// Read every page so long date ranges cannot silently truncate financial totals.
export async function fetchReportRows(table, filters) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = await table.query({ filters, orderBy: 'id', ascending: true, limit: pageSize, offset, throwOnError: true });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
