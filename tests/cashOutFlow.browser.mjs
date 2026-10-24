import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// All database traffic is intercepted; no real accounts or financial records are used.
process.env.VITE_SUPABASE_URL = 'https://cashout-fixture.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'fixture-public-key';
const now = Date.now();
const staff = { id: 1, name: 'Test Owner', pin: '2468', role: 'owner' };
const transactions = [
  { id: 1, status: 'completed', datetime: now, total: 10000, paymentMethod: 'Cash', items: [{ name: 'Food', category: 'Food', quantity: 10, price: 1000, cost: 400 }] },
  { id: 2, status: 'void', datetime: now, total: 9999, items: [{ name: 'Void', category: 'Food', quantity: 1, cost: 500 }] },
];
const entries = [
  { id: 1, type: 'out', amount: 1000, notes: 'Staff salary October', staffName: staff.name, datetime: now },
  { id: 2, type: 'out', amount: 2000, notes: 'Ingredients', category: 'stock_purchase', datetime: now },
  { id: 3, type: 'out', amount: 3000, notes: 'Owner withdrawal', category: 'owner_withdrawal', datetime: now },
  { id: 4, type: 'out', amount: 500, notes: 'Supplies', datetime: now },
  { id: 5, type: 'in', amount: 20000, notes: 'Opening cash', datetime: now },
];
let writeError = null;
const writes = [];
const pageErrors = [];
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, mode: 'test' });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Singapore' });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === baseUrl) return route.continue();
    if (url.hostname !== 'cashout-fixture.supabase.co') return route.abort();
    const table = url.pathname.split('/').pop();
    const method = request.method();
    const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-type': 'application/json' };
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { ...headers, 'access-control-allow-methods': 'GET,HEAD,POST,PATCH,OPTIONS', 'access-control-allow-headers': '*' }, body: '' });
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'content-range': '0-0/1' }, body: '' });
    if (method === 'PATCH' || method === 'POST') {
      assert.equal(table, 'cash_drawer');
      const payload = request.postDataJSON();
      writes.push({ method, payload });
      if (writeError) return route.fulfill({ status: writeError.code === 'PGRST204' ? 400 : 403, headers, body: JSON.stringify(writeError) });
      if (method === 'POST') {
        const row = { id: entries.length + 1, ...payload[0] };
        entries.push(row);
        return route.fulfill({ status: 201, headers, body: JSON.stringify([row]) });
      }
      assert.deepEqual(Object.keys(payload), ['category']);
      assert.equal(url.searchParams.get('type'), 'eq.out');
      const entry = entries.find(row => `eq.${row.id}` === url.searchParams.get('id'));
      assert.ok(entry);
      entry.category = payload.category;
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ id: entry.id, category: entry.category }) });
    }
    let rows = table === 'staff' ? [staff] : table === 'cash_drawer' ? entries : table === 'transactions' ? transactions : [];
    for (const [field, condition] of url.searchParams) {
      const [operator, ...parts] = condition.split('.');
      const value = parts.join('.');
      if (operator === 'eq') rows = rows.filter(row => String(row[field]) === value);
      if (operator === 'gte') rows = rows.filter(row => Number(row[field]) >= Number(value));
      if (operator === 'lte') rows = rows.filter(row => Number(row[field]) <= Number(value));
    }
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 1000);
    return route.fulfill({ status: 200, headers, body: JSON.stringify(rows.slice(offset, offset + limit)) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/#/reports`);
  await page.getByText('Enter your PIN to clock in').waitFor();
  for (const digit of staff.pin) await page.getByRole('button', { name: digit, exact: true }).click();
  const profitCard = () => page.locator('.card').filter({ has: page.locator('.card-title').filter({ hasText: /^Estimated Operating Profit$/ }) });
  async function assertProfit(amount) {
    const formatted = Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await profitCard().locator('.stat-value').filter({ hasText: formatted }).waitFor();
    assert.equal((await profitCard().locator('.stat-value').innerText()).replace(/[^0-9.-]/g, ''), amount);
  }
  async function navigate(hash) {
    await page.evaluate(value => { window.location.hash = value; }, hash);
  }
  await assertProfit('6000.00');
  await page.getByText(/2 cash-outs totaling/).waitFor();
  assert.equal(writes.length, 0);
  await page.locator('.toolbar select').selectOption('GCash');
  await assertProfit('6000.00');
  await page.getByRole('link', { name: 'Review in Cash Drawer / Monthly Reports' }).click();
  await page.getByRole('row').filter({ hasText: 'Staff salary October' }).getByRole('button', { name: 'Review category' }).click();
  const reviewModal = () => page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'Review Cash-out Category' }) });
  assert.equal(await reviewModal().getByLabel('Cash-out category (optional)').inputValue(), 'operating_expense');
  assert.equal(writes.length, 0);
  await reviewModal().getByRole('button', { name: 'Save category' }).click();
  await reviewModal().waitFor({ state: 'hidden' });
  assert.equal(entries[0].notes, 'Staff salary October');
  assert.equal(entries[0].amount, 1000);
  await navigate('/reports');
  await assertProfit('5000.00');
  await page.getByText(/1 cash-out totaling/).waitFor();
  await navigate('/cash');
  await page.getByRole('button', { name: 'Cash Out', exact: true }).click();
  const cashForm = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'Cash Out', exact: true }) });
  await cashForm.locator('input[type="number"]').fill('200');
  await cashForm.getByLabel('Notes', { exact: true }).fill('Salary');
  assert.equal(await cashForm.getByLabel('Cash-out category (optional)').inputValue(), 'operating_expense');
  await cashForm.getByLabel('Cash-out category (optional)').selectOption('owner_withdrawal');
  await cashForm.getByLabel('Notes', { exact: true }).fill('Internet bill');
  assert.equal(await cashForm.getByLabel('Cash-out category (optional)').inputValue(), 'owner_withdrawal');
  await cashForm.getByRole('button', { name: 'Save', exact: true }).click();
  await cashForm.waitFor({ state: 'hidden' });
  assert.equal(entries.at(-1).category, 'owner_withdrawal');
  assert.equal(entries.at(-1).notes, 'Internet bill');
  await page.getByRole('button', { name: 'Cash In', exact: true }).click();
  const cashInForm = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'Cash In', exact: true }) });
  assert.equal(await cashInForm.locator('select').count(), 0);
  await cashInForm.locator('input[type="number"]').fill('50');
  await cashInForm.getByLabel('Notes', { exact: true }).fill('Salary float');
  await cashInForm.getByRole('button', { name: 'Save', exact: true }).click();
  await cashInForm.waitFor({ state: 'hidden' });
  assert.equal(Object.hasOwn(entries.at(-1), 'category'), false);
  await page.getByRole('button', { name: 'Monthly Reports' }).click();
  const monthly = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'Monthly Cash Movement Report' }) });
  await monthly.getByLabel('Only cash-outs needing category review').check();
  assert.equal(await monthly.locator('tbody tr').count(), 1);
  await monthly.getByRole('button', { name: 'Review category' }).click();
  for (const error of [{ code: '42501', message: 'Permission denied' }, { code: 'PGRST204', message: 'Missing category column' }, { code: 'PGRST116', message: 'No matching row' }]) {
    writeError = error;
    await reviewModal().getByLabel('Cash-out category (optional)').selectOption('operating_expense');
    await reviewModal().getByRole('button', { name: 'Save category' }).click();
    await reviewModal().getByRole('button', { name: 'Save category' }).waitFor();
    await page.getByText(error.code === 'PGRST204' ? /Apply the category migration/ : /Check your connection and access/).first().waitFor();
    assert.equal(entries[3].category, undefined);
  }
  writeError = null;
  await reviewModal().getByLabel('Cash-out category (optional)').selectOption('operating_expense');
  await reviewModal().getByRole('button', { name: 'Save category' }).click();
  await reviewModal().waitFor({ state: 'hidden' });
  await monthly.getByText('No cash drawer records match this report.').waitFor();
  await monthly.getByRole('button', { name: 'Done' }).click();
  await navigate('/reports');
  await assertProfit('4500.00');
  await page.getByText('All recorded cash-outs for this period are categorized.').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertProfit('4500.00');
  assert.deepEqual(pageErrors, []);
  console.log('PASS: category suggestions, manual override, legacy review, unchanged notes/amounts, profit calculation, payment scope, cash-in compatibility, missing migration, denied/zero-row writes, monthly review and mobile render.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
