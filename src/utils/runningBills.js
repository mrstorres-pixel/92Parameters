import db from '../db/database';

const STORAGE_KEY = 'runningBillsFallback';

function readLocalBills() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

function writeLocalBills(bills) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bills));
}

export async function loadOpenBills() {
  try {
    return await db.runningBills.query({
      filters: [{ field: 'status', op: 'eq', value: 'open' }],
      orderBy: 'updatedAt',
      ascending: false,
      limit: 100,
    });
  } catch {
    return readLocalBills().filter(bill => bill.status === 'open').sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export async function saveRunningBill({ billId, tableName, items, orderType, total, staff }) {
  const now = Date.now();
  const data = {
    tableName,
    items,
    orderType,
    total,
    status: 'open',
    staffId: staff?.id,
    staffName: staff?.name,
    updatedAt: now,
  };

  try {
    if (billId) {
      await db.runningBills.update(billId, data);
      return billId;
    }
    return await db.runningBills.add({ ...data, openedAt: now });
  } catch {
    const bills = readLocalBills();
    if (billId) {
      writeLocalBills(bills.map(bill => bill.id === billId ? { ...bill, ...data } : bill));
      return billId;
    }
    const id = `local-${now}`;
    writeLocalBills([{ ...data, id, openedAt: now }, ...bills]);
    return id;
  }
}

export async function closeRunningBill(billId, transactionId) {
  if (!billId) return;
  const data = { status: 'closed', closedAt: Date.now(), transactionId };
  try {
    await db.runningBills.update(billId, data);
  } catch {
    writeLocalBills(readLocalBills().map(bill => bill.id === billId ? { ...bill, ...data } : bill));
  }
}

export async function deleteRunningBill(billId) {
  if (!billId) return;
  try {
    await db.runningBills.delete(billId);
  } catch {
    writeLocalBills(readLocalBills().filter(bill => bill.id !== billId));
  }
}
