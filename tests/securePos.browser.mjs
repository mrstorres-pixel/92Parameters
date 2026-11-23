import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import { createSecureDb, prepareTestPins, sql } from "./helpers/secureDb.js";
import { fixtureAdmin } from "./helpers/fixtureAdmin.js";
import { createHandler } from "../server/backend.js";

process.env.VITE_SECURE_BACKEND = "true";
process.env.VITE_SUPABASE_URL = "https://fixture.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "fixture-key";
process.env.SUPABASE_URL = "https://fixture.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-key";
process.env.SECURE_CUTOVER_ACTIVE = "true";
const db = await createSecureDb();
await db.exec(
  `alter table products add column "isAvailable" boolean default true;`,
);
await prepareTestPins(db);
await db.exec(await sql("20261123123554_secure_pos_cutover.sql"));
const fixture = fixtureAdmin(db),
  handler = createHandler({
    adminFactory: () => fixture.admin,
    secret: () => "test-pepper",
    fetcher: fixture.fetcher,
  });
const server = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "isolated-secure-api",
      configureServer(server) {
        server.middlewares.use("/api", (req, res) => {
          const set = res.setHeader.bind(res);
          res.setHeader = (name, value) =>
            set(
              name,
              name.toLowerCase() === "set-cookie"
                ? value.replace("; Secure", "")
                : value,
            ); // HTTP fixture only; production cookie remains Secure.
          handler(req, res);
        });
      },
    },
  ],
});
let browser;
const errors = [];
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const isWebkit = process.env.REPORT_TEST_BROWSER === "webkit";
  browser = await (isWebkit ? webkit : chromium).launch({
    headless: true,
    executablePath: isWebkit
      ? process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
      : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  async function tablet(pin) {
    const context = await browser.newContext({
      viewport: { width: 820, height: 1180 },
      hasTouch: true,
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await context.addInitScript(() => {
      const getUserMedia = async () => {
        if (window.denyCamera)
          throw new DOMException("Denied", "NotAllowedError");
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d");
        const draw = () => {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 640, 480);
          ctx.fillStyle = "black";
          ctx.font = "30px sans-serif";
          ctx.fillText("TEST PAYMENT APPROVED", 40, 100);
        };
        draw();
        // Playwright's Windows WebKit build has no canvas.captureStream. Supply
        // the camera frame at the media boundary; the app still captures/uploads JPEG.
        if (!canvas.captureStream) {
          const descriptor = Object.getOwnPropertyDescriptor(
            HTMLMediaElement.prototype,
            "srcObject",
          );
          Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
            configurable: true,
            get() {
              return this._fixtureStream;
            },
            set(value) {
              this._fixtureStream = value;
            },
          });
          Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
            configurable: true,
            get() {
              return 640;
            },
          });
          Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
            configurable: true,
            get() {
              return 480;
            },
          });
          HTMLMediaElement.prototype.play = async () => {};
          const original = CanvasRenderingContext2D.prototype.drawImage;
          CanvasRenderingContext2D.prototype.drawImage = function (
            source,
            ...args
          ) {
            return original.call(
              this,
              source instanceof HTMLVideoElement ? canvas : source,
              ...args,
            );
          };
          return { getTracks: () => [{ stop() {} }] };
        }
        const stream = canvas.captureStream(10);
        const timer = setInterval(draw, 100);
        stream
          .getTracks()[0]
          .addEventListener("ended", () => clearInterval(timer));
        return stream;
      };
      if (!navigator.mediaDevices)
        Object.defineProperty(navigator, "mediaDevices", { value: {} });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: getUserMedia,
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/#/pos`);
    await page.getByText("Enter your PIN to clock in").waitFor();
    for (const digit of pin)
      await page.getByRole("button", { name: digit, exact: true }).click();
    return page;
  }
  const counter = await tablet("2468"),
    kitchen = await tablet("9753");
  await kitchen
    .getByRole("heading", { name: "Kitchen tickets", exact: true, level: 1 })
    .waitFor();
  assert.equal(
    await kitchen.getByRole("link", { name: "Reports", exact: true }).count(),
    0,
  );
  assert.equal(
    await kitchen.evaluate(
      async () => (await fetch("/api/data/transactions")).status,
    ),
    403,
  );
  const foodName = "Food with a long preparation note";
  await counter.locator(".product-card").filter({ hasText: foodName }).click();
  await counter.locator(".product-card").filter({ hasText: "Coffee" }).click();
  await counter
    .locator(".cart-item")
    .filter({ hasText: foodName })
    .getByPlaceholder("Ex: less ice, no sugar, separate sauce...")
    .fill("No onions; sauce separate");
  counter.once("dialog", (dialog) => dialog.accept("Table 7"));
  await counter
    .getByRole("button", { name: "Send to Kitchen", exact: true })
    .click();
  await kitchen
    .getByRole("heading", { name: "Table 7", exact: true })
    .waitFor();
  assert.equal(
    await kitchen.getByText("1 × Coffee", { exact: true }).count(),
    0,
  );
  await kitchen
    .getByText("No onions; sauce separate", { exact: true })
    .waitFor();
  await counter
    .getByRole("button", { name: "Send kitchen updates", exact: true })
    .click();
  assert.equal(
    (await db.query("select count(*) as n from kitchen_tickets")).rows[0].n,
    1,
  );
  await counter.getByRole("button", { name: /Charge ₱250/ }).click();
  const payment = counter.getByRole("dialog", { name: "Payment", exact: true });
  await payment.getByRole("button", { name: "Card", exact: true }).click();
  assert.ok(
    await payment
      .getByRole("button", {
        name: "Complete payment & send food",
        exact: true,
      })
      .isDisabled(),
  );
  await counter.evaluate(() => (window.denyCamera = true));
  await payment
    .getByRole("button", { name: "Open camera", exact: true })
    .click();
  await payment
    .getByRole("alert")
    .filter({ hasText: "Allow camera access" })
    .waitFor();
  await counter.evaluate(() => (window.denyCamera = false));
  await payment
    .getByRole("button", { name: "Open camera", exact: true })
    .click();
  await counter.waitForFunction(
    () => document.querySelector(".payment-proof video")?.videoWidth > 0,
  );
  await payment
    .getByRole("button", { name: "Take photo", exact: true })
    .click();
  await payment
    .getByRole("button", { name: "Use this photo", exact: true })
    .click();
  await payment
    .getByText("Photo uploaded for this payment portion ✓", { exact: true })
    .waitFor();
  // A changed amount discards the previous proof. Both split portions require
  // new photos; a failed upload and a lost checkout response remain retryable.
  await payment
    .locator(".payment-split-row")
    .filter({ hasText: "Card" })
    .locator("input")
    .fill("100");
  await payment
    .getByRole("button", { name: "Bank Transfer", exact: true })
    .click();
  const confirm = payment.getByRole("button", {
    name: "Complete payment & send food",
    exact: true,
  });
  assert.ok(await confirm.isDisabled());
  for (const method of ["Card", "Bank Transfer"]) {
    const section = payment
      .locator(".payment-proof")
      .filter({ hasText: `${method} · payment photo required` });
    await section
      .getByRole("button", { name: "Open camera", exact: true })
      .click();
    await counter.waitForFunction(
      () => document.querySelector(".payment-proof video")?.videoWidth > 0,
    );
    await section
      .getByRole("button", { name: "Take photo", exact: true })
      .click();
    if (method === "Card") {
      await counter.route(
        "**/api/proofs",
        (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ message: "Upload offline; retry." }),
          }),
        { times: 1 },
      );
      await section
        .getByRole("button", { name: "Use this photo", exact: true })
        .click();
      await section
        .getByRole("alert")
        .filter({ hasText: "Upload offline" })
        .waitFor();
      assert.ok(await confirm.isDisabled());
    }
    await section
      .getByRole("button", { name: "Use this photo", exact: true })
      .click();
    await section.getByRole("status").waitFor();
  }
  await counter.route(
    "**/api/checkout",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await confirm.click();
  await counter.waitForFunction(
    () =>
      document.querySelector('[role="dialog"] .modal-footer button')
        ?.disabled === false,
  );
  assert.equal(
    (await db.query("select count(*) n from transactions")).rows[0].n,
    1,
  );
  await confirm.click();
  await payment.waitFor({ state: "hidden" });
  assert.equal(
    (await db.query("select count(*) as n from transactions")).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select count(*) as n from kitchen_tickets")).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select count(*) n from payment_proofs where status='attached'",
      )
    ).rows[0].n,
    2,
  );
  await kitchen.getByRole("checkbox").click();
  await kitchen.waitForFunction(
    () => document.querySelector(".kitchen-item input")?.checked,
  );
  await kitchen
    .getByRole("button", { name: "Complete ticket", exact: true })
    .click();
  await kitchen
    .getByText("No tickets in this view.", { exact: true })
    .waitFor();
  await kitchen
    .getByRole("button", { name: "Completed / cancelled", exact: true })
    .click();
  await kitchen
    .getByRole("heading", { name: "Table 7", exact: true })
    .waitFor();
  await mkdir(".tmp", { recursive: true });
  await kitchen.context().setOffline(true);
  await kitchen
    .getByRole("status")
    .filter({ hasText: "Disconnected" })
    .waitFor();
  assert.ok(
    await kitchen
      .getByRole("button", { name: "Reopen ticket", exact: true })
      .isDisabled(),
  );
  await kitchen.context().setOffline(false);
  await kitchen.getByRole("status").filter({ hasText: /^Connected · live updates/ }).waitFor();
  assert.ok(await kitchen.getByRole('button',{name:'Reopen ticket',exact:true}).isEnabled());
  const business = await counter.evaluate(async () => {
    const response = await fetch("/api/data/rpc/report_business_v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_start_ms: 0,
        p_end_exclusive_ms: 9999999999999,
      }),
    });
    return { status: response.status, data: await response.json() };
  });
  assert.equal(business.status, 200, JSON.stringify(business.data));
  assert.equal(business.data.totals.salesCents, 25000);
  await kitchen.screenshot({
    path: ".tmp/kitchen-portrait.png",
    animations: "disabled",
  });
  await kitchen.setViewportSize({ width: 1180, height: 820 });
  await kitchen.screenshot({
    path: ".tmp/kitchen-landscape.png",
    animations: "disabled",
  });
  assert.ok(
    await kitchen
      .locator(".kitchen-surface")
      .evaluate((node) => node.getBoundingClientRect().right <= innerWidth + 2),
  );
  assert.deepEqual(errors, []);
  await counter
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await counter.locator(".product-card").filter({ hasText: foodName }).click();
  counter.once("dialog", (dialog) => dialog.accept("Table 8"));
  await counter
    .getByRole("button", { name: "Send to Kitchen", exact: true })
    .click();
  await kitchen
    .getByRole("button", { name: "Active tickets", exact: true })
    .click();
  await kitchen
    .getByRole("heading", { name: "Table 8", exact: true })
    .waitFor();
  counter.once("dialog", (dialog) =>
    dialog.accept("Customer left before payment"),
  );
  await counter
    .getByRole("button", { name: "Cancel order", exact: true })
    .click();
  await kitchen
    .getByRole("button", { name: "Acknowledge cancellation", exact: true })
    .click();
  await kitchen
    .getByText("No tickets in this view.", { exact: true })
    .waitFor();
  assert.equal(
    (await db.query("select count(*) n from transactions")).rows[0].n,
    1,
  );
  console.log(
    "PASS: two real API sessions, kitchen isolation, fresh camera requirement, private upload, atomic checkout, no duplicate food, and kitchen completion.",
  );
} catch (e) {
  await mkdir(".tmp", { recursive: true });
  for (const [index, page] of (browser?.contexts() || [])
    .flatMap((context) => context.pages())
    .entries())
    await page
      .screenshot({
        path: `.tmp/secure-failure-${index}.png`,
        animations: "disabled",
      })
      .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  await server.close();
  await db.close();
}
