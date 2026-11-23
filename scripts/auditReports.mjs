// Read-only live audit. Only the public anon/publishable configuration already
// shipped to browsers is used. Credentials and original records are never printed.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  createReportingDb,
  seedRows,
  business,
} from "../tests/helpers/reportingDb.js";
import { calcGrossProfit } from "../src/utils/calculations.js";
import { reportRange } from "../src/utils/reportDates.js";

const [from = "2026-11-17", to = "2026-11-23"] = process.argv.slice(2);
const bounds = reportRange({
  range: "custom",
  customStart: from,
  customEnd: to,
});
const origin = "https://92-parameters.vercel.app";
const html = await (await fetch(origin)).text();
const path = html.match(/src="([^"]+\.js)"/)?.[1];
if (!path) throw new Error("Published app bundle was not found.");
const bundle = await (await fetch(new URL(path, origin))).text();
const host = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
if (host !== "https://glbrfvqdtwvwzxbumeac.supabase.co")
  throw new Error("Unexpected café database target.");
let key = process.env.VITE_SUPABASE_ANON_KEY;
if (!key)
  for (const match of bundle.matchAll(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  )) {
    try {
      const payload = JSON.parse(
        Buffer.from(match[0].split(".")[1], "base64url").toString(),
      );
      if (payload.role === "anon" && payload.ref === "glbrfvqdtwvwzxbumeac") {
        key = match[0];
        break;
      }
    } catch {}
  }
key ||= bundle.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
if (!key)
  throw new Error("Public browser configuration could not be identified.");
const client = createClient(host, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
async function rows(table, period = true) {
  const result = [];
  for (let offset = 0; ; offset += 500) {
    let query = client
      .from(table)
      .select("*")
      .order("id")
      .range(offset, offset + 499);
    if (period)
      query = query
        .gte("datetime", bounds.startMs)
        .lt("datetime", bounds.endExclusiveMs);
    const { data, error } = await query;
    if (error)
      throw new Error(`Read-only ${table} audit failed: ${error.code}`);
    result.push(...data);
    if (data.length < 500) return result;
  }
}
async function snapshot() {
  const [transactions, cash, products] = await Promise.all([
    rows("transactions"),
    rows("cash_drawer"),
    rows("products", false),
  ]);
  return { transactions, cash, products };
}
const first = await snapshot(),
  source = await snapshot();
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
if (hash(first) !== hash(source))
  throw new Error(
    "Live records changed during the audit. Run again to obtain a stable comparison.",
  );
const db = await createReportingDb();
try {
  await seedRows(db, "products", source.products);
  await seedRows(db, "transactions", source.transactions);
  await seedRows(db, "cash_drawer", source.cash);
  const next = await business(db, bounds.startMs, bounds.endExclusiveMs),
    old = calcGrossProfit(source.transactions);
  const issueCounts = {};
  let allocation = 0,
    paid = 0;
  for (const tx of next.transactions) {
    if (tx.status !== "completed") continue;
    for (const issue of tx.report.issues)
      issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
    allocation +=
      tx.report.unallocatedCents +
      tx.report.lines.reduce((sum, l) => sum + l.salesCents, 0);
    paid += tx.report.payments.reduce((sum, p) => sum + p.amountCents, 0);
  }
  const audit = {
    period: { from, to, timezone: "Asia/Manila" },
    auditedAt: new Date().toISOString(),
    sourceFingerprint: hash(source),
    sourceStableAcrossTwoReads: true,
    original: {
      salesCents: Math.round(old.revenue * 100),
      allItemCostCents: Math.round(old.cost * 100),
      grossProfitCents: Math.round(old.profit * 100),
      nonVoidRecords: source.transactions.filter((t) => t.status !== "void")
        .length,
    },
    revised: next.totals,
    reconciliation: {
      allocatedSalesCents: allocation,
      recordedSalesCents: next.totals.salesCents,
      recordedPaymentCents: paid,
      salesAllocationMatches: allocation === next.totals.salesCents,
      paymentsMatch: paid === next.totals.salesCents,
      costsPreservedAndWasteSeparated:
        next.totals.cogsCents + next.totals.wasteCents ===
        Math.round(old.cost * 100),
    },
    unresolvedReceiptIssues: issueCounts,
    notes: [
      "Original records were only read. No migration or review was applied to the live database.",
      "Profit remains pending until classification, cost and reconciliation issues are reviewed.",
    ],
  };
  await mkdir(".tmp", { recursive: true });
  await writeFile(
    ".tmp/reports-live-audit.json",
    JSON.stringify(audit, null, 2),
  );
  console.log(JSON.stringify(audit, null, 2));
} finally {
  await db.close();
}
