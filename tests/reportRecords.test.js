import test from "node:test";
import assert from "node:assert/strict";
import {
  createReportingDb,
  seedRows,
  business,
} from "./helpers/reportingDb.js";
import { buildReportRecords } from "../src/utils/reportRecords.js";

test("source ledgers reconcile to SQL totals, retaining free sales and excluding purchases from profit", async () => {
  const db = await createReportingDb();
  try {
    const item = {
      name: "Coffee",
      category: "Drinks",
      reportingType: "sale",
      quantity: 1,
      price: 100,
      cost: 40,
    };
    await seedRows(db, "transactions", [
      {
        id: 1,
        receiptNo: "SPLIT",
        datetime: 1,
        status: "completed",
        total: 90,
        orderDiscountAmount: 15,
        items: [
          item,
          {
            name: "Box",
            quantity: 1,
            price: 5,
            cost: 2,
            reportingType: "packaging",
          },
        ],
        paymentLines: [
          { method: "Cash", amount: 30 },
          { method: "GCash", amount: 60 },
        ],
      },
      {
        id: 2,
        receiptNo: "FREE",
        datetime: 2,
        status: "completed",
        total: 0,
        orderDiscount: 100,
        items: [item],
        paymentMethod: "Loyalty",
      },
      {
        id: 3,
        receiptNo: "WASTE",
        datetime: 3,
        status: "completed",
        total: 0,
        items: [
          {
            ...item,
            name: "Waste",
            reportingType: "waste",
            price: 0,
            cost: 5,
            quantity: 2,
          },
        ],
        paymentMethod: "Loyalty",
      },
      {
        id: 4,
        receiptNo: "VOID",
        datetime: 4,
        status: "void",
        total: 999,
        items: [],
        paymentMethod: "Cash",
      },
    ]);
    await seedRows(db, "cash_drawer", [
      { id: 1, type: "in", amount: 100, datetime: 1 },
      {
        id: 2,
        type: "out",
        amount: 20,
        category: "operating_expense",
        datetime: 2,
      },
      {
        id: 3,
        type: "out",
        amount: 50,
        category: "stock_purchase",
        datetime: 3,
      },
      {
        id: 4,
        type: "out",
        amount: 10,
        category: "owner_withdrawal",
        datetime: 4,
      },
    ]);
    const data = await business(db);
    assert.equal(data.totals.issueCount, 0);
    for (const figure of [
      "sales",
      "transactions",
      "average",
      "items",
      "cogs",
      "grossProfit",
      "operatingCashOut",
      "waste",
      "operatingExpenses",
      "operatingProfit",
      "cashOut",
      "stockPurchase",
      "ownerWithdrawal",
      "unclassified",
      "cashSales",
      "cashIn",
      "drawerMovement",
      "voids",
    ]) {
      const model = buildReportRecords(data, figure);
      assert.ok(model.ready, `${figure} must reconcile`);
      assert.ok(model.reconciles, figure);
    }
    const sales = buildReportRecords(data, "sales");
    assert.equal(sales.value, 9000);
    assert.equal(sales.rows.length, 3); // Includes zero-value completed source receipts.
    assert.equal(buildReportRecords(data, "transactions").value, 2);
    assert.equal(buildReportRecords(data, "items").rows.length, 2);
    assert.equal(buildReportRecords(data, "cogs").rows.length, 3); // Packaging included.
    const operating = buildReportRecords(data, "operatingExpenses");
    assert.equal(operating.value, 3000);
    assert.equal(operating.rows.length, 2); // Reviewed expense plus waste, once.
    const profit = buildReportRecords(data, "operatingProfit");
    assert.equal(profit.value, -2200);
    assert.equal(profit.rows.filter((row) => row.entry).length, 1);
    assert.equal(buildReportRecords(data, "drawerMovement").value, 5000);
    assert.equal(
      buildReportRecords(
        { ...data, selectedPaymentCents: 6000 },
        "selectedPayment",
        "GCash",
      ).value,
      6000,
    );
    assert.ok(
      buildReportRecords(
        { ...data, selectedPaymentCents: 6000 },
        "selectedPayment",
        "GCash",
      ).ready,
    );
    await seedRows(db, "cash_drawer", [
      { id: 5, type: "out", amount: 7, datetime: 5 },
    ]);
    const unresolved = await business(db);
    assert.equal(
      buildReportRecords(unresolved, "operatingProfit").ready,
      false,
    );
    assert.equal(
      buildReportRecords(unresolved, "sales").rows.filter((row) => row.entry)
        .length,
      0,
    );
    assert.equal(buildReportRecords(unresolved, "cashOut").value, 8700);
    assert.equal(buildReportRecords(unresolved, "unclassified").rows.length, 1);
    await seedRows(db, "transactions", [
      {
        id: 5,
        datetime: 5,
        status: "completed",
        total: 50,
        items: [{ ...item, price: 50, cost: null }],
        paymentMethod: "Cash",
      },
    ]);
    const missing = buildReportRecords(await business(db), "cogs");
    assert.equal(missing.ready, false);
    assert.equal(missing.rows.filter((row) => row.value === null).length, 1);
    assert.equal(
      buildReportRecords(
        { ...data, totals: { ...data.totals, salesCents: 9001 } },
        "sales",
      ).ready,
      false,
      "Unexplained source differences must not display a verified total",
    );
    const empty = await business(db, 100, 200);
    assert.equal(buildReportRecords(empty, "average").value, 0);
    assert.ok(buildReportRecords(empty, "average").ready);
  } finally {
    await db.close();
  }
});
