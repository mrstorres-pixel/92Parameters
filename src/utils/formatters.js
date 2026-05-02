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
  const timeStr =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  const random = crypto.getRandomValues(new Uint16Array(1))[0].toString(36).toUpperCase().padStart(3, '0');
  return `92P-${dateStr}-${timeStr}-${random}`;
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
