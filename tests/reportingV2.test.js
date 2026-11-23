import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createReportingDb,
  seedRows,
  business,
  migrationPath,
} from "./helpers/reportingDb.js";

test("report migration and snapshot functions initialize, preserve originals and are repeatable", async () => {
  const db = await createReportingDb();
  try {
    await db.exec(await readFile(migrationPath, "utf8"));
    await seedRows(db, "transactions", [
      {
        id: 1,
        receiptNo: "R1",
        datetime: 1,
        status: "completed",
        total: 100,
        items: [
          {
            name: "Latte",
            category: "Drinks",
            quantity: 1,
            price: 100,
            cost: 40,
          },
        ],
        paymentMethod: "Cash",
      },
    ]);
    const result = await business(db);
    assert.equal(result.totals.salesCents, 10000);
    assert.equal(result.totals.cogsCents, 4000);
    assert.equal(result.totals.issueCount, 0);
    assert.equal(result.transactions[0].report.lines[0].salesCents, 10000);
  } finally {
    await db.close();
  }
});

const item = (extra = {}) => ({
  name: "Latte",
  category: "Drinks",
  quantity: 1,
  price: 100,
  cost: 40,
  ...extra,
});
const receipt = (id, extra = {}) => ({
  id,
  receiptNo: `R${id}`,
  datetime: id,
  status: "completed",
  total: 100,
  items: [item()],
  paymentMethod: "Cash",
  ...extra,
});
async function call(db, name, params = []) {
  return (
    await db.query(
      `select public.${name}(${params.map((_, i) => `$${i + 1}`).join(",")}) as result`,
      params,
    )
  ).rows[0].result;
}

test("reporting accounting, snapshots, reviews and permissions", async (t) => {
  const db = await createReportingDb();
  t.beforeEach(async () =>
    db.exec(
      "reset role; truncate public.transactions,public.products,public.cash_drawer,public.reporting_reviews,public.reporting_review_history;",
    ),
  );
  try {
    await t.test(
      "largest remainder allocates every cent, including packaging, deterministically",
      async () => {
        await seedRows(db, "transactions", [
          receipt(1, {
            total: 0.02,
            orderDiscountAmount: 0.01,
            items: [
              item({ name: "A", price: 0.01, cost: 0.01 }),
              item({ name: "B", price: 0.01, cost: 0.01 }),
              item({
                name: "Bag",
                price: 0.01,
                cost: 0.01,
                category: "Takeout Box",
              }),
            ],
          }),
        ]);
        const report = await business(db),
          lines = report.transactions[0].report.lines;
        assert.deepEqual(
          lines.map((l) => l.salesCents),
          [1, 1, 0],
        );
        assert.equal(report.totals.salesCents, 2);
        assert.equal(report.totals.cogsCents, 3);
        assert.equal(report.totals.customerItems, 2);
        assert.equal(report.totals.issueCount, 0);
      },
    );
    await t.test(
      "order discounts, loyalty, item adjustments and split payment portions reconcile",
      async () => {
        await seedRows(db, "transactions", [
          receipt(1, {
            total: 200,
            orderDiscount: 10,
            orderDiscountAmount: 10,
            loyaltyDiscount: 15,
            items: [
              item({
                name: "Food",
                category: "Food",
                price: 100,
                quantity: 2,
                cost: 40,
              }),
              item({ price: 50, discount: 10, cost: 20 }),
              item({ name: "Box", category: "Takeout Box", price: 5, cost: 2 }),
            ],
            paymentLines: [
              { method: "Cash", amount: 120 },
              { method: "GCash", amount: 80 },
            ],
          }),
        ]);
        const report = await business(db);
        assert.deepEqual(
          report.transactions[0].report.lines.map((l) => l.salesCents),
          [16000, 3600, 400],
        );
        assert.equal(report.totals.salesCents, 20000);
        assert.equal(report.totals.cogsCents, 10200);
        assert.equal(report.totals.cashSalesCents, 12000);
        assert.equal(report.totals.issueCount, 0);
        const selected = await call(db, "report_transactions_v2", [
          0,
          100,
          "",
          "GCash",
          "All",
          "All",
          0,
          50,
        ]);
        assert.equal(selected.totals.salesCents, 20000);
        assert.equal(selected.selectedPaymentCents, 8000);
        assert.equal(selected.matchingCount, 1);
      },
    );
    await t.test(
      "custom unit price, markup and fractional quantities use numeric arithmetic",
      async () => {
        await seedRows(db, "transactions", [
          receipt(1, {
            total: 32.5,
            items: [
              item({
                quantity: 2.5,
                price: 10,
                markup: 20,
                markupAmount: 1,
                cost: 0.4,
              }),
            ],
          }),
        ]);
        let report = await business(db);
        assert.equal(report.totals.salesCents, 3250);
        assert.equal(report.totals.cogsCents, 100);
        assert.equal(report.totals.issueCount, 0);
        await db.query("update transactions set total=25,items=$1 where id=1", [
          JSON.stringify([item({ customPrice: 25, discount: 90 })]),
        ]);
        report = await business(db);
        assert.equal(report.transactions[0].report.lines[0].baseCents, 2500);
        assert.equal(report.totals.issueCount, 0);
      },
    );
    await t.test(
      "waste is deducted once and waste-only records are not customer sales",
      async () => {
        await seedRows(db, "transactions", [
          receipt(1, {
            items: [
              item(),
              item({
                name: "Milk / Waste Full Cream",
                reportingType: "waste",
                price: 0,
                cost: 10,
                quantity: 2,
              }),
            ],
          }),
          receipt(2, {
            total: 0,
            items: [
              item({ reportingType: "waste", price: 0, cost: 3, quantity: 5 }),
            ],
          }),
          receipt(3, {
            total: 0,
            orderDiscount: 100,
            paymentMethod: "Loyalty",
          }),
        ]);
        await seedRows(db, "cash_drawer", [
          {
            id: 1,
            datetime: 1,
            type: "out",
            amount: 20,
            category: "operating_expense",
          },
          {
            id: 2,
            datetime: 2,
            type: "out",
            amount: 30,
            category: "stock_purchase",
          },
          {
            id: 3,
            datetime: 3,
            type: "out",
            amount: 10,
            category: "owner_withdrawal",
          },
          { id: 4, datetime: 4, type: "in", amount: 50 },
        ]);
        const m = (await business(db)).totals;
        assert.equal(m.cogsCents, 8000);
        assert.equal(m.wasteCents, 3500);
        assert.equal(m.transactionCount, 2);
        assert.equal(m.customerItems, 2);
        assert.equal(m.wasteRecordCount, 1);
        assert.equal(m.freeCustomerCount, 1);
        assert.equal(m.issueCount, 0);
        assert.equal(
          m.salesCents - m.cogsCents - m.wasteCents - m.operatingCashOutCents,
          -3500,
        );
        assert.equal(m.cashSalesCents + m.cashInCents - m.cashOutCents, 9000);
        assert.equal(
          m.cashOutCents,
          m.operatingCashOutCents +
            m.stockPurchaseCents +
            m.ownerWithdrawalCents +
            m.unclassifiedCents,
        );
      },
    );
    await t.test(
      "legacy milk type needs review and current prices/costs never replace saved values",
      async () => {
        await seedRows(db, "products", [
          { id: 5, name: "Milk / Waste Full Cream", cost: 999, price: 0 },
        ]);
        await seedRows(db, "transactions", [
          receipt(1, {
            total: 0,
            items: [
              item({
                productId: 5,
                name: "Milk / Waste Full Cream",
                price: 0,
                cost: 5,
              }),
            ],
          }),
        ]);
        let report = await business(db);
        assert.equal(report.totals.wasteCents, 500);
        assert.equal(report.totals.issueCount, 1);
        await call(db, "report_review_product_v2", [
          5,
          "waste",
          false,
          "Verified waste item",
          "2468",
        ]);
        report = await business(db);
        assert.equal(report.totals.wasteCents, 500);
        assert.equal(report.totals.issueCount, 0);
        assert.equal(
          (
            await db.query(
              "select count(*) as count from reporting_review_history",
            )
          ).rows[0].count,
          1,
        );
      },
    );
    await t.test(
      "missing and zero cost require explicit review without rewriting receipts",
      async () => {
        await seedRows(db, "transactions", [
          receipt(1, { items: [item({ cost: null })] }),
        ]);
        let report = await business(db);
        assert.equal(report.totals.costReady, false);
        const original = (
          await db.query("select to_jsonb(t) as row from transactions t")
        ).rows[0].row;
        const hash = report.transactions[0].report.lines[0].sourceHash;
        await assert.rejects(
          call(db, "report_review_item_v2", [
            1,
            0,
            hash,
            { unitCost: 0, confirmZero: true },
            "Verified cost",
            "1357",
          ]),
          /owner PIN/,
        );
        await call(db, "report_review_item_v2", [
          1,
          0,
          hash,
          { unitCost: 0, confirmZero: true },
          "Verified complimentary zero cost",
          "2468",
        ]);
        report = await business(db);
        assert.equal(report.totals.costReady, true);
        assert.equal(report.totals.issueCount, 0);
        assert.deepEqual(
          (await db.query("select to_jsonb(t) as row from transactions t"))
            .rows[0].row,
          original,
        );
        await assert.rejects(
          call(db, "report_review_item_v2", [
            1,
            0,
            "stale-hash",
            { unitCost: 10 },
            "Correct historical cost",
            "2468",
          ]),
          /Receipt changed/,
        );
      },
    );
    await t.test(
      "unexplained adjustments and payment mismatches remain visible until reviewed",
      async () => {
        await seedRows(db, "transactions", [
          receipt(1, {
            total: 90,
            paymentLines: [{ method: "Cash", amount: 50 }],
          }),
        ]);
        let report = await business(db);
        assert.equal(report.totals.issueCount, 2);
        assert.equal(report.totals.cashReady, false);
        await call(db, "report_review_item_v2", [
          1,
          -1,
          report.transactions[0].report.sourceHash,
          {
            confirmAdjustment: true,
            paymentLines: [{ method: "Cash", amount: 90 }],
          },
          "Verified legacy discount and cash payment",
          "2468",
        ]);
        report = await business(db);
        assert.equal(report.totals.issueCount, 0);
        assert.equal(report.totals.cashReady, true);
        assert.equal(report.totals.salesCents, 9000);
      },
    );
    await t.test(
      "unknown categories never infer expenses from notes; reviewed categories are audited",
      async () => {
        await seedRows(db, "cash_drawer", [
          { id: 1, type: "out", datetime: 1, amount: 20, notes: "Salary" },
        ]);
        let report = await business(db);
        assert.equal(report.totals.operatingCashOutCents, 0);
        assert.equal(report.totals.unclassifiedCount, 1);
        await call(db, "report_review_cash_v2", [
          1,
          "operating_expense",
          "Verified salary expense",
          "2468",
        ]);
        report = await business(db);
        assert.equal(report.totals.operatingCashOutCents, 2000);
        assert.equal(report.totals.unclassifiedCount, 0);
        const entry = (
          await db.query("select notes,amount from cash_drawer where id=1")
        ).rows[0];
        assert.deepEqual(entry, { notes: "Salary", amount: "20" });
      },
    );
    await t.test(
      "direct anon review writes are denied, but owner-PIN invoker RPCs work",
      async () => {
        await seedRows(db, "transactions", [receipt(1)]);
        const report = await business(db),
          hash = report.transactions[0].report.lines[0].sourceHash;
        await db.exec("set role anon;");
        await assert.rejects(
          db.query(
            "insert into reporting_reviews values(1,0,'x','{}','Forged change',1,now())",
          ),
          /row-level security/,
        );
        await assert.rejects(
          call(db, "report_review_item_v2", [
            1,
            0,
            hash,
            { unitCost: 20 },
            "Verified cost",
            "0000",
          ]),
          /owner PIN/,
        );
        await call(db, "report_review_item_v2", [
          1,
          0,
          hash,
          { unitCost: 20 },
          "Verified historical cost",
          "2468",
        ]);
        assert.equal((await business(db)).totals.cogsCents, 2000);
        await assert.rejects(
          db.query("delete from reporting_review_history"),
          /permission denied/,
        );
        await db.exec("reset role;");
      },
    );
    await t.test(
      "full-period totals and exports cover >1000 records, search precedes pagination",
      async () => {
        await seedRows(
          db,
          "transactions",
          Array.from({ length: 1051 }, (_, i) =>
            receipt(i + 1, {
              total: 1,
              items: [item({ price: 1, cost: 0.3 })],
            }),
          ),
        );
        const first = await call(db, "report_transactions_v2", [
          0,
          2000,
          "",
          "All",
          "All",
          "All",
          0,
          50,
        ]);
        const last = await call(db, "report_transactions_v2", [
          0,
          2000,
          "",
          "All",
          "All",
          "All",
          1000,
          50,
        ]);
        assert.equal(first.matchingCount, 1051);
        assert.equal(first.transactions.length, 50);
        assert.deepEqual(first.totals, last.totals);
        assert.equal(first.totals.salesCents, 105100);
        const found = await call(db, "report_transactions_v2", [
          0,
          2000,
          "R1051",
          "All",
          "All",
          "All",
          0,
          50,
        ]);
        assert.equal(found.matchingCount, 1);
        assert.equal(found.transactions[0].id, 1051);
        const exported = await call(db, "report_transactions_v2", [
          0,
          2000,
          "",
          "All",
          "All",
          "All",
          0,
          0,
        ]);
        assert.equal(exported.transactions.length, 1051);
        assert.equal(exported.totals.salesCents, 105100);
      },
    );
    await t.test(
      "invalid records are flagged, voids excluded, and boundaries are half-open",
      async () => {
        await seedRows(db, "transactions", [
          receipt(1, { datetime: 100 }),
          receipt(2, { datetime: 199 }),
          receipt(3, { datetime: 200 }),
          receipt(4, { datetime: 150, status: "void", items: null }),
          receipt(5, { datetime: 160, status: null }),
          receipt(6, { datetime: 170, items: { bad: true } }),
        ]);
        const report = await business(db, 100, 200);
        assert.equal(report.transactions.length, 5);
        assert.equal(report.totals.voidCount, 1);
        assert.equal(report.totals.salesReady, false);
        assert.equal(report.totals.costReady, false);
        assert.ok(
          report.transactions
            .find((tx) => tx.id === 6)
            .report.issues.some((i) => i.code === "missing_items"),
        );
      },
    );
    await t.test(
      "invalid cash records and zero quantities do not become valid zero totals",
      async () => {
        await seedRows(db, "cash_drawer", [
          { id: 1, datetime: 1, type: null, amount: 10 },
          { id: 2, datetime: 1, type: "out", amount: null },
        ]);
        await seedRows(db, "transactions", [
          receipt(1, { items: [item({ quantity: 0 })] }),
        ]);
        const report = await business(db);
        assert.equal(report.totals.cashReady, false);
        assert.equal(report.totals.salesReady, false);
        assert.ok(report.totals.issueCount >= 3);
      },
    );
  } finally {
    await db.close();
  }
});
