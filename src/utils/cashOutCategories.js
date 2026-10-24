export const CASH_OUT_CATEGORIES = [
  { value: 'operating_expense', label: 'Operating expense', description: 'Salaries, rent, utilities and other day-to-day expenses.' },
  { value: 'stock_purchase', label: 'Stock purchase', description: 'Ingredients, resale stock and packaging already covered by product costs.' },
  { value: 'owner_withdrawal', label: 'Owner withdrawal', description: 'Money taken out by an owner for personal use.' },
];

export function getCashOutCategory(entry) {
  if (entry.type !== 'out') return null;
  return CASH_OUT_CATEGORIES.some(category => category.value === entry.category) ? entry.category : null;
}

export function cashOutCategoryLabel(entry) {
  if (entry.type !== 'out') return 'Not applicable';
  return CASH_OUT_CATEGORIES.find(category => category.value === getCashOutCategory(entry))?.label || 'Needs review';
}

// Suggestions are never used in profit until the user saves a category.
export function suggestCashOutCategory(notes) {
  const text = String(notes || '').toLowerCase();
  // Mixed purposes, negation and financing/tax/capital notes need manual review.
  if (/\b(?:not|no|refund|reimbursement|reimburse|loan|interest|tax|taxes|equipment|appliance|appliances)\b/.test(text)) return null;
  const matches = [
    ['operating_expense', /\b(?:salary|salaries|payroll|wages?|rent|rental|electricity|electric bill|water bill|internet|utilities|utility bill)\b/.test(text)],
    ['stock_purchase', /\b(?:restock(?:ing)?|stock purchase|ingredients?|inventory|packaging|coffee beans|paper\s*bags?|take[\s-]*out boxes?)\b/.test(text)],
    ['owner_withdrawal', /\b(?:owner(?:'s)? withdrawal|owner drawings?|personal withdrawal|personal use|drawings)\b/.test(text)],
  ].filter(([, matched]) => matched);
  return matches.length === 1 ? matches[0][0] : null;
}

export function summarizeCashOutCategories(entries) {
  const totals = { operatingExpenses: 0, stockPurchases: 0, ownerWithdrawals: 0, unclassifiedAmount: 0, unclassifiedCount: 0 };
  const fields = { operating_expense: 'operatingExpenses', stock_purchase: 'stockPurchases', owner_withdrawal: 'ownerWithdrawals' };
  entries.filter(entry => entry.type === 'out').forEach(entry => {
    const field = fields[getCashOutCategory(entry)];
    const amount = Number(entry.amount || 0);
    if (field) totals[field] += amount;
    else {
      totals.unclassifiedAmount += amount;
      totals.unclassifiedCount += 1;
    }
  });
  return totals;
}

export function cashCategorySaveError(error) {
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    return 'Cash-out categories are not set up in the database yet. Apply the category migration, then try again.';
  }
  return 'Could not save the cash-out category. Check your connection and access, then try again.';
}
