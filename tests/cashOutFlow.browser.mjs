import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
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
  browser = await (
    process.env.REPORT_TEST_BROWSER === "webkit" ? webkit : chromium
  ).launch({
    headless: true,
    ...((
      process.env.REPORT_TEST_BROWSER === "webkit"
        ? process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
        : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    )
      ? {
          executablePath:
            process.env.REPORT_TEST_BROWSER === "webkit"
              ? process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
              : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    hasTouch: true,
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
  page.setDefaultTimeout(15000);
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
  const assertTabletLayout = async () => {
    const result = await page.locator(".reports-surface").evaluate((node) => {
      const visible = (element) =>
        element.getClientRects().length &&
        getComputedStyle(element).visibility !== "hidden";
      const controls = [
        ...node.querySelectorAll(
          'button, select, input:not([type="checkbox"]), summary, .report-links a',
        ),
      ].filter(visible);
      return {
        viewport: innerWidth,
        right: node.getBoundingClientRect().right,
        width: node.clientWidth,
        scroll: node.scrollWidth,
        undersized: controls
          .filter((element) => {
            const r = element.getBoundingClientRect();
            return r.height < 43.5 || r.width < 43.5;
          })
          .map(
            (element) =>
              element.textContent.trim() || element.getAttribute("aria-label"),
          ),
        smallText: [
          ...node.querySelectorAll(
            "p, label, th, td, small, summary, .stat-label, .report-bar-name, .report-bar-value",
          ),
        ]
          .filter(visible)
          .filter(
            (element) => parseFloat(getComputedStyle(element).fontSize) < 14,
          )
          .map((element) => element.textContent.trim()),
        lowContrast: (() => {
          const rgb = (color) => color.match(/[\d.]+/g)?.map(Number);
          const luminance = (channels) =>
            channels
              .slice(0, 3)
              .map((v) => {
                v /= 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              })
              .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
          return [...node.querySelectorAll("*")]
            .filter(visible)
            .filter(
              (el) =>
                !el.closest(".report-sr-only") &&
                !el.disabled &&
                [...el.childNodes].some(
                  (child) => child.nodeType === 3 && child.textContent.trim(),
                ),
            )
            .flatMap((el) => {
              const color = rgb(getComputedStyle(el).color);
              let parent = el,
                background;
              while (parent) {
                const candidate = rgb(getComputedStyle(parent).backgroundColor);
                if (candidate && (candidate.length < 4 || candidate[3] === 1)) {
                  background = candidate;
                  break;
                }
                parent = parent.parentElement;
              }
              if (!color || !background) return [];
              const a = luminance(color),
                b = luminance(background),
                ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
              return ratio < 4.5
                ? [{ text: el.textContent.trim().slice(0, 80), ratio }]
                : [];
            });
        })(),
      };
    });
    assert.ok(result.right <= result.viewport + 2, JSON.stringify(result));
    assert.ok(result.scroll <= result.width + 2, JSON.stringify(result));
    assert.deepEqual(
      result.undersized,
      [],
      "Touch controls must be at least 44px",
    );
    assert.deepEqual(
      result.smallText,
      [],
      "Report labels must be at least 14px",
    );
    assert.deepEqual(
      result.lowContrast,
      [],
      "Report text must meet 4.5:1 contrast",
    );
  };
  await metric("Sales").filter({ hasText: "12,205.00" }).waitFor();
  await page.getByRole("tab", { name: "Overview", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "Sales & Payments" })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Home");
  assert.equal(await metric("Customer Transactions").innerText(), "124");
  assert.equal(
    await page.getByText("Net after Cash-outs", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("heading", { name: "Profit pending review", exact: true })
    .waitFor();
  const productsPanel = page.locator(".report-panel").filter({
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
  assert.ok(
    await productsPanel.locator(".report-bar-value").first().isVisible(),
  );
  assert.equal(
    await productsPanel.getByRole("tooltip").count(),
    0,
    "Exact chart values do not require hover",
  );
  await page
    .getByRole("button", { name: "View Sales records", exact: true })
    .click();
  let sources = page.getByRole("dialog", {
    name: "Sales — source records",
    exact: true,
  });
  await sources
    .locator(".report-records-summary strong")
    .filter({ hasText: "₱12,205.00" })
    .waitFor();
  await sources
    .getByText("125 contributing records · totals include every page", {
      exact: true,
    })
    .waitFor();
  await sources
    .getByRole("button", { name: "Next records", exact: true })
    .click();
  await sources.getByText("Page 2 of 3", { exact: true }).waitFor();
  await sources.getByLabel("Search source records").fill(longName);
  await sources
    .getByText("123 matching source records", { exact: true })
    .waitFor();
  await sources.getByLabel("Search source records").fill("PACK");
  await sources
    .getByText("1 matching source records", { exact: true })
    .waitFor();
  await sources.getByText("Details for PACK", { exact: true }).click();
  await sources.getByRole("rowheader", { name: "Box", exact: true }).waitFor();
  await sources
    .getByRole("button", { name: "Close records", exact: true })
    .click();
  await page.getByRole("button", { name: "7 Days", exact: true }).click();
  await metric("Sales").filter({ hasText: "12,205.00" }).waitFor();
  const sharedPeriod = await page.locator(".report-period-label").innerText();
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page
    .getByText("Showing 126 matching records in the full period")
    .waitFor();
  assert.equal(
    await page.locator(".report-period-label").innerText(),
    sharedPeriod,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "7 Days", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("button", {
      name: "View transaction sales records",
      exact: true,
    })
    .click();
  sources = page.getByRole("dialog", {
    name: "Sales — source records",
    exact: true,
  });
  await sources
    .getByText("125 contributing records · totals include every page", {
      exact: true,
    })
    .waitFor();
  await sources
    .locator(".report-records-summary strong")
    .filter({ hasText: "₱12,205.00" })
    .waitFor();
  await sources
    .getByRole("button", { name: "Close records", exact: true })
    .click();
  await database.query("update transactions set status='void' where id=1");
  await page
    .getByRole("button", {
      name: "View transaction sales records",
      exact: true,
    })
    .click();
  sources = page.getByRole("dialog", {
    name: "Sales — source records",
    exact: true,
  });
  await sources
    .getByText(/Records have changed since the summary loaded/)
    .waitFor();
  await sources
    .locator(".report-records-summary strong")
    .filter({ hasText: "₱12,105.00" })
    .waitFor();
  const summaryRefresh = page.waitForResponse(
    (response) =>
      response.url().endsWith("/rpc/report_transactions_v2") &&
      response.request().postDataJSON()?.p_limit === 50 &&
      response.status() === 200,
  );
  await sources
    .getByRole("button", { name: "Refresh summary", exact: true })
    .click();
  await summaryRefresh;
  await page
    .locator(".stat-card")
    .filter({ hasText: "Full-period sales" })
    .getByText("₱12,105.00", { exact: true })
    .waitFor();
  await database.query("update transactions set status='completed' where id=1");
  const restoredSummary = page.waitForResponse(
    (response) =>
      response.url().endsWith("/rpc/report_transactions_v2") &&
      response.request().postDataJSON()?.p_limit === 50 &&
      response.status() === 200,
  );
  await page
    .getByRole("button", { name: "Refresh report", exact: true })
    .click();
  await restoredSummary;
  await page
    .locator(".stat-card")
    .filter({ hasText: "Full-period sales" })
    .getByText("₱12,205.00", { exact: true })
    .waitFor();
  failReports = true;
  await page
    .getByRole("button", {
      name: "View transaction sales records",
      exact: true,
    })
    .click();
  sources = page.getByRole("dialog", {
    name: "Sales — source records",
    exact: true,
  });
  await sources
    .getByRole("heading", { name: "Report could not be verified", exact: true })
    .waitFor();
  assert.equal(await sources.locator(".report-source-record").count(), 0);
  await sources
    .getByRole("button", { name: "Close records", exact: true })
    .click();
  failReports = false;
  await page.getByRole("link", { name: "Cash", exact: true }).click();
  await page.getByRole("heading", { name: /Cash records/ }).waitFor();
  await page.locator(".cash-drawer-metrics").waitFor();
  assert.equal(
    await page.locator(".report-period-label").innerText(),
    sharedPeriod,
  );
  // Daily work comes first; support information opens only when requested.
  assert.equal(await page.locator(".cash-drawer-heading").count(), 1);
  assert.equal(await page.locator(".report-links").count(), 0);
  assert.equal(
    await page.locator(".cash-drawer-details").getAttribute("open"),
    null,
  );
  assert.equal(
    await page.getByLabel("Search cash records", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Search & filters", exact: true })
    .click();
  await page
    .getByLabel("Search cash records", { exact: true })
    .pressSequentially("Salary");
  await page
    .getByRole("heading", { name: "Cash records (1 matching)", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Search cash records", { exact: true }).inputValue(),
    "Salary",
  );
  await page
    .locator(".cash-drawer-metrics")
    .getByText("₱350.00", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Search & filters (1)", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Search cash records", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Cash records (4 matching)", exact: true })
    .waitFor();
  await page
    .locator(".report-metrics")
    .getByRole("button", { name: "View Total cash out records", exact: true })
    .click();
  sources = page.getByRole("dialog", {
    name: "Total cash out — source records",
    exact: true,
  });
  await sources
    .locator(".report-records-summary strong")
    .filter({ hasText: "₱350.00" })
    .waitFor();
  assert.equal(await sources.locator(".report-source-record").count(), 3);
  await sources
    .getByRole("button", { name: "Close records", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose drawer period", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  const periodEnd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
  }).format(new Date(now));
  const periodStart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
  }).format(new Date(now - 6 * 86400000));
  await page.getByLabel("From", { exact: true }).fill(periodStart);
  await page.getByLabel("To", { exact: true }).fill(periodEnd);
  await page
    .getByRole("dialog", { name: "Choose drawer period", exact: true })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page.getByRole("link", { name: "Business", exact: true }).click();
  await metric("Sales").filter({ hasText: "12,205.00" }).waitFor();
  assert.equal(
    await page.getByLabel("From", { exact: true }).inputValue(),
    periodStart,
  );
  assert.equal(
    await page.getByLabel("To", { exact: true }).inputValue(),
    periodEnd,
  );
  const savedPeriod = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("92parameters-report-period")),
  );
  assert.equal(savedPeriod.state.customStart, periodStart);
  assert.equal(savedPeriod.state.range, "custom");
  assert.deepEqual(Object.keys(savedPeriod.state).sort(), [
    "customEnd",
    "customStart",
    "lookbackAmount",
    "lookbackUnit",
    "range",
  ]);
  await page.reload();
  await page.getByText("Enter your PIN to clock in").waitFor();
  for (const digit of "2468")
    await page.getByRole("button", { name: digit, exact: true }).click();
  await metric("Sales").filter({ hasText: "12,205.00" }).waitFor();
  assert.equal(
    await page.getByLabel("From", { exact: true }).inputValue(),
    periodStart,
  );
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await mkdir(".tmp", { recursive: true });
  await page.setViewportSize({ width: 820, height: 1180 });
  await assertTabletLayout();
  await page
    .getByRole("button", { name: "View Sales records", exact: true })
    .tap();
  sources = page.getByRole("dialog", {
    name: "Sales — source records",
    exact: true,
  });
  await sources
    .locator(".report-records-summary strong")
    .filter({ hasText: "₱12,205.00" })
    .waitFor();
  await assertTabletLayout();
  await page.screenshot({
    path: ".tmp/reports-tablet-source-records.png",
    animations: "disabled",
  });
  await sources
    .getByRole("button", { name: "Close records", exact: true })
    .tap();
  await page.screenshot({
    path: ".tmp/reports-tablet-pending.png",
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Profit & Expenses" }).tap();
  await page.setViewportSize({ width: 1180, height: 820 });
  assert.equal(
    await page
      .getByRole("tab", { name: "Profit & Expenses" })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.getByText("Profit pending review", { exact: true }).waitFor();
  await assertTabletLayout();
  await page.screenshot({
    path: ".tmp/reports-tablet-profit-pending.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "View Operating profit records", exact: true })
    .click();
  sources = page.getByRole("dialog", {
    name: "Operating profit — source records",
    exact: true,
  });
  await sources.getByText(/Profit pending review/).waitFor();
  assert.equal(
    await sources.locator(".report-records-summary strong").innerText(),
    "Needs review",
  );
  await sources
    .getByRole("button", { name: "Close records", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  const monthly = page.locator(".reports-surface");
  await monthly.getByRole("heading", { name: /Cash records/ }).waitFor();
  await monthly
    .locator(".cash-category-column")
    .getByRole("button", { name: "Review category" })
    .filter({ visible: true })
    .click();
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
  await page
    .getByRole("button", {
      name: "View Total operating expenses records",
      exact: true,
    })
    .click();
  sources = page.getByRole("dialog", {
    name: "Total operating expenses — source records",
    exact: true,
  });
  await sources
    .locator(".report-records-summary strong")
    .filter({ hasText: "₱120.00" })
    .waitFor();
  assert.equal(await sources.locator(".report-source-record").count(), 2);
  await sources
    .getByText("Milk / Waste Full Cream · Waste cost", { exact: true })
    .waitFor();
  await sources
    .locator(".report-source-record > p")
    .filter({ hasText: "Salary November" })
    .waitFor();
  await sources
    .getByRole("button", { name: "Close records", exact: true })
    .click();
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
    page.locator(".stat-card").filter({
      has: page.locator(".stat-label").filter({ hasText: "Full-period sales" }),
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
  for (const viewport of [
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
  ]) {
    const orientation =
      viewport.width < viewport.height ? "portrait" : "landscape";
    await page.setViewportSize(viewport);
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await assertTabletLayout();
    const columns = await page
      .locator(".report-metrics")
      .evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
      );
    assert.equal(columns, orientation === "portrait" ? 2 : 4);
    await page.screenshot({
      path: `.tmp/reports-tablet-overview-${orientation}.png`,
      animations: "disabled",
    });
    await page.getByRole("tab", { name: "Profit & Expenses" }).tap();
    await assertTabletLayout();
    await page.screenshot({
      path: `.tmp/reports-tablet-profit-${orientation}.png`,
      animations: "disabled",
    });
    await page.getByRole("link", { name: "Transactions", exact: true }).tap();
    await page
      .getByText("Showing 126 matching records in the full period")
      .waitFor();
    await page.getByLabel("Search receipts").fill("R121");
    await page.getByLabel("Payment method").selectOption("GCash");
    await page.getByText("GCash portions: ₱40.00", { exact: true }).waitFor();
    await page.setViewportSize({
      width: viewport.height,
      height: viewport.width,
    });
    assert.equal(await page.getByLabel("Search receipts").inputValue(), "R121");
    assert.equal(await page.getByLabel("Payment method").inputValue(), "GCash");
    await page.setViewportSize(viewport);
    await assertTabletLayout();
    await page
      .getByRole("button", { name: "Details for R121", exact: true })
      .tap();
    const receiptDialog = page.getByRole("dialog", {
      name: "Transaction R121",
      exact: true,
    });
    await receiptDialog.waitFor();
    await receiptDialog
      .getByRole("button", { name: "View Receipt", exact: true })
      .waitFor();
    await receiptDialog
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.screenshot({
      path: `.tmp/reports-tablet-transactions-${orientation}.png`,
      animations: "disabled",
    });
    await page.getByRole("link", { name: "Cash", exact: true }).tap();
    await page.getByRole("heading", { name: /Cash records/ }).waitFor();
    await page.locator(".cash-drawer-metrics").waitFor();
    await assertTabletLayout();
    await page.screenshot({
      path: `.tmp/reports-tablet-cash-${orientation}.png`,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Monthly Reports", exact: true })
      .tap();
    const cashDialog = page.getByRole("dialog", {
      name: "Monthly Cash Movement Report",
    });
    await cashDialog.getByRole("heading", { name: /Cash records/ }).waitFor();
    await cashDialog
      .locator(".report-metrics")
      .getByRole("button", { name: "View Total cash out records", exact: true })
      .tap();
    sources = page.getByRole("dialog", {
      name: "Total cash out — source records",
      exact: true,
    });
    await sources
      .locator(".report-records-summary strong")
      .filter({ hasText: "₱350.00" })
      .waitFor();
    await assertTabletLayout();
    await page.screenshot({
      path: `.tmp/reports-source-monthly-${orientation}.png`,
      animations: "disabled",
    });
    assert.ok(
      await sources.evaluate(
        (node) => node.getBoundingClientRect().bottom <= innerHeight + 2,
      ),
    );
    await page.keyboard.press("Escape");
    await sources.waitFor({ state: "hidden" });
    assert.ok(await cashDialog.isVisible());
    await assertTabletLayout();
    await page.screenshot({
      path: `.tmp/reports-tablet-monthly-${orientation}.png`,
      animations: "disabled",
    });
    await cashDialog.getByRole("button", { name: "Done", exact: true }).tap();
    await page.getByRole("link", { name: "Business", exact: true }).tap();
    await metric("Sales").filter({ hasText: "12,205.00" }).waitFor();
  }
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await assertTabletLayout();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  const mobileLayout = await page
    .locator(".reports-surface")
    .evaluate((node) => ({
      viewport: innerWidth,
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      width: node.clientWidth,
      scroll: node.scrollWidth,
    }));
  assert.ok(mobileLayout.right <= mobileLayout.viewport + 2);
  assert.equal(
    await page
      .locator(".reports-surface")
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 2),
    true,
  );
  await page.evaluate(() => {
    window.location.hash = "/transactions";
  });
  await page
    .getByText("Showing 126 matching records in the full period")
    .waitFor();
  assert.ok(
    await page
      .locator(".reports-surface")
      .evaluate((node) => node.getBoundingClientRect().right <= innerWidth + 2),
  );
  await page.evaluate(() => {
    window.location.hash = "/cash";
  });
  await page.getByRole("button", { name: "Cash Out", exact: true }).click();
  let cashForm = page.getByRole("dialog", { name: "Cash Out", exact: true });
  await cashForm.getByLabel("Amount (PHP)").fill("25");
  await cashForm.getByLabel("Notes", { exact: true }).fill("Salary");
  await page.setViewportSize({ width: 1180, height: 820 });
  assert.equal(await cashForm.getByLabel("Amount (PHP)").inputValue(), "25");
  assert.equal(
    await cashForm.getByLabel("Notes", { exact: true }).inputValue(),
    "Salary",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await cashForm.getByLabel("Cash-out category (optional)").inputValue(),
    "operating_expense",
  );
  await cashForm
    .getByLabel("Cash-out category (optional)")
    .selectOption("owner_withdrawal");
  await cashForm.getByLabel("Notes", { exact: true }).fill("Internet bill");
  assert.equal(
    await cashForm.getByLabel("Cash-out category (optional)").inputValue(),
    "owner_withdrawal",
  );
  await cashForm.getByRole("button", { name: "Save", exact: true }).click();
  await cashForm.waitFor({ state: "hidden" });
  const created = (
    await database.query(
      "select category,notes,amount from cash_drawer where id=5",
    )
  ).rows[0];
  assert.deepEqual(created, {
    category: "owner_withdrawal",
    notes: "Internet bill",
    amount: "25",
  });
  await page.getByRole("button", { name: "Cash In", exact: true }).click();
  cashForm = page.getByRole("dialog", { name: "Cash In", exact: true });
  assert.equal(await cashForm.locator("select").count(), 0);
  await cashForm.getByLabel("Amount (PHP)").fill("50");
  await cashForm.getByLabel("Notes", { exact: true }).fill("Opening float");
  await cashForm.getByRole("button", { name: "Save", exact: true }).click();
  await cashForm.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Monthly Reports", exact: true })
    .click();
  const mobileMonthly = page.getByRole("dialog", {
    name: "Monthly Cash Movement Report",
  });
  await mobileMonthly.getByRole("heading", { name: /Cash records/ }).waitFor();
  assert.ok(
    await mobileMonthly.evaluate(
      (node) => node.getBoundingClientRect().right <= innerWidth + 2,
    ),
  );
  await mobileMonthly
    .getByRole("button", { name: "Done", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  assert.ok(
    await mobileMonthly.evaluate((node) =>
      node.contains(document.activeElement),
    ),
  );
  await page.screenshot({
    path: ".tmp/reports-cash-mobile.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await mobileMonthly.waitFor({ state: "hidden" });
  // Additional UI states use only the isolated fixture database.
  await seedRows(database, "cash_drawer", [
    {
      id: 99,
      type: "out",
      amount: 20000,
      category: "operating_expense",
      notes: "Large operating bill",
      datetime: now,
    },
  ]);
  await page.getByRole("link", { name: "Business", exact: true }).click();
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
    .getByText("₱-12,838.00", { exact: true })
    .waitFor();
  await assertTabletLayout();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByLabel("More periods").selectOption("yesterday");
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await metric("Sales").filter({ hasText: "₱0.00" }).waitFor();
  await page.getByText("No records for this selection.").first().waitFor();
  await assertTabletLayout();
  assert.doesNotMatch(
    await page.locator('meta[name="viewport"]').getAttribute("content"),
    /user-scalable=no|maximum-scale=1/,
  );
  assert.deepEqual(pageErrors, []);
  console.log(
    "PASS: SQL-backed reporting, reviews, exact profit, complete exports, failure gates, tablet portrait/landscape, touch targets, rotation state, permanent chart values, mobile and modals.",
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
