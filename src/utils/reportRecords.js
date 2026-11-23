// Read-only source ledgers. All amounts come from the saved report snapshot.
const CATEGORY_FIGURES = {
  operatingCashOut: "operating_expense",
  stockPurchase: "stock_purchase",
  ownerWithdrawal: "owner_withdrawal",
};
const TITLES = {
  sales: "Sales",
  transactions: "Customer transactions",
  average: "Average customer sale",
  items: "Customer items sold",
  cogs: "Cost of goods sold",
  grossProfit: "Gross profit",
  operatingCashOut: "Operating cash-out expenses",
  waste: "Recorded waste expense",
  operatingExpenses: "Total operating expenses",
  operatingProfit: "Operating profit",
  cashOut: "Total cash out",
  stockPurchase: "Stock purchases",
  ownerWithdrawal: "Owner withdrawals",
  unclassified: "Unclassified cash-outs",
  cashSales: "Cash sales portions",
  cashIn: "Manual cash in",
  drawerMovement: "Recorded drawer movement",
  voids: "Voids",
  selectedPayment: "Selected payment portions",
};
export function reportFigure(data, figure) {
  const t = data.totals;
  const profitReady =
    t.salesReady &&
    t.costReady &&
    t.cashReady &&
    t.issueCount === 0 &&
    t.unclassifiedCount === 0;
  const values = {
    sales: [t.salesCents, t.salesReady],
    transactions: [t.transactionCount, true],
    items: [t.customerItems, true],
    average: [
      t.transactionCount ? Math.round(t.salesCents / t.transactionCount) : 0,
      t.salesReady,
    ],
    cogs: [t.cogsCents, t.costReady],
    grossProfit: [t.salesCents - t.cogsCents, t.salesReady && t.costReady],
    operatingCashOut: [t.operatingCashOutCents, t.cashReady],
    waste: [t.wasteCents, t.costReady],
    operatingExpenses: [
      t.operatingCashOutCents + t.wasteCents,
      t.costReady && t.cashReady,
    ],
    operatingProfit: [
      t.salesCents - t.cogsCents - t.operatingCashOutCents - t.wasteCents,
      profitReady,
    ],
    cashOut: [t.cashOutCents, t.cashReady],
    stockPurchase: [t.stockPurchaseCents, t.cashReady],
    ownerWithdrawal: [t.ownerWithdrawalCents, t.cashReady],
    unclassified: [t.unclassifiedCents, t.cashReady],
    cashSales: [t.cashSalesCents, t.cashReady],
    cashIn: [t.cashInCents, t.cashReady],
    drawerMovement: [
      t.cashSalesCents + t.cashInCents - t.cashOutCents,
      t.cashReady,
    ],
    voids: [t.voidCount, true],
    selectedPayment: [data.selectedPaymentCents, t.cashReady],
  };
  if (!values[figure]) throw new Error("Unknown report figure.");
  return {
    title: TITLES[figure],
    value: values[figure][0],
    ready: Boolean(values[figure][1]),
    quantity: ["transactions", "items", "voids"].includes(figure),
  };
}
export function buildReportRecords(data, figure, payment = "All") {
  const target = reportFigure(data, figure);
  const completed = data.transactions.filter((tx) => tx.status === "completed");
  const rows = [];
  const receipt = (tx, value, kind, line) =>
    rows.push({
      id: `${kind}:${tx.id}:${line?.index ?? "receipt"}`,
      referenceId: tx.id,
      label: tx.receiptNo || `Receipt ${tx.id}`,
      datetime: tx.datetime,
      description: line ? `${line.name} · ${kind}` : kind,
      value,
      transaction: tx,
      line,
    });
  const cash = (entry, sign = 1) =>
    rows.push({
      id: `cash:${entry.id}`,
      referenceId: entry.id,
      label: `Cash ${entry.type} #${entry.id}`,
      datetime: entry.datetime,
      description:
        entry.notes || entry.category?.replaceAll("_", " ") || "No notes",
      value: entry.amountCents == null ? null : sign * entry.amountCents,
      entry,
    });
  const costLines = (kind, sign = 1) => {
    for (const tx of completed)
      for (const line of tx.report.lines) {
        if ((kind === "waste") !== (line.kind === "waste")) continue;
        const pending = tx.report.issues.some(
          (issue) =>
            issue.itemIndex === line.index &&
            [
              "cost_review",
              "invalid_quantity",
              "classification_review",
              "stale_review",
            ].includes(issue.code),
        );
        receipt(
          tx,
          pending || line.costCents == null ? null : sign * line.costCents,
          kind === "waste" ? "Waste cost" : "Cost of goods sold",
          line,
        );
      }
  };
  if (["sales", "average", "grossProfit", "operatingProfit"].includes(figure)) {
    for (const tx of completed)
      receipt(tx, tx.report.totalCents, "Receipt sales");
  }
  if (figure === "transactions")
    for (const tx of completed.filter((tx) => tx.report.hasCustomer))
      receipt(tx, 1, "Customer transaction");
  if (figure === "voids")
    for (const tx of data.transactions.filter((tx) => tx.status === "void"))
      receipt(tx, 1, "Voided receipt");
  if (figure === "items")
    for (const tx of completed)
      for (const line of tx.report.lines.filter((line) => line.kind === "sale"))
        receipt(tx, line.quantity, "Customer items", line);
  if (["cogs", "grossProfit", "operatingProfit"].includes(figure))
    costLines("cogs", figure === "cogs" ? 1 : -1);
  if (["waste", "operatingExpenses", "operatingProfit"].includes(figure))
    costLines("waste", figure === "operatingProfit" ? -1 : 1);
  if (["cashSales", "drawerMovement", "selectedPayment"].includes(figure))
    for (const tx of completed) {
      const portions = tx.report.payments.filter((p) =>
        figure === "selectedPayment"
          ? payment === "All" || p.method === payment
          : p.method === "Cash",
      );
      if (portions.length)
        receipt(
          tx,
          portions.reduce((sum, p) => sum + p.amountCents, 0),
          figure === "selectedPayment"
            ? `${payment} payment portions`
            : "Cash portion of receipt",
        );
    }
  for (const entry of data.cashEntries) {
    if (figure === "drawerMovement" && ["in", "out"].includes(entry.type))
      cash(entry, entry.type === "out" ? -1 : 1);
    else if (figure === "cashIn" && entry.type === "in") cash(entry);
    else if (entry.type === "out") {
      if (
        figure === "cashOut" ||
        (CATEGORY_FIGURES[figure] &&
          CATEGORY_FIGURES[figure] === entry.category) ||
        (["operatingExpenses", "operatingProfit"].includes(figure) &&
          entry.category === "operating_expense") ||
        (figure === "unclassified" &&
          !Object.values(CATEGORY_FIGURES).includes(entry.category))
      )
        cash(entry, figure === "operatingProfit" ? -1 : 1);
    }
  }
  rows.sort(
    (a, b) =>
      b.datetime - a.datetime ||
      String(b.referenceId).localeCompare(String(a.referenceId), "en", {
        numeric: true,
      }) ||
      a.id.localeCompare(b.id),
  );
  const knownTotal = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const computed =
    figure === "average"
      ? data.totals.transactionCount
        ? Math.round(knownTotal / data.totals.transactionCount)
        : 0
      : knownTotal;
  const tolerance = target.quantity ? 0.000000001 : 0;
  const reconciles =
    rows.every((row) => row.value != null) &&
    Math.abs(computed - target.value) <= tolerance;
  return {
    ...target,
    figure,
    rows,
    knownTotal,
    reconciles,
    ready: target.ready && reconciles,
    denominator: figure === "average" ? data.totals.transactionCount : null,
  };
}
