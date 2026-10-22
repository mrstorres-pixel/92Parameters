import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashOutSummary, buildMerchandiseSummary, fetchReportRows, isPackagingItem } from '../src/utils/businessReport.js';
import { calcGrossProfit } from '../src/utils/calculations.js';

const transactions = [
  { status: 'completed', total: 255, items: [
    { name: 'Bibimbowl', category: 'Food', price: 100, cost: 40, quantity: '2' },
    { name: 'Latte', category: 'Drinks', price: 50, cost: 20, quantity: 1 },
    { name: 'Bagasse 1000ml', category: 'Takeout Box', price: 0, cost: 3, quantity: 2 },
    { name: 'Paperbag #20', price: 5, cost: 2, quantity: 1 },
  ] },
  { status: 'void', total: 999, items: [{ name: 'Voided product', category: 'Food', price: 999, cost: 500, quantity: 5 }] },
];

test('packaging is absent from rankings and category totals but retained in financial totals', () => {
  const summary = buildMerchandiseSummary(transactions);
  assert.equal(summary.totalItems, 3);
  assert.deepEqual(summary.topProducts, [{ name: 'Bibimbowl', qty: 2 }, { name: 'Latte', qty: 1 }]);
  assert.deepEqual(summary.categoryData, [{ name: 'Food', value: 200 }, { name: 'Drinks', value: 50 }]);
  assert.deepEqual(summary.categoryTotals, { grossSales: 250, cost: 100, netSales: 150 });
  assert.deepEqual(calcGrossProfit(transactions), { revenue: 255, cost: 108, profit: 147 });
});

test('recognizes packaging categories and legacy names without hiding normal products', () => {
  for (const item of [
    { category: ' take-out boxes ', name: 'Container' },
    { subCategory: 'Packaging', name: 'Container' },
    { name: 'Take-out Box 1000ml' }, { name: 'Paper bag #12' }, { name: 'Paperbag #20' }, { name: 'Bagasse 1000ml' },
  ]) assert.equal(isPackagingItem(item), true, JSON.stringify(item));
  for (const name of ['Bibimbowl', 'Chicken Fingers and Chips', 'Lunch Box Meal', 'Bagel', 'Coffee']) {
    assert.equal(isPackagingItem({ name }), false, name);
  }
});

test('free merchandise can rank by quantity without creating a zero-value pie slice', () => {
  const summary = buildMerchandiseSummary([{ items: [
    { name: 'Free coffee', category: 'Drinks', price: 0, quantity: 2 },
    { name: 'Not sold', category: 'Food', price: 100, quantity: 0 },
  ] }]);
  assert.equal(summary.totalItems, 2);
  assert.deepEqual(summary.categoryData, []);
  assert.deepEqual(summary.topProducts, [{ name: 'Free coffee', qty: 2 }]);
});

test('net after cash-outs deducts all cash-out types once and excludes void sales and cash-ins', () => {
  const entries = [
    { type: 'out', amount: '30', notes: 'Salary' },
    { type: 'out', amount: 20, notes: 'Stock purchase' },
    { type: 'out', amount: 10, notes: 'Owner withdrawal' },
    { type: 'in', amount: 1000 },
  ];
  assert.deepEqual(buildCashOutSummary(transactions, entries), { totalCashOut: 60, netAfterCashOut: 195 });
  assert.deepEqual(buildCashOutSummary([], entries), { totalCashOut: 60, netAfterCashOut: -60 });
  assert.deepEqual(buildCashOutSummary([], []), { totalCashOut: 0, netAfterCashOut: 0 });
});

test('category subtotal respects item discounts and custom prices independently of order discounts', () => {
  const summary = buildMerchandiseSummary([{ total: 100, items: [
    { name: 'Food', category: 'Food', price: 100, discount: 10, cost: 20, quantity: 1 },
    { name: 'Drink', category: 'Drinks', price: 50, customPrice: 25, cost: 10, quantity: 1 },
    { name: 'Paperbag', price: 5, quantity: 1 },
  ] }]);
  assert.deepEqual(summary.categoryTotals, { grossSales: 115, cost: 30, netSales: 85 });
});

test('pagination reads beyond 5000 records with stable ordering and strict errors', async () => {
  const source = Array.from({ length: 5101 }, (_, id) => ({ id }));
  const filters = [{ field: 'type', op: 'eq', value: 'out' }];
  const rows = await fetchReportRows({ query: async options => {
    assert.deepEqual(options.filters, filters);
    assert.equal(options.throwOnError, true);
    assert.equal(options.orderBy, 'id');
    return source.slice(options.offset, options.offset + options.limit);
  } }, filters);
  assert.deepEqual(rows, source);
});

test('a failed later page rejects the report instead of displaying partial financial totals', async () => {
  await assert.rejects(fetchReportRows({ query: async ({ offset }) => {
    if (offset > 0) throw new Error('Connection lost');
    return Array.from({ length: 500 }, (_, id) => ({ id }));
  } }, []), /Connection lost/);
});
