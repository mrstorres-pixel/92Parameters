import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { createSecureDb } from "./helpers/secureDb.js";
import { fixtureAdmin } from "./helpers/fixtureAdmin.js";
import { createHandler, validateCheckout } from "../server/backend.js";
import { cashierBounds, cashierSafe } from "../server/cashierPolicy.js";
import { createTicketTracker } from "../src/utils/kitchenAlerts.js";
import {
  isRetiredMilkProduct,
  ACTIVE_PAYMENT_METHODS,
} from "../src/utils/posRules.js";
import { retireMilkProducts } from "../server/milkRetirement.js";

test("ticket arrival baseline, duplicates, revisions, reconnect and reopen never repeat alerts", () => {
  const receive = createTicketTracker();
  assert.deepEqual(receive([{ id: "old", status: "new" }]), []);
  assert.deepEqual(receive([{ id: "old", status: "preparing" }]), []);
  assert.deepEqual(receive([{ id: "done", status: "completed" }]), []);
  assert.deepEqual(receive([{ id: "done", status: "new" }]), []);
  assert.deepEqual(
    receive([
      { id: "old", status: "new" },
      { id: "new", status: "new" },
    ]).map((t) => t.id),
    ["new"],
  );
  assert.deepEqual(receive([{ id: "new", status: "new", revision: 2 }]), []);
  const empty = createTicketTracker();
  assert.deepEqual(empty([]), []);
  assert.equal(
    empty([
      { id: 1, status: "new" },
      { id: 2, status: "preparing" },
    ]).length,
    2,
  );
});

test("new payment methods and retired milk match narrowly while preserving legitimate products", () => {
  const items = [{ productId: 10, price: 150, quantity: 1 }];
  for (const method of ACTIVE_PAYMENT_METHODS)
    assert.doesNotThrow(() =>
      validateCheckout({ items, paymentLines: [{ method, amount: 150 }] }),
    );
  for (const method of ["GCash", "Foodpanda"])
    assert.throws(
      () =>
        validateCheckout({ items, paymentLines: [{ method, amount: 150 }] }),
      /payment/,
    );
  for (const name of ["Milk / Waste Full Cream", "Milk/Waste Full Cream Milk"])
    assert.ok(isRetiredMilkProduct({ name }));
  for (const name of ["Milk Tea", "Full Cream Latte", "Waste bag"])
    assert.equal(isRetiredMilkProduct({ name }), false);
  assert.deepEqual(
    cashierSafe({
      items: [{ name: "Tea", cost: 10, unitCost: 10 }],
      salaryEarned: 100,
    }),
    { items: [{ name: "Tea" }] },
  );
});

test("API enforces today across staff, full exports, private costs, midnight and historical payment records", async () => {
  const db = await createSecureDb();
  process.env.SUPABASE_URL = "https://fixture.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  process.env.SECURE_CUTOVER_ACTIVE = "true";
  let now = Date.parse("2026-11-24T12:00:00+08:00");
  const bounds = cashierBounds(now),
    fixture = fixtureAdmin(db);
  let rollDuringRead = false;
  const handler = createHandler({
    adminFactory: () => fixture.admin,
    secret: () => "test-pepper",
    clock: () => {
      const value = now;
      if (rollDuringRead) now += 86400000;
      return value;
    },
    fetcher: fixture.fetcher,
  });
  async function request(
    path,
    { method = "GET", body, cookie, accept, prefer } = {},
  ) {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    req.url = `/api/${path}`;
    req.method = method;
    req.headers = {
      host: "cafe.test",
      origin: "https://cafe.test",
      cookie,
      accept,
      prefer,
      "x-device-id": "daily-tests",
    };
    const headers = {};
    let result;
    await handler(req, {
      setHeader: (key, value) => (headers[key.toLowerCase()] = value),
      set statusCode(value) {
        this.status = value;
      },
      get statusCode() {
        return this.status;
      },
      end(value) {
        result = {
          status: this.status,
          headers,
          data: value ? JSON.parse(value) : null,
        };
      },
    });
    return result;
  }
  try {
    await db.exec(
      'alter table products add column "isAvailable" boolean default true;alter table cash_drawer add column "staffId" bigint;',
    );
    const owner = (
      await request("session", { method: "POST", body: { pin: "2468" } })
    ).headers["set-cookie"];
    const cashier = (
      await request("session", { method: "POST", body: { pin: "1357" } })
    ).headers["set-cookie"];
    assert.equal(
      (await request("report-access", { cookie: cashier })).data.bounds.startMs,
      bounds.startMs,
    );
    const params = {
      p_start_ms: bounds.startMs,
      p_end_exclusive_ms: bounds.endExclusiveMs,
      p_limit: 50,
      p_offset: 0,
    };
    const items = JSON.stringify([
      {
        productId: 10,
        name: "Food",
        category: "Food",
        quantity: 1,
        price: 150,
        cost: 67.89,
        reportingType: "sale",
      },
    ]);
    await db.query(
      `insert into transactions(id,"receiptNo",datetime,status,total,items,"staffId","staffName","paymentMethod","paymentLines")
      select n,'TODAY-'||n,$1::bigint+n,'completed',150,$2::jsonb,case when n%2=0 then 1 else 2 end,'Staff '||n,case when n%2=0 then 'Cash' else 'GCash' end,jsonb_build_array(jsonb_build_object('method',case when n%2=0 then 'Cash' else 'GCash' end,'amount',150)) from generate_series(1,1105) n`,
      [bounds.startMs, items],
    );
    await db.query(
      `insert into transactions(id,"receiptNo",datetime,status,total,items,"staffId","staffName","paymentMethod","paymentLines") values(2000,'YESTERDAY',$1,'completed',150,$3::jsonb,1,'Owner','Cash','[{"method":"Cash","amount":150}]'),(2001,'TOMORROW',$2,'completed',150,$3::jsonb,1,'Owner','Cash','[{"method":"Cash","amount":150}]')`,
      [bounds.startMs - 1, bounds.endExclusiveMs, items],
    );
    const first = await request("data/rpc/report_transactions_v2", {
      cookie: cashier,
      method: "POST",
      body: params,
    });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.matchingCount, 1105);
    assert.equal(first.data.transactions.length, 50);
    assert.equal(first.data.totals.cashSalesCents, 552 * 15000);
    for (const key of [
      "salesCents",
      "cogsCents",
      "grossProfitCents",
      "operatingCashOutCents",
      "operatingProfitCents",
    ])
      assert.equal(first.data.totals[key], undefined);
    assert.equal(first.data.transactions[0].items[0].cost, undefined);
    assert.equal(
      first.data.transactions[0].report.lines[0].unitCost,
      undefined,
    );
    const second = await request("data/rpc/report_transactions_v2", {
      cookie: cashier,
      method: "POST",
      body: { ...params, p_offset: 50 },
    });
    assert.deepEqual(second.data.totals, first.data.totals);
    const all = await request("data/rpc/report_transactions_v2", {
      cookie: cashier,
      method: "POST",
      body: { ...params, p_limit: 0 },
    });
    assert.equal(all.data.transactions.length, 1105);
    const searched = await request("data/rpc/report_transactions_v2", {
      cookie: cashier,
      method: "POST",
      body: { ...params, p_search: "67.89" },
    });
    assert.equal(searched.data.matchingCount, 0);
    assert.deepEqual(searched.data.totals, first.data.totals);
    const legacy = await request("data/rpc/report_transactions_v2", {
      cookie: cashier,
      method: "POST",
      body: { ...params, p_payment: "GCash", p_limit: 0 },
    });
    assert.equal(legacy.data.transactions.length, 553);
    assert.equal(
      (
        await request("data/rpc/report_transactions_v2", {
          cookie: cashier,
          method: "POST",
          body: { ...params, p_start_ms: 0 },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("data/rpc/report_cash_v2", {
          cookie: cashier,
          method: "POST",
          body: { ...params, p_end_exclusive_ms: bounds.endExclusiveMs + 1 },
        })
      ).status,
      403,
    );
    for (const path of [
      "data/daily_sales_summary",
      "data/transactions?or=(id.eq.2000,id.eq.1)",
      "data/transactions?select=items->cost",
      "data/products?cost=gte.0",
    ])
      assert.equal(
        (await request(path, { cookie: cashier })).status,
        403,
        path,
      );
    const direct = await request("data/transactions?id=eq.2000", {
      cookie: cashier,
    });
    assert.deepEqual(direct.data, []);
    const old = await request("data/transactions?id=eq.2000", {
      cookie: owner,
    });
    assert.equal(old.data[0].receiptNo, "YESTERDAY");
    assert.equal(old.data[0].items[0].cost, 67.89);
    const one = await request("data/ingredients?id=eq.1&select=*", {
      cookie: owner,
      accept: "application/vnd.pgrst.object+json",
    });
    assert.equal(one.data.name, "Ingredient");
    assert.equal(one.data.unit, "g");
    assert.ok(!Array.isArray(one.data));
    assert.ok(
      Array.isArray(
        (await request("data/ingredients?select=*", { cookie: owner })).data,
      ),
    );
    assert.equal(
      (
        await request("data/ingredients?id=eq.99999", {
          cookie: owner,
          accept: "application/vnd.pgrst.object+json",
        })
      ).status,
      406,
    );
    const cash = await request("data/cash_drawer", {
      cookie: cashier,
      method: "POST",
      body: [
        {
          id: 1,
          datetime: 0,
          type: "out",
          amount: 50,
          notes: "Test",
          staffName: "Fake",
          staffId: 1,
        },
      ],
    });
    assert.equal(cash.status, 200, JSON.stringify(cash.data));
    const saved = (await db.query("select * from cash_drawer where id=1"))
      .rows[0];
    assert.equal(Number(saved.datetime), now);
    assert.equal(saved.staffName, "Cashier");
    await db.query(
      `insert into products(id,name,price,cost) values(12,'Milk / Waste Full Cream',0,10)`,
    );
    assert.deepEqual(await retireMilkProducts(fixture.admin), {
      matched: 1,
      changed: 0,
    });
    assert.deepEqual(await retireMilkProducts(fixture.admin, { apply: true }), {
      matched: 1,
      changed: 1,
    });
    assert.deepEqual(await retireMilkProducts(fixture.admin, { apply: true }), {
      matched: 1,
      changed: 0,
    });
    assert.equal(
      (
        await db.query(
          "select count(*) n from app_order_events where action like 'RETIRE_MILK_%'",
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (await db.query("select count(*) n from transactions")).rows[0].n,
      1107,
    );
    for (const path of ["checkout", "orders/dispatch", "bills/save"]) {
      const retiredItems = [
        { productId: 12, name: "Spoofed", price: 0, quantity: 1 },
      ];
      const blocked = await request(path, {
        cookie: cashier,
        method: "POST",
        body: {
          checkoutKey: randomUUID(),
          dispatchKey: randomUUID(),
          items: retiredItems,
          order: { items: retiredItems },
          paymentLines: [],
        },
      });
      assert.equal(blocked.status, 400, path + JSON.stringify(blocked.data));
      assert.match(blocked.data.message, /retired/);
    }
    const reenable = await request("data/products?id=eq.12", {
      cookie: owner,
      method: "PATCH",
      body: { isAvailable: true },
    });
    assert.equal(reenable.status, 200);
    assert.equal(
      (await db.query('select "isAvailable" from products where id=12')).rows[0]
        .isAvailable,
      false,
    );
    rollDuringRead = true;
    assert.equal(
      (
        await request("data/rpc/report_transactions_v2", {
          cookie: cashier,
          method: "POST",
          body: params,
        })
      ).status,
      409,
    );
  } finally {
    await db.close();
  }
});
