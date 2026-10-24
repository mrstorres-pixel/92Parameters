import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestCashOutCategory, getCashOutCategory, summarizeCashOutCategories, cashCategorySaveError } from '../src/utils/cashOutCategories.js';
import { buildOperatingProfitSummary } from '../src/utils/businessReport.js';

test('notes suggest operating expenses, stock purchases and owner withdrawals', () => {
  for (const notes of ['Staff SALARIES October', 'Monthly payroll', 'Electricity bill', 'Internet payment', 'Rent']) {
    assert.equal(suggestCashOutCategory(notes), 'operating_expense', notes);
  }
  for (const notes of ['Restocking ingredients', 'Coffee beans', 'Takeout boxes', 'Packaging', 'stock purchase']) {
    assert.equal(suggestCashOutCategory(notes), 'stock_purchase', notes);
  }
  for (const notes of ['Owner withdrawal', "Owner's withdrawal", 'Owner drawings', 'Personal use']) {
    assert.equal(suggestCashOutCategory(notes), 'owner_withdrawal', notes);
  }
});

test('ambiguous, mixed, negated and non-operating notes require manual review', () => {
  for (const notes of ['', undefined, 'Bill', 'Supplies', 'Delivery', 'Salary and ingredients', 'Rent and owner withdrawal', 'No salary payment', 'Payroll reimbursement', 'Equipment purchase', 'Income tax', 'Loan interest', 'Water bill and stock purchase']) {
    assert.equal(suggestCashOutCategory(notes), null, String(notes));
  }
});

test('legacy notes never silently count as a confirmed classification', () => {
  const legacy = { type: 'out', amount: 1000, notes: 'Salary' };
  assert.equal(getCashOutCategory(legacy), null);
  assert.equal(getCashOutCategory({ ...legacy, category: 'not_a_category' }), null);
  assert.equal(getCashOutCategory({ ...legacy, category: 'operating_expense' }), 'operating_expense');
  assert.deepEqual(summarizeCashOutCategories([legacy]), {
    operatingExpenses: 0, stockPurchases: 0, ownerWithdrawals: 0, unclassifiedAmount: 1000, unclassifiedCount: 1,
  });
});

test('operating profit excludes stock purchases and withdrawals from expense deductions', () => {
  const transactions = [
    { status: 'completed', total: 10000, items: [{ quantity: 10, cost: 400 }] },
    { status: 'void', total: 2000, items: [{ quantity: 10, cost: 100 }] },
  ];
  const entries = [
    { type: 'out', amount: '1000', category: 'operating_expense' },
    { type: 'out', amount: 2000, category: 'stock_purchase' },
    { type: 'out', amount: 3000, category: 'owner_withdrawal' },
    { type: 'out', amount: 500, notes: 'Salary' },
    { type: 'out', amount: 100, category: 'unknown' },
    { type: 'in', amount: 15000, category: 'operating_expense' },
  ];
  const before = structuredClone(entries);
  assert.deepEqual(buildOperatingProfitSummary(transactions, entries), {
    revenue: 10000, cost: 4000, grossProfit: 6000, operatingExpenses: 1000,
    stockPurchases: 2000, ownerWithdrawals: 3000, unclassifiedAmount: 600, unclassifiedCount: 2,
    estimatedOperatingProfit: 5000,
  });
  assert.deepEqual(entries, before);
});

test('manual classification overrides misleading notes and can be cleared for review', () => {
  const entry = { type: 'out', amount: 100, notes: 'Salary', category: 'owner_withdrawal' };
  assert.equal(buildOperatingProfitSummary([], [entry]).estimatedOperatingProfit, 0);
  assert.equal(buildOperatingProfitSummary([], [{ ...entry, category: 'operating_expense' }]).estimatedOperatingProfit, -100);
  const cleared = buildOperatingProfitSummary([], [{ ...entry, category: null }]);
  assert.equal(cleared.estimatedOperatingProfit, 0);
  assert.equal(cleared.unclassifiedCount, 1);
});

test('empty periods, cash-ins and losses are represented correctly', () => {
  const empty = buildOperatingProfitSummary([], [{ type: 'in', amount: 500 }]);
  assert.equal(empty.estimatedOperatingProfit, 0);
  assert.equal(empty.unclassifiedCount, 0);
  const loss = buildOperatingProfitSummary([{ total: 50, items: [{ cost: 100, quantity: 1 }] }], [
    { type: 'out', amount: 25, category: 'operating_expense' },
  ]);
  assert.equal(loss.estimatedOperatingProfit, -75);
});

test('missing migration and denied writes produce actionable errors', () => {
  assert.match(cashCategorySaveError({ code: 'PGRST204' }), /migration/);
  assert.match(cashCategorySaveError({ code: '42703' }), /migration/);
  assert.match(cashCategorySaveError({ code: '42501' }), /connection and access/);
});
