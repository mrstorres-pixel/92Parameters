import React, { useId } from 'react';
import { CASH_OUT_CATEGORIES } from '../../utils/cashOutCategories';

export default function CashOutCategoryField({ value, onChange, suggested = false, disabled = false }) {
  const id = useId();
  const category = CASH_OUT_CATEGORIES.find(option => option.value === value);
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>Cash-out category (optional)</label>
      <select id={id} className="form-select" value={value || ''} onChange={event => onChange(event.target.value || null)} disabled={disabled} aria-describedby={`${id}-help`}>
        <option value="">Unclassified - needs review</option>
        {CASH_OUT_CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <p id={`${id}-help`} className="text-sm text-muted" style={{ marginTop: 8 }}>
        {suggested ? 'Suggested from your notes. Check this category before saving. ' : ''}
        {category?.description || 'Unclassified cash-outs stay visible for review and are not deducted as operating expenses.'}
      </p>
    </div>
  );
}
