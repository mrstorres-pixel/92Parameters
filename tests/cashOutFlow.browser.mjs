import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";
import { createReportingDb, seedRows } from "./helpers/reportingDb.js";

// Browser -> Supabase-shaped HTTP -> actual PostgreSQL report functions.
// All external requests are intercepted. No live records are touched.
process.env.VITE_SUPABASE_URL = "https://reports-fixture.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "fixture-public-key";
const database = await createReportingDb();
const now = Date.now(),
  longName =
    "Specialty coffee with oat milk and a deliberately long product name";
const product = {
  productId: 1,
  name: longName,
  category: "Drinks",
  quantity: 1,
  price: 100,
  cost: 40,
};
await seedRows(database, "products", [
  { id: 1, name: longName, category: "Drinks", price: 100, cost: 40 },
  {
    id: 2,
    name: "Milk / Waste Full Cream",
    category: "Drinks",
    price: 0,
    cost: 2,
  },
]);
const txs = Array.from({ length: 121 }, (_, i) => ({
  id: i + 1,
  receiptNo: `R${i + 1}`,
  datetime: now,
  status: "completed",
  total: 100,
  items: [product],
  staffId: 1,
  paymentMethod: "Cash",
  ...(i === 120
    ? {
        paymentMethod: "Cash + GCash",
        paymentLines: [
          { method: "Cash", amount: 60 },
          { method: "GCash", amount: 40 },
        ],
      }
    : {}),
}));
txs.push(
  {
    id: 122,
    receiptNo: "FREE",
    datetime: now,
    status: "completed",
    total: 0,
    items: [product],
    orderDiscount: 100,
    paymentMethod: "Loyalty",
  },
  {
    id: 123,
    receiptNo: "WASTE",
    datetime: now,
    status: "completed",
    total: 0,
    items: [
      {
        ...product,
        productId: 2,
        name: "Milk / Waste Full Cream",
        quantity: 10,
        price: 0,
        cost: 2,
      },
    ],
    paymentMethod: "Loyalty",
  },
  {
    id: 124,
    receiptNo: "PACK",
    datetime: now,
    status: "completed",
    total: 105,
    items: [
      product,
      { name: "Box", category: "Takeout Box", price: 5, cost: 3, quantity: 1 },
    ],
    paymentMethod: "Cash",
  },
  {
    id: 125,
    receiptNo: "WATER",
    datetime: now,
    status: "completed",
    total: 0,
    items: [
      {
        name: "Complimentary water",
        category: "Drinks",
        price: 0,
        cost: 0,
        quantity: 1,
      },
    ],
    paymentMethod: "Loyalty",
  },
  {
    id: 126,
    receiptNo: "VOID",
    datetime: now,
    status: "void",
    total: 999,
    items: null,
    paymentMethod: "Cash",
  },
);
await seedRows(database, "transactions", txs);
await seedRows(database, "cash_drawer", [
  { id: 1, type: "out", amount: 100, notes: "Salary November", datetime: now },
  {
    id: 2,
    type: "out",
    amount: 200,
    category: "stock_purchase",
    datetime: now,
  },
  {
    id: 3,
    type: "out",
    amount: 50,
    category: "owner_withdrawal",
    datetime: now,
  },
  { id: 4, type: "in", amount: 1000, datetime: now },
]);
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, open: false },
  mode: "test",
});
let browser,
  failReports = false,
  setupMissing = false;
const pageErrors = [];
try {
  await server.listen();
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Los_Angeles",
  });
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    if (url.origin === baseUrl) return route.continue();
    if (url.hostname !== "reports-fixture.supabase.co") return route.abort();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-range",
      "content-type": "application/json",
    };
    const respond = (status, data) =>
      route.fulfill({ status, headers, body: JSON.stringify(data) });
    if (method === "OPTIONS")
      return route.fulfill({
        status: 200,
        headers: {
          ...headers,
          "access-control-allow-methods": "GET,POST,HEAD,OPTIONS",
          "access-control-allow-headers": "*",
        },
        body: "",
      });
    if (method === "HEAD")
      return route.fulfill({
        status: 200,
        headers: { ...headers, "content-range": "0-0/1" },
        body: "",
      });
    const name = url.pathname.split("/").pop();
    try {
      if (url.pathname.includes("/rpc/")) {
        assert.match(
          name,
          /^report_(business|transactions|cash|review_item|review_product|review_cash)_v2$/,
        );
        if (setupMissing)
          return respond(404, {
            code: "PGRST202",
            message: "Reports migration missing",
          });
        if (failReports)
          return respond(503, {
            code: "503",
            message: "Database temporarily unavailable",
          });
        const params = request.postDataJSON(),
          keys = Object.keys(params);
        if (params.p_search === "slow")
          await new Promise((resolve) => setTimeout(resolve, 250));
        const result = await database.transaction(async (connection) => {
          await connection.exec("set local role anon;");
          return connection.query(
            `select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) as result`,
            Object.values(params),
          );
        });
        return respond(200, result.rows[0].result);
      }
      assert.ok(
        ["staff", "products", "cash_drawer", "ingredients"].includes(name),
      );
      if (method === "POST") {
        assert.equal(name, "cash_drawer");
        const [row] = request.postDataJSON(),
          id = Number(
            (
              await database.query(
                "select coalesce(max(id),0)+1 as id from cash_drawer",
              )
            ).rows[0].id,
          );
        await seedRows(database, "cash_drawer", [{ id, ...row }]);
        return respond(201, [{ id, ...row }]);
      }
      let rows = (
        await database.query(`select to_jsonb(t) as row from public.${name} t`)
      ).rows.map((row) => row.row);
      for (const [field, condition] of url.searchParams) {
        if (condition.startsWith("eq."))
          rows = rows.filter(
            (row) => String(row[field]) === condition.slice(3),
          );
      }
      return respond(200, rows);
    } catch (error) {
      return respond(error.code === "42501" ? 403 : 400, {
        code: error.code || "TEST",
        message: error.message,
      });
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/#/reports`);
  await page.getByText("Enter your PIN to clock in").waitFor();
  for (const digit of "2468")
    await page.getByRole("button", { name: digit, exact: true }).click();
  const metric = (name) =>
    page
      .locator(".report-metric")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .locator("strong");
  await metric("Sales").filter({ hasText: "12,205.00" }).waitFor();
  await page.getByRole('tab',{name:'Overview',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'Sales & Payments'}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('Home');
  assert.equal(await metric("Customer Transactions").innerText(), "124");
  assert.equal(
    await page.getByText("Net after Cash-outs", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("heading", { name: "Profit pending review", exact: true })
    .waitFor();
  const productsPanel = page
    .locator(".report-panel")
    .filter({
      has: page.getByRole("heading", {
        name: "Top customer products",
        exact: true,
      }),
    });
  assert.equal(
    await productsPanel
      .getByText("Milk / Waste Full Cream", { exact: true })
      .count(),
    0,
  );
  await productsPanel.locator(".report-bar-value").first().focus();
  const tooltip = productsPanel.getByRole("tooltip").first();
  await tooltip.waitFor();
  assert.equal(
    await tooltip.evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(255, 255, 255)",
  );
  await page.getByRole("tab", { name: "Data Review", exact: false }).click();
  const milkRow = page
    .getByRole("row")
    .filter({ hasText: "Milk / Waste Full Cream" })
    .first();
  await milkRow.getByRole("button", { name: "Review record" }).click();
  let dialog = page.getByRole("dialog", { name: "Review WASTE" });
  await dialog.getByLabel("Apply classification to").selectOption("product");
  await dialog
    .getByLabel("Reporting type", { exact: true })
    .selectOption("waste");
  await dialog.getByLabel("Review reason").fill("Confirmed milk waste only");
  await dialog.getByLabel("Owner PIN").fill("0000");
  await dialog
    .getByRole("button", { name: "Save reviewed correction" })
    .click();
  await dialog.getByRole("alert").filter({ hasText: "owner PIN" }).waitFor();
  await dialog.getByLabel("Owner PIN").fill("2468");
  await dialog
    .getByRole("button", { name: "Save reviewed correction" })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("row")
    .filter({ hasText: "Complimentary water" })
    .getByRole("button", { name: "Review record" })
    .click();
  dialog = page.getByRole("dialog", { name: "Review WATER" });
  await dialog
    .getByLabel("I verified that a zero cost is intentional, if applicable.")
    .check();
  await dialog
    .getByLabel("Review reason")
    .fill("Complimentary water has verified zero cost");
  await dialog.getByLabel("Owner PIN").fill("2468");
  await dialog
    .getByRole("button", { name: "Save reviewed correction" })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("link", { name: /Review 1 unclassified cash-outs/ })
    .click();
  const monthly = page.getByRole("dialog", {
    name: "Monthly Cash Movement Report",
  });
  await monthly.getByRole("button", { name: "Review category" }).click();
  dialog = page.getByRole("dialog", { name: "Review Cash-out Category" });
  assert.equal(
    await dialog.getByLabel("Cash-out category (optional)").inputValue(),
    "operating_expense",
  );
  await dialog
    .getByLabel("Review reason")
    .fill("Verified monthly salary paid from drawer");
  await dialog.getByLabel("Owner PIN").fill("2468");
  await dialog.getByRole("button", { name: "Save category" }).click();
  await dialog.waitFor({ state: "hidden" });
  await monthly.getByText("No cash records match this selection.").waitFor();
  await monthly.getByRole("button", { name: "Done", exact: true }).click();
  const original = (
    await database.query("select notes,amount from cash_drawer where id=1")
  ).rows[0];
  assert.deepEqual(original, { notes: "Salary November", amount: "100" });
  await page.evaluate(() => {
    window.location.hash = "/reports";
  });
  await metric("Sales").filter({ hasText: "12,205.00" }).waitFor();
  await page.getByRole("tab", { name: "Profit & Expenses" }).click();
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("rowheader", {
        name: "Operating profit",
        exact: true,
      }),
    })
    .getByText("₱7,162.00", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Profit pending review", { exact: true }).count(),
    0,
  );
  await page.getByRole("tab", { name: "Sales & Payments" }).click();
  await page.getByLabel("Payment method").selectOption("GCash");
  await page
    .getByRole("row")
    .filter({ hasText: "GCash" })
    .getByText("₱40.00", { exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.location.hash = "/transactions";
  });
  await page
    .getByText("Showing 126 matching records in the full period")
    .waitFor();
  const salesCard = () =>
    page
      .locator(".stat-card")
      .filter({
        has: page
          .locator(".stat-label")
          .filter({ hasText: "Full-period sales" }),
      });
  await salesCard().getByText("₱12,205.00", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Page 2 of 3").waitFor();
  await salesCard().getByText("₱12,205.00", { exact: true }).waitFor();
  await page.getByLabel("Search receipts").fill("R121");
  await page
    .getByText("Showing 1 matching record in the full period")
    .waitFor();
  await page.getByLabel("Payment method").selectOption("GCash");
  await page.getByText("GCash portions: ₱40.00", { exact: true }).waitFor();
  await page.getByLabel("Search receipts").fill("slow");
  await page.getByLabel("Search receipts").fill("R121");
  await page
    .getByText("Showing 1 matching record in the full period")
    .waitFor();
  await page.getByLabel("Search receipts").fill("");
  await page.getByLabel("Payment method").selectOption("All");
  await page
    .getByText("Showing 126 matching records in the full period")
    .waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export all matching receipts" })
    .click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.transactions.length, 126);
  assert.equal(exported.totals.salesCents, 1220500);
  failReports = true;
  await page
    .getByRole("button", { name: "Refresh report", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Report could not be verified" })
    .waitFor();
  assert.equal(await page.locator(".stat-card").count(), 0);
  failReports = false;
  setupMissing = true;
  await page
    .getByRole("button", { name: "Refresh report", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Reports update needs database setup" })
    .waitFor();
  setupMissing = false;
  await page.evaluate(() => {
    window.location.hash = "/reports";
  });
  await metric("Sales").filter({ hasText: "12,205.00" }).waitFor();
  await mkdir(".tmp", { recursive: true });
  await page.screenshot({
    path: ".tmp/reports-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await metric("Sales").filter({ hasText: "12,205.00" }).waitFor();
  await page.screenshot({
    path: ".tmp/reports-mobile.png",
    animations: "disabled",
  });
  const mobileLayout = await page.locator('.reports-surface').evaluate(node => ({ viewport: innerWidth, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(mobileLayout.right <= mobileLayout.viewport + 2);
  assert.equal(
    await page
      .locator(".reports-surface")
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 2),
    true,
  );
  await page.evaluate(()=>{window.location.hash='/transactions';});
  await page.getByText('Showing 126 matching records in the full period').waitFor();
  assert.ok(await page.locator('.reports-surface').evaluate(node=>node.getBoundingClientRect().right<=innerWidth+2));
  await page.evaluate(()=>{window.location.hash='/cash';});
  await page.getByRole('button',{name:'Cash Out',exact:true}).click();
  let cashForm=page.getByRole('dialog',{name:'Cash Out',exact:true});
  await cashForm.getByLabel('Amount (PHP)').fill('25');
  await cashForm.getByLabel('Notes',{exact:true}).fill('Salary');
  assert.equal(await cashForm.getByLabel('Cash-out category (optional)').inputValue(),'operating_expense');
  await cashForm.getByLabel('Cash-out category (optional)').selectOption('owner_withdrawal');
  await cashForm.getByLabel('Notes',{exact:true}).fill('Internet bill');
  assert.equal(await cashForm.getByLabel('Cash-out category (optional)').inputValue(),'owner_withdrawal');
  await cashForm.getByRole('button',{name:'Save',exact:true}).click();
  await cashForm.waitFor({state:'hidden'});
  const created=(await database.query('select category,notes,amount from cash_drawer where id=5')).rows[0];
  assert.deepEqual(created,{category:'owner_withdrawal',notes:'Internet bill',amount:'25'});
  await page.getByRole('button',{name:'Cash In',exact:true}).click();
  cashForm=page.getByRole('dialog',{name:'Cash In',exact:true});
  assert.equal(await cashForm.locator('select').count(),0);
  await cashForm.getByLabel('Amount (PHP)').fill('50');await cashForm.getByLabel('Notes',{exact:true}).fill('Opening float');
  await cashForm.getByRole('button',{name:'Save',exact:true}).click();await cashForm.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Monthly Reports',exact:true}).click();
  const mobileMonthly=page.getByRole('dialog',{name:'Monthly Cash Movement Report'});
  await mobileMonthly.getByRole('heading',{name:/Cash records/}).waitFor();
  assert.ok(await mobileMonthly.evaluate(node=>node.getBoundingClientRect().right<=innerWidth+2));
  await mobileMonthly.getByRole('button',{name:'Done',exact:true}).focus();await page.keyboard.press('Tab');
  assert.ok(await mobileMonthly.evaluate(node=>node.contains(document.activeElement)));
  await page.screenshot({path:'.tmp/reports-cash-mobile.png',animations:'disabled'});
  await page.keyboard.press('Escape');await mobileMonthly.waitFor({state:'hidden'});
  assert.deepEqual(pageErrors, []);
  console.log(
    "PASS: SQL-backed browser workflow, pending profit, waste/product review, cost review, owner PIN, cash category history, exact profit, split portions, full-period pagination/search/export, stale requests, setup/failure gates, mobile and readable tooltip.",
  );
} catch (error) {
  await mkdir(".tmp", { recursive: true });
  const page = browser?.contexts()[0]?.pages()[0];
  if (page)
    await page
      .screenshot({ path: ".tmp/reports-browser-failure.png" })
      .catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  await server.close();
  await database.close();
}
