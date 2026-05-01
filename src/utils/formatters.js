export function formatCurrency(amount) {
  return '₱' + Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTime(date) {
  const d = new Date(date);
  return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function formatDateTime(date) {
  return formatDate(date) + ' ' + formatTime(date);
}

export function generateReceiptNo() {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const stored = JSON.parse(localStorage.getItem('receiptCounter') || '{}');
  if (stored.date !== dateStr) {
    stored.date = dateStr;
    stored.count = 0;
  }
  stored.count++;
  localStorage.setItem('receiptCounter', JSON.stringify(stored));
  return `92P-${dateStr}-${String(stored.count).padStart(4, '0')}`;
}

export function getStockStatus(current, threshold) {
  if (current <= 0) return 'out';
  if (current <= threshold) return 'low';
  return 'ok';
}

export function getStockStatusLabel(current, threshold) {
  const s = getStockStatus(current, threshold);
  if (s === 'out') return 'Out of Stock';
  if (s === 'low') return 'Low Stock';
  return 'In Stock';
}
