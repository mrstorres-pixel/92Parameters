// Trusted Vercel build/release task. Never logs server secrets, PINs or receipt rows.
import assert from "node:assert/strict";
import { getAdmin } from "../server/backend.js";
import { digest } from "../server/security.js";
import { cashierBounds, cashierReport } from "../server/cashierPolicy.js";
import { retireMilkProducts } from "../server/milkRetirement.js";
const admin = getAdmin();
assert.equal(
  new URL(process.env.SUPABASE_URL).hostname,
  "glbrfvqdtwvwzxbumeac.supabase.co",
);
assert.equal(
  process.env.SECURE_CUTOVER_ACTIVE,
  "true",
  "Use the already-cutover server configuration.",
);
const checked = (result) => {
  if (result.error)
    throw new Error(`${result.error.code || "query"}: ${result.error.message}`);
  return result.data;
};
const period = {
  p_start_ms: Date.parse("2026-10-25T00:00:00+08:00"),
  p_end_exclusive_ms: Date.parse("2026-11-24T00:00:00+08:00"),
};
const snapshot = () => admin.rpc("report_business_v2", period).then(checked);
const financialHash = (report) =>
  digest(
    JSON.stringify({
      totals: report.totals,
      transactions: report.transactions,
      cashEntries: report.cashEntries,
    }),
  );
const before = await snapshot(),
  beforeHash = financialHash(before);
console.log(
  JSON.stringify({
    audit: "historical-baseline",
    ...period,
    receipts: before.transactions.length,
    totals: before.totals,
    hash: beforeHash,
  }),
);
const today = cashierBounds(),
  current = checked(
    await admin.rpc("report_business_v2", {
      p_start_ms: today.startMs,
      p_end_exclusive_ms: today.endExclusiveMs,
    }),
  );
const safe = cashierReport(current, { kind: "transactions", p_limit: 0 });
assert.equal(safe.matchingCount, safe.transactions.length);
assert.equal(safe.totals.cogsCents, undefined);
assert.equal(safe.totals.salesCents, undefined);
for (const tx of safe.transactions) {
  assert.ok(tx.datetime >= today.startMs && tx.datetime < today.endExclusiveMs);
  for (const item of tx.items || []) assert.equal(item.cost, undefined);
}
const product = checked(
  await admin
    .from("ingredients")
    .select("id,name,unit")
    .order("id")
    .limit(1)
    .maybeSingle(),
);
assert.ok(!Array.isArray(product));
console.log(
  JSON.stringify({
    audit: "today-policy",
    date: today.startDate,
    receipts: safe.matchingCount,
    cashReady: safe.totals.cashReady,
  }),
);
const retirement = await retireMilkProducts(admin, {
  apply: process.env.RETIRE_MILK === "true",
});
const after = await snapshot();
assert.equal(
  financialHash(after),
  beforeHash,
  "Historical financial snapshot changed during audit. Investigate before release.",
);
console.log(
  JSON.stringify({
    audit: "milk-availability",
    ...retirement,
    historicalFinancialsUnchanged: true,
  }),
);
