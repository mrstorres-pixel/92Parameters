import { supabase } from "../db/database";
import { formatCurrency } from "./formatters";

export const REPORT_MIGRATION_URL =
  "https://github.com/mrstorres-pixel/92Parameters/blob/reports-overhaul-v2/supabase/migrations/20261123021642_reports_v2.sql";
export function money(cents) {
  if (cents === null || cents === undefined) return "Needs review";
  if (!Number.isSafeInteger(cents))
    throw new Error("Report money is outside the supported precision.");
  return formatCurrency(cents / 100);
}
function validateMoney(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key.endsWith("Cents") && item !== null && !Number.isSafeInteger(item))
      throw new Error("The report contains an invalid money amount.");
    if (item && typeof item === "object") validateMoney(item);
  }
}
export async function requestReport(name, params, signal) {
  const { data, error } = await supabase.rpc(name, params).abortSignal(signal);
  if (error) {
    const failure = new Error(
      error.message || "Could not load the complete report.",
    );
    failure.setupRequired = ["PGRST202", "42883", "42703", "42P01"].includes(
      error.code,
    );
    throw failure;
  }
  if (!data || data.version !== 2)
    throw new Error("The report response could not be verified.");
  validateMoney(data);
  return data;
}
export function periodParams(bounds) {
  return {
    p_start_ms: bounds.startMs,
    p_end_exclusive_ms: bounds.endExclusiveMs,
  };
}
export function reportMetrics(data) {
  const t = data.totals;
  return {
    ...t,
    grossProfitCents: t.salesCents - t.cogsCents,
    operatingExpenseCents: t.operatingCashOutCents + t.wasteCents,
    operatingProfitCents:
      t.salesCents - t.cogsCents - t.operatingCashOutCents - t.wasteCents,
    drawerMovementCents: t.cashSalesCents + t.cashInCents - t.cashOutCents,
    profitReady:
      t.salesReady &&
      t.costReady &&
      t.cashReady &&
      t.issueCount === 0 &&
      t.unclassifiedCount === 0,
  };
}
export function businessBreakdowns(data) {
  const categories = new Map(),
    products = new Map(),
    payments = new Map(),
    hours = new Map();
  const issues = [];
  for (const tx of data.transactions) {
    if (tx.status === "void") continue;
    for (const issue of tx.report.issues)
      issues.push({
        ...issue,
        transaction: tx,
        line: issue.itemIndex < 0 ? null : tx.report.lines[issue.itemIndex],
      });
    if (tx.status !== "completed") continue;
    for (const line of tx.report.lines) {
      if (line.kind === "waste") continue;
      const category = categories.get(line.category) || {
        name: line.category,
        salesCents: 0,
        costCents: 0,
        quantity: 0,
        costReady: true,
      };
      category.salesCents += line.salesCents;
      category.costCents += line.costCents || 0;
      category.quantity += line.quantity || 0;
      category.costReady &&=
        line.unitCost !== null &&
        !tx.report.issues.some(
          (i) =>
            i.itemIndex === line.index &&
            [
              "cost_review",
              "invalid_quantity",
              "classification_review",
              "stale_review",
            ].includes(i.code),
        );
      categories.set(line.category, category);
      if (line.kind === "sale") {
        const key = line.productId ?? line.name;
        const product = products.get(key) || {
          name: line.name || "Unnamed product",
          quantity: 0,
          salesCents: 0,
        };
        product.quantity += line.quantity || 0;
        product.salesCents += line.salesCents;
        products.set(key, product);
      }
    }
    if (tx.report.unallocatedCents) {
      const row = categories.get("Unallocated — needs review") || {
        name: "Unallocated — needs review",
        salesCents: 0,
        costCents: 0,
        quantity: 0,
        costReady: false,
      };
      row.salesCents += tx.report.unallocatedCents;
      categories.set(row.name, row);
    }
    for (const line of tx.report.payments) {
      const row = payments.get(line.method) || {
        name: line.method,
        salesCents: 0,
        receiptIds: new Set(),
      };
      row.salesCents += line.amountCents;
      row.receiptIds.add(tx.id);
      payments.set(row.name, row);
    }
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(tx.datetime)),
    );
    hours.set(hour, (hours.get(hour) || 0) + (tx.report.totalCents || 0));
  }
  return {
    categories: [...categories.values()].sort(
      (a, b) => b.salesCents - a.salesCents,
    ),
    products: [...products.values()].sort((a, b) => b.quantity - a.quantity),
    payments: [...payments.values()]
      .map((row) => ({
        name: row.name,
        salesCents: row.salesCents,
        quantity: row.receiptIds.size,
      }))
      .sort((a, b) => b.salesCents - a.salesCents),
    hours: Array.from({ length: 24 }, (_, hour) => ({
      name: `${String(hour).padStart(2, "0")}:00`,
      salesCents: hours.get(hour) || 0,
    })),
    issues,
  };
}
