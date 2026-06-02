import db from '../db/database';

export const PESOS_PER_POINT_EARNED = 150;
export const POINTS_PER_PESO_REDEEMED = 1;

export function generateMemberCode() {
  const random = crypto.getRandomValues(new Uint16Array(1))[0].toString(36).toUpperCase().padStart(3, '0');
  return `92P-MEMBER-${Date.now().toString().slice(-6)}-${random}`;
}

export function generateMembershipCardCode() {
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().padStart(6, '0');
  return `92P-CARD-${Date.now().toString().slice(-5)}-${random}`;
}

export function extractMemberCode(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/92P-(?:CARD|MEMBER)-[A-Z0-9-]+/i);
  return match ? match[0].toUpperCase() : text.toUpperCase();
}

export function getMemberPortalUrl(code) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/#/member/${encodeURIComponent(code)}`;
}

export function getQrImageUrl(value, size = 180) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;
}

export function calculateEarnedPoints(amount) {
  return Math.max(0, Math.floor(Number(amount || 0) / PESOS_PER_POINT_EARNED));
}

export function calculateRedeemPoints(discountAmount) {
  return Math.max(0, Math.ceil(Number(discountAmount || 0) * POINTS_PER_PESO_REDEEMED));
}

export function getRedeemableAmount(customer, orderTotal) {
  const pointsValue = Math.floor(Number(customer?.pointsBalance || 0) / POINTS_PER_PESO_REDEEMED);
  return Math.max(0, Math.min(pointsValue, Math.floor(Number(orderTotal || 0))));
}

export function getMembershipExpiry(activatedAt) {
  if (!activatedAt) return null;
  const expiry = new Date(Number(activatedAt));
  expiry.setFullYear(expiry.getFullYear() + 1);
  return expiry.getTime();
}

export function isMembershipExpired(customerOrCard, now = Date.now()) {
  const explicitExpiry = Number(customerOrCard?.expiresAt || 0);
  const expiry = explicitExpiry || getMembershipExpiry(customerOrCard?.activatedAt);
  return Boolean(expiry && Number(now) > expiry);
}

export function getBirthdayRewardStatus(customer, now = new Date()) {
  if (!customer?.birthday) return { eligible: false, reason: 'No birthday set' };
  if (isMembershipExpired(customer, now.getTime())) return { eligible: false, reason: 'Membership expired' };
  const birthday = new Date(`${customer.birthday}T00:00:00`);
  const currentMonth = now.getMonth() + 1;
  const birthMonth = birthday.getMonth() + 1;
  if (currentMonth !== birthMonth) return { eligible: false, reason: 'Not birthday month' };
  const currentYear = now.getFullYear();
  if (Number(customer.birthdayRewardYear || 0) === currentYear) return { eligible: false, reason: 'Birthday reward already redeemed this year' };
  return { eligible: true, reason: 'Birthday month reward available', year: currentYear };
}

export async function writeLoyaltyTransaction({
  customer,
  transactionId = null,
  receiptNo = null,
  type,
  points,
  amount = 0,
  details,
  staff,
}) {
  if (!customer?.id || !points) return null;
  const signedPoints = Number(points || 0);
  const fresh = await db.customers.get(customer.id);
  if (!fresh) return null;
  const beforePoints = Number(fresh.pointsBalance || 0);
  const afterPoints = Math.max(0, beforePoints + signedPoints);
  await db.customers.update(fresh.id, { pointsBalance: afterPoints, updatedAt: Date.now() });
  return db.loyaltyTransactions.add({
    customerId: fresh.id,
    customerName: fresh.name,
    memberCode: fresh.memberCode,
    transactionId,
    receiptNo,
    type,
    points: signedPoints,
    amount: Number(amount || 0),
    beforePoints,
    afterPoints,
    details,
    staffId: staff?.id,
    staffName: staff?.name,
    datetime: Date.now(),
  });
}

export async function reverseLoyaltyForTransaction(transaction, staff, reason = 'transaction reversal') {
  if (!transaction?.customerId) return false;
  const earned = Number(transaction.loyaltyEarned || 0);
  const redeemed = Number(transaction.loyaltyRedeemed || 0);
  const birthdayRewardRedeemed = Boolean(transaction.birthdayRewardRedeemed);
  if (!earned && !redeemed && !birthdayRewardRedeemed) return false;
  const customer = await db.customers.get(transaction.customerId);
  if (!customer) return false;
  const pointsDelta = redeemed - earned;
  if (pointsDelta) {
    await writeLoyaltyTransaction({
      customer,
      transactionId: transaction.id,
      receiptNo: transaction.receiptNo,
      type: 'REVERSAL',
      points: pointsDelta,
      amount: Number(transaction.loyaltyDiscount || 0),
      details: `${reason}: reversed ${earned} earned point${earned === 1 ? '' : 's'} and restored ${redeemed} redeemed point${redeemed === 1 ? '' : 's'}`,
      staff,
    });
  }
  if (birthdayRewardRedeemed) {
    await db.customers.update(customer.id, { birthdayRewardYear: null, updatedAt: Date.now() });
    await db.loyaltyTransactions.add({
      customerId: customer.id,
      customerName: customer.name,
      memberCode: customer.memberCode,
      transactionId: transaction.id,
      receiptNo: transaction.receiptNo,
      type: 'BIRTHDAY_REVERSAL',
      points: 0,
      amount: 0,
      beforePoints: Number(customer.pointsBalance || 0),
      afterPoints: Number(customer.pointsBalance || 0),
      details: `${reason}: restored birthday month reward eligibility`,
      staffId: staff?.id,
      staffName: staff?.name,
      datetime: Date.now(),
    });
  }
  return true;
}
