import { reportRange } from "../src/utils/reportDates.js";
import { fail } from "./security.js";

const privateFields = new Set([
  "cost",
  "unitCost",
  "costCents",
  "unit_cost",
  "cogsCents",
  "wasteCents",
  "profit",
  "revenue",
  "grossProfit",
  "operatingProfit",
  "totalCost",
  "costPerUnit",
  "grossProfitCents",
  "operatingProfitCents",
  "operatingExpenseCents",
  "costZeroConfirmed",
  "costReady",
  "costSource",
  "salaryEarned",
  "hourlyRate",
  "sourceHash",
  "beforeStockValue",
  "afterStockValue",
]);
export function cashierSafe(value) {
  if (Array.isArray(value)) return value.map(cashierSafe);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !privateFields.has(key))
      .map(([key, item]) => [key, cashierSafe(item)]),
  );
}
export function cashierBounds(now = Date.now()) {
  return reportRange({ range: "today", now });
}
export function enforceCashierPeriod(body, bounds) {
  if (
    body.p_start_ms !== bounds.startMs ||
    body.p_end_exclusive_ms !== bounds.endExclusiveMs
  )
    fail(403, "Cashiers can view today only (Philippine time).");
}
export function scopeCashierQuery(resource, params, bounds) {
  if (resource === "daily_sales_summary")
    fail(403, "Historical sales summaries are restricted.");
  if (["transactions", "cash_drawer"].includes(resource)) {
    const fields =
      resource === "transactions"
        ? [
            "id",
            "datetime",
            "status",
            "receiptNo",
            "staffId",
            "staffName",
            "paymentMethod",
            "orderType",
            "total",
          ]
        : [
            "id",
            "datetime",
            "type",
            "amount",
            "category",
            "notes",
            "staffId",
            "staffName",
          ];
    for (const [key, value] of params) {
      if (key === "select") {
        if (
          value !== "*" &&
          value.split(",").some((field) => !fields.includes(field))
        )
          fail(403, "This cashier query includes restricted fields.");
      } else if (key === "order") {
        if (
          value
            .split(",")
            .some((field) => !fields.includes(field.split(".")[0]))
        )
          fail(403, "This sort is restricted.");
      } else if (![...fields, "limit", "offset"].includes(key))
        fail(403, "This cashier query is restricted.");
    }
    params.append("datetime", `gte.${bounds.startMs}`);
    params.append("datetime", `lt.${bounds.endExclusiveMs}`);
  } else {
    for (const [key, value] of params) {
      if (
        /\b(cost|unitCost|costCents|salaryEarned|hourlyRate|profit|revenue)\b/.test(
          key + " " + value,
        ) ||
        (resource === "inventory" && /\bprice\b/.test(key + " " + value))
      )
        fail(403, "Cost, profit and payroll queries are restricted.");
    }
  }
}
export function cashierReport(snapshot, params = {}) {
  const transactions = snapshot.transactions.map((tx) => {
    const safe = cashierSafe(tx);
    if (safe.report) {
      safe.report.issues = (safe.report.issues || []).filter((issue) =>
        [
          "payment_mismatch",
          "invalid_total",
          "invalid_quantity",
          "invalid_status",
        ].includes(issue.code),
      );
    }
    return safe;
  });
  const cashEntries = cashierSafe(snapshot.cashEntries || []);
  const complete = transactions.filter((tx) => tx.status === "completed");
  const cashSalesCents = complete.reduce(
    (sum, tx) =>
      sum +
      (tx.report?.payments || [])
        .filter((p) => p.method === "Cash")
        .reduce((n, p) => n + p.amountCents, 0),
    0,
  );
  const totals = {
    cashSalesCents,
    cashInCents: snapshot.totals.cashInCents,
    cashOutCents: snapshot.totals.cashOutCents,
    cashReady: snapshot.totals.cashReady,
    transactionCount: snapshot.totals.transactionCount,
    voidCount: snapshot.totals.voidCount,
  };
  const base = {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    startMs: snapshot.startMs,
    endExclusiveMs: snapshot.endExclusiveMs,
    timezone: snapshot.timezone,
    currency: snapshot.currency,
    cashEntries,
    totals,
    access: { dateScope: "today" },
  };
  if (params.kind === "cash") {
    const search = String(params.p_search || "").toLowerCase();
    return {
      ...base,
      transactions,
      matchingEntries: cashEntries.filter(
        (entry) =>
          (!params.p_review_only ||
            (entry.type === "out" &&
              ![
                "operating_expense",
                "stock_purchase",
                "owner_withdrawal",
              ].includes(entry.category))) &&
          (!search ||
            [
              entry.notes,
              entry.staffName,
              entry.type === "in" ? "cash in" : "cash out",
              entry.category,
              entry.amount,
            ]
              .join(" ")
              .toLowerCase()
              .includes(search)),
      ),
    };
  }
  const search = String(params.p_search || "")
    .trim()
    .toLowerCase();
  const selected = transactions.filter(
    (tx) =>
      (!params.p_status ||
        params.p_status === "All" ||
        tx.status === params.p_status) &&
      (!params.p_staff ||
        params.p_staff === "All" ||
        String(tx.staffId) === String(params.p_staff)) &&
      (!params.p_payment ||
        params.p_payment === "All" ||
        tx.report?.payments?.some((p) => p.method === params.p_payment)) &&
      (!search ||
        [
          tx.receiptNo,
          tx.staffName,
          tx.paymentMethod,
          tx.customerName,
          ...(tx.items || []).flatMap((item) => [
            item.name,
            item.note,
            item.category,
          ]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search)),
  );
  selected.sort((a, b) => b.datetime - a.datetime || b.id - a.id);
  const offset = Number(params.p_offset ?? 0),
    limit = Number(params.p_limit ?? 50);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 0
  )
    fail(400, "Invalid receipt page.");
  return {
    ...base,
    matchingCount: selected.length,
    transactions:
      limit === 0
        ? selected.slice(offset)
        : selected.slice(offset, offset + Math.min(limit, 200)),
    selectedPaymentCents: null,
    paymentBreakdown: [],
  };
}
