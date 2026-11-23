import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createReportingDb } from "./helpers/reportingDb.js";

test("optimized reports preserve the full snapshot and avoid repeated normalization", async (t) => {
  const db = await createReportingDb();
  try {
    await db.exec(`insert into products(id,name,category,price,cost,"reportingType","costZeroConfirmed") values(1,'Coffee','Drinks',100,40,'sale',false);
      insert into transactions(id,"receiptNo",datetime,status,total,items,"paymentMethod")
      select n,'PERF-'||n,1795000000000+n,'completed',95,jsonb_build_array(jsonb_build_object('productId',1,'name','Coffee','category','Drinks','reportingType','sale','quantity',1,'price',100,'discount',5,'cost',40)),'Cash' from generate_series(1,2000) n;`);
    const report = async () =>
      (
        await db.query(
          "select public.report_business_v2(0,9999999999999) as result",
        )
      ).rows[0].result;
    let started = performance.now();
    const before = await report();
    const oldMs = performance.now() - started;
    const migration = await readFile(
      new URL(
        "../supabase/migrations/20261123123549_report_snapshot_performance.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    started = performance.now();
    const after = await report();
    const newMs = performance.now() - started;
    const withoutTime = (value) => ({ ...value, generatedAt: null });
    assert.deepEqual(withoutTime(after), withoutTime(before));
    assert.equal(after.transactions.length, 2000);
    assert.equal(after.totals.salesCents, 19000000);
    const filtered = (
      await db.query(
        "select public.report_transactions_v2(0,9999999999999,'PERF-2000','Cash','All','All',0,0) as result",
      )
    ).rows[0].result;
    assert.equal(filtered.matchingCount, 1);
    assert.equal(filtered.totals.salesCents, 9500);
    const cash = (
      await db.query("select public.report_cash_v2(0,9999999999999) as result")
    ).rows[0].result;
    assert.deepEqual(cash.totals, after.totals);
    t.diagnostic(
      `Isolated PostgreSQL 2,000 receipts: old ${Math.round(oldMs)}ms; optimized ${Math.round(newMs)}ms. Live timings require the café migration.`,
    );
    // Test the cause structurally: one materialized normalization invocation per receipt.
    const normalized = (
      await db.query(
        "select pg_get_functiondef('public.report_period_v2(bigint,bigint)'::regprocedure) as definition",
      )
    ).rows[0].definition;
    assert.match(normalized, /normalized as materialized/);
    assert.equal(
      (normalized.match(/report_normalize_transaction_v2\(/g) || []).length,
      1,
    );
  } finally {
    await db.close();
  }
});
