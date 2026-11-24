import React, { useState, useEffect, useRef } from "react";
import { Search, Ban, Trash2, Eye, Receipt, Download } from "lucide-react";
import db from "../db/database";
import Modal from "../components/common/Modal";
import ReceiptModal from "../components/pos/ReceiptModal";
import PaymentProofViewer from "../components/pos/PaymentProofViewer";
import { api, secureBackend } from "../utils/secureApi";
import useCashierDay from "../hooks/useCashierDay";
import {
  CashierCashTotals,
  TodayPeriod,
} from "../components/reports/CashierToday";
import { useToast } from "../components/common/Toast";
import { useAuthStore } from "../stores/authStore";
import { formatCurrency } from "../utils/formatters";
import { calcItemTotal } from "../utils/calculations";
import {
  PAGE_SIZE,
  downloadJson,
  recordIngredientMovement,
  reverseDailySalesSummary,
} from "../utils/durability";
import { adjustIngredientStock } from "../utils/stockAdjustments";
import { formatPaymentLabel, REPORT_PAYMENT_METHODS } from "../utils/payments";
import { reverseLoyaltyForTransaction } from "../utils/loyalty";
import useReport from "../hooks/useReport";
import { reportRange, reportDateTime } from "../utils/reportDates";
import { money, periodParams, requestReport } from "../utils/reporting";
import {
  ReportFrame,
  ReportState,
  ReportPeriod,
} from "../components/reports/ReportUI";
import { useReportPeriod } from "../stores/reportPeriodStore";
import ReportRecordsDialog from "../components/reports/ReportRecordsDialog";

function formatAdjustment(percent, amount) {
  const parts = [];
  if (Number(percent || 0) > 0) parts.push(`${percent}%`);
  if (Number(amount || 0) > 0) parts.push(formatCurrency(amount));
  return parts.length ? parts.join(" + ") : "-";
}

function formatUnitPrice(item) {
  if (Number(item.customPrice || 0) <= 0) return formatCurrency(item.price);
  return `${formatCurrency(item.customPrice)} custom`;
}

export default function TransactionReport() {
  const [reload, setReload] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const exportRequest = useRef(null);
  const [staff, setStaff] = useState([]);
  const [search, setSearch] = useState("");
  const {
    range,
    setRange,
    lookbackAmount,
    setAmount: setLookbackAmount,
    lookbackUnit,
    setUnit: setLookbackUnit,
    customStart,
    setStart: setCustomStart,
    customEnd,
    setEnd: setCustomEnd,
  } = useReportPeriod();
  const [records, setRecords] = useState(null);
  const [paymentFilter, setPaymentFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [staffFilter, setStaffFilter] = useState("All");
  const [selected, setSelected] = useState(null);
  const [showReceipt, setShowReceipt] = useState(null);
  const [showVoid, setShowVoid] = useState(null);
  const [page, setPage] = useState(0);
  const [voidReason, setVoidReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [voidError, setVoidError] = useState("");
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const isOwner = currentStaff?.role === "owner";
  const isCashier = currentStaff?.role === "cashier";
  const cashierDay = useCashierDay(isCashier);
  useEffect(() => {
    if (isCashier) {
      setSelected(null);
      setShowReceipt(null);
      setRecords(null);
      setShowVoid(null);
      setPage(0);
    }
  }, [isCashier, cashierDay.bounds?.startMs]);
  const toast = useToast();

  useEffect(() => {
    db.staff.toArray().then(setStaff);
  }, []);
  useEffect(() => {
    setPage(0);
  }, [
    range,
    customStart,
    customEnd,
    lookbackAmount,
    lookbackUnit,
    paymentFilter,
    statusFilter,
    staffFilter,
    search,
  ]);
  let bounds, rangeError;
  try {
    bounds = isCashier
      ? cashierDay.bounds
      : reportRange({
          range,
          customStart,
          customEnd,
          lookbackAmount,
          lookbackUnit,
        });
  } catch (error) {
    rangeError = error.message;
  }
  if (isCashier) rangeError = cashierDay.error;
  const params = {
    ...(bounds ? periodParams(bounds) : {}),
    p_search: search.trim(),
    p_payment: paymentFilter,
    p_status: statusFilter,
    p_staff: staffFilter,
    p_offset: page * PAGE_SIZE,
    p_limit: PAGE_SIZE,
  };
  const state = useReport(
    "report_transactions_v2",
    params,
    reload,
    Boolean(bounds),
  );
  const queryKey = JSON.stringify(params);
  useEffect(
    () => () => {
      exportRequest.current?.abort();
    },
    [queryKey, isCashier],
  );
  const report = state.data;
  const txns = report?.transactions || [];
  const openRecords = (figure) =>
    setRecords({
      figure,
      expected: report,
      payment: paymentFilter,
      request: {
        name: "report_transactions_v2",
        params: {
          ...params,
          ...(isCashier
            ? {
                p_search: "",
                p_payment: "All",
                p_status: "All",
                p_staff: "All",
              }
            : {}),
          p_offset: 0,
          p_limit: 0,
        },
      },
    });
  function load() {
    if (isCashier) cashierDay.refresh();
    setReload((value) => value + 1);
  }

  async function restoreTransactionIngredients(txn, staff, reason) {
    for (const item of txn.items || []) {
      const links = await db.productIngredients
        .where("productId")
        .equals(item.productId)
        .toArray();
      for (const link of links) {
        const ing = await db.ingredients.get(link.ingredientId);
        if (ing) {
          const restored = link.quantity * item.quantity;
          const { beforeStock, afterStock } = await adjustIngredientStock(
            ing,
            restored,
          );
          await db.auditLog.add({
            action: "RESTOCK",
            entity: ing.name,
            entityId: link.ingredientId,
            staffId: staff?.id,
            staffName: staff?.name,
            datetime: Date.now(),
            details: `Restored ${restored}${ing.unit} from ${reason} ${txn.receiptNo}; stock ${beforeStock}${ing.unit} -> ${afterStock}${ing.unit}`,
          });
          await recordIngredientMovement({
            ingredient: ing,
            ingredientId: link.ingredientId,
            transactionId: txn.id,
            receiptNo: txn.receiptNo,
            type: "RESTOCK",
            quantity: restored,
            beforeStock,
            afterStock,
            staff,
            productName: item.name,
          });
        }
      }
    }
  }

  async function handleVoid() {
    try {
      if (secureBackend) {
        await api("transactions/reverse", {
          method: "POST",
          body: {
            id: showVoid.id,
            pin: managerPin,
            reason: voidReason,
            delete: false,
          },
        });
        toast("Transaction voided");
        setShowVoid(null);
        setSelected(null);
        setVoidReason("");
        setManagerPin("");
        load();
        return;
      }
      const manager = await db.staff.where("pin").equals(managerPin).first();
      if (
        !manager ||
        (manager.role !== "manager" && manager.role !== "owner")
      ) {
        setVoidError("Invalid manager or owner PIN");
        return;
      }

      const txn = showVoid;
      await db.transactions.update(txn.id, { status: "void" });
      await db.voidLog.add({
        transactionId: txn.id,
        receiptNo: txn.receiptNo,
        reason: voidReason,
        staffId: manager.id,
        staffName: manager.name,
        datetime: Date.now(),
        originalData: JSON.parse(JSON.stringify(txn)),
      });
      await reverseDailySalesSummary(txn);
      await reverseLoyaltyForTransaction(txn, manager, "voided transaction");
      await restoreTransactionIngredients(txn, manager, "voided");
      toast("Transaction voided");
      setShowVoid(null);
      setVoidReason("");
      setManagerPin("");
      setVoidError("");
      setSelected(null);
      load();
    } catch (error) {
      console.error("Void failed:", error);
      setVoidError(
        "Could not void transaction. Please check the connection and try again.",
      );
    }
  }

  async function deleteTransaction(txn) {
    if (!isOwner) return;
    if (
      !window.confirm(
        `Delete transaction ${txn.receiptNo}? This removes the record and reverses stock/report totals if it was completed.`,
      )
    )
      return;
    try {
      if (secureBackend) {
        await api("transactions/reverse", {
          method: "POST",
          body: {
            id: txn.id,
            reason: "Owner deleted transaction",
            delete: true,
          },
        });
        toast("Transaction deleted", "info");
        setSelected(null);
        load();
        return;
      }
      if (txn.status !== "void") {
        await reverseDailySalesSummary(txn);
        await reverseLoyaltyForTransaction(
          txn,
          currentStaff,
          "deleted transaction",
        );
        await restoreTransactionIngredients(
          txn,
          currentStaff,
          "deleted transaction",
        );
      }
      await db.voidLog.where("transactionId").equals(txn.id).delete();
      await db.transactions.delete(txn.id);
      await db.auditLog.add({
        action: "DELETE_TRANSACTION",
        entity: txn.receiptNo,
        entityId: txn.id,
        staffId: currentStaff?.id,
        staffName: currentStaff?.name,
        datetime: Date.now(),
        details: `Deleted transaction ${txn.receiptNo}`,
      });
      toast("Transaction deleted", "info");
      setSelected(null);
      load();
    } catch (error) {
      console.error("Delete transaction failed:", error);
      toast(
        "Could not delete transaction. Please check the connection.",
        "error",
      );
    }
  }

  const filtered = txns;
  const totalSales = report?.totals.salesCents || 0;
  const avgTicket = report?.totals.transactionCount
    ? Math.round(totalSales / report.totals.transactionCount)
    : 0;
  const paymentTotals = Object.fromEntries(
    (report?.paymentBreakdown || []).map((row) => [
      row.name,
      { amountCents: row.amountCents },
    ]),
  );
  const paymentOptions = ["All", ...REPORT_PAYMENT_METHODS];
  async function exportFiltered() {
    if (exportBusy || !bounds) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setExportBusy(true);
    try {
      const complete = await requestReport(
        "report_transactions_v2",
        { ...params, p_offset: 0, p_limit: 0 },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      downloadJson(`transactions-${Date.now()}.json`, {
        generatedAt: complete.generatedAt,
        timezone: complete.timezone,
        startMs: complete.startMs,
        endExclusiveMs: complete.endExclusiveMs,
        filters: {
          range: isCashier ? "today" : range,
          customStart: isCashier ? bounds.startDate : customStart,
          customEnd: isCashier ? bounds.endDate : customEnd,
          paymentFilter,
          statusFilter,
          staffFilter,
          search,
        },
        totals: complete.totals,
        selectedPaymentCents: complete.selectedPaymentCents,
        transactions: complete.transactions,
      });
    } catch (error) {
      if (!controller.signal.aborted) toast(error.message, "error");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <ReportFrame
      title="Transaction Report"
      generatedAt={report?.generatedAt}
      onRefresh={load}
      period={
        isCashier ? (
          <TodayPeriod bounds={bounds} />
        ) : (
          <ReportPeriod
            {...{
              range,
              customStart,
              customEnd,
              lookbackAmount,
              lookbackUnit,
              bounds,
            }}
            onRange={setRange}
            onStart={setCustomStart}
            onEnd={setCustomEnd}
            onAmount={setLookbackAmount}
            onUnit={setLookbackUnit}
            error={rangeError}
          />
        )
      }
      actions={
        <button
          className="btn btn-secondary"
          disabled={exportBusy || state.status !== "ready"}
          onClick={exportFiltered}
        >
          <Download size={16} />{" "}
          {exportBusy ? "Exporting…" : "Export all matching receipts"}
        </button>
      }
    >
      <div className="report-filters">
        <div className="report-filters-primary">
          <div className="search-bar">
            <Search size={16} />
            <input
              aria-label="Search receipts"
              placeholder="Search receipt #, staff, payment..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="report-field">
            Payment method
            <select
              aria-label="Payment method"
              className="form-select"
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
            >
              {paymentOptions.map((method) => (
                <option key={method} value={method}>
                  {method === "All" ? "All Payments" : method}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details className="report-explanation">
          <summary>
            More filters (
            {Number(statusFilter !== "All") + Number(staffFilter !== "All")}{" "}
            active)
          </summary>
          <div className="report-filter-row">
            <label className="report-field">
              Receipt status
              <select
                aria-label="Receipt status"
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="void">Void</option>
              </select>
            </label>
            <label className="report-field">
              Staff
              <select
                aria-label="Staff filter"
                className="form-select"
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
              >
                <option value="All">All Staff</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        <p className="report-help report-matching-count">
          Showing {report?.matchingCount || 0} matching record
          {report?.matchingCount !== 1 ? "s" : ""} in the full period
        </p>
      </div>

      {!rangeError && <ReportState state={state} />}
      {report && !rangeError && (
        <>
          {isCashier ? (
            <>
              <CashierCashTotals data={report} />
              <p className="report-help">
                {report.totals.transactionCount} customer transactions today.
                Totals cover all of today; filters change the receipt list.
              </p>
            </>
          ) : (
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-label">
                  {paymentFilter === "All"
                    ? "Full-period sales"
                    : "Full value of matching receipts"}
                </div>
                <button
                  className="report-figure-button"
                  aria-label="View transaction sales records"
                  onClick={() => openRecords("sales")}
                >
                  <div className="stat-value">
                    {report.totals.salesReady
                      ? money(totalSales)
                      : "Needs review"}
                  </div>
                  <span className="report-figure-hint">View records ↗</span>
                </button>
              </div>
              <div className="stat-card">
                <div className="stat-label">Customer transactions</div>
                <button
                  className="report-figure-button"
                  aria-label="View customer transaction records"
                  onClick={() => openRecords("transactions")}
                >
                  <div className="stat-value">
                    {report.totals.transactionCount}
                  </div>
                  <span className="report-figure-hint">View records ↗</span>
                </button>
              </div>
              <div className="stat-card">
                <div className="stat-label">Voids</div>
                <button
                  className="report-figure-button"
                  aria-label="View void records"
                  onClick={() => openRecords("voids")}
                >
                  <div
                    className="stat-value"
                    style={{ color: "var(--danger)" }}
                  >
                    {report.totals.voidCount}
                  </div>
                  <span className="report-figure-hint">View records ↗</span>
                </button>
              </div>
              <div className="stat-card">
                <div className="stat-label">Average Customer Sale</div>
                <button
                  className="report-figure-button"
                  aria-label="View average customer sale records"
                  onClick={() => openRecords("average")}
                >
                  <div className="stat-value">
                    {report.totals.salesReady
                      ? money(avgTicket)
                      : "Needs review"}
                  </div>
                  <span className="report-figure-hint">View records ↗</span>
                </button>
              </div>
            </div>
          )}

          {!isCashier && paymentFilter !== "All" && (
            <div className="report-notice">
              <button
                className="report-amount-button"
                onClick={() => openRecords("selectedPayment")}
                aria-label={`View ${paymentFilter} portion records`}
              >
                <strong>
                  {paymentFilter} portions: {money(report.selectedPaymentCents)}
                </strong>
                <span aria-hidden="true"> ↗</span>
              </button>
              <p>
                Full receipt values include all portions of matching
                split-payment receipts.
              </p>
            </div>
          )}
          <p className="report-help">
            {isCashier
              ? "Cash summaries cover all of today; filters change the receipt list."
              : "Summaries cover all matching records, not just this page."}{" "}
            Waste-only entries are excluded from customer counts; free customer
            sales are included.
          </p>
          {!isCashier && (
            <div className="card report-table-card mb-16">
              <div className="card-title mb-16">Payment Totals</div>
              <div className="payment-total-grid">
                {Object.entries(paymentTotals).length === 0 ? (
                  <span className="text-muted text-sm">
                    No completed sales in this view.
                  </span>
                ) : (
                  Object.entries(paymentTotals)
                    .sort((a, b) => b[1].amountCents - a[1].amountCents)
                    .map(([method, totals]) => (
                      <div key={method} className="payment-total-item">
                        <span>{method}</span>
                        <strong>{money(totals.amountCents)}</strong>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}

          <div className="table-container">
            <table className="data-table report-record-table">
              <thead>
                <tr>
                  <th className="report-secondary-column">Date / Time</th>
                  <th>Receipt #</th>
                  <th className="report-secondary-column">Type</th>
                  <th className="report-secondary-column">Items</th>
                  <th>Payment</th>
                  <th className="report-secondary-column">Staff</th>
                  <th className="report-money">Receipt total</th>
                  {paymentFilter !== "All" && <th>{paymentFilter} portion</th>}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td className="report-secondary-column">
                      {reportDateTime(t.datetime)}
                    </td>
                    <td
                      data-label="Receipt"
                      className="report-record-identity"
                      style={{ fontWeight: 600, color: "var(--accent)" }}
                    >
                      {t.receiptNo}
                      <span className="report-record-date">
                        {reportDateTime(t.datetime)}
                      </span>
                    </td>
                    <td className="report-secondary-column">
                      <span className="badge badge-neutral">{t.orderType}</span>
                    </td>
                    <td
                      className="truncate report-secondary-column"
                      style={{ maxWidth: 200 }}
                    >
                      {(t.items || [])
                        .map(
                          (i) =>
                            `${i.name}×${i.quantity}${i.note ? ` (${i.note})` : ""}`,
                        )
                        .join(", ")}
                    </td>
                    <td data-label="Payment">
                      {t.report.payments.map((p) => p.method).join(" + ") ||
                        (t.report.totalCents === 0
                          ? "No payment (free)"
                          : "Needs payment review")}
                      {t.report.paymentSource === "review" && (
                        <div className="text-muted text-sm">
                          Reviewed breakdown
                        </div>
                      )}
                    </td>
                    <td className="report-secondary-column">
                      {t.staffName || "—"}
                    </td>
                    <td
                      data-label="Receipt total"
                      className="report-money"
                      style={{ fontWeight: 600 }}
                    >
                      {money(t.report.totalCents)}
                    </td>
                    {paymentFilter !== "All" && (
                      <td
                        data-label={`${paymentFilter} portion`}
                        className="report-money"
                      >
                        {money(
                          t.report.payments
                            .filter((p) => p.method === paymentFilter)
                            .reduce((sum, p) => sum + p.amountCents, 0),
                        )}
                      </td>
                    )}
                    <td data-label="Status">
                      {t.status === "void" ? (
                        <span className="void-stamp">VOID</span>
                      ) : (
                        <span className="badge badge-success">Completed</span>
                      )}
                    </td>
                    <td className="report-record-actions">
                      <div className="flex gap-8">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelected(t)}
                          aria-label={`Details for ${t.receiptNo}`}
                        >
                          <Eye size={18} /> Details
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm report-secondary-column"
                          onClick={() => setShowReceipt(t)}
                          title="Receipt"
                        >
                          <Receipt size={14} />
                        </button>
                        {t.status !== "void" && (
                          <button
                            className="btn btn-ghost btn-icon btn-sm report-secondary-column"
                            onClick={() => setShowVoid(t)}
                            title="Void"
                          >
                            <Ban size={14} />
                          </button>
                        )}
                        {isOwner && (
                          <button
                            className="btn btn-ghost btn-icon btn-sm report-secondary-column"
                            onClick={() => deleteTransaction(t)}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </button>
            <span className="text-sm text-muted">
              Page {page + 1} of{" "}
              {Math.max(1, Math.ceil(report.matchingCount / PAGE_SIZE))}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= report.matchingCount}
            >
              Next
            </button>
          </div>
        </>
      )}

      {selected && (
        <Modal
          title={`Transaction ${selected.receiptNo}`}
          large
          onClose={() => setSelected(null)}
          footer={
            <>
              {isOwner && (
                <button
                  className="btn btn-danger"
                  onClick={() => deleteTransaction(selected)}
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
              {selected.status !== "void" && (
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    setShowVoid(selected);
                    setSelected(null);
                  }}
                >
                  <Ban size={14} /> Void
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowReceipt(selected);
                  setSelected(null);
                }}
              >
                View Receipt
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </>
          }
        >
          <div className="form-row mb-16">
            <div>
              <span className="form-label">Receipt #</span>
              <div style={{ fontWeight: 600 }}>{selected.receiptNo}</div>
            </div>
            <div>
              <span className="form-label">Date & Time</span>
              <div>{reportDateTime(selected.datetime)}</div>
            </div>
          </div>
          <div className="form-row mb-16">
            <div>
              <span className="form-label">Order Type</span>
              <div>
                <span className="badge badge-neutral">
                  {selected.orderType}
                </span>
              </div>
            </div>
            <div>
              <span className="form-label">Payment</span>
              <div>{formatPaymentLabel(selected)}</div>
            </div>
          </div>
          <div className="form-row mb-16">
            <div>
              <span className="form-label">Staff</span>
              <div>{selected.staffName || "—"}</div>
            </div>
            <div>
              <span className="form-label">Status</span>
              <div>
                {selected.status === "void" ? (
                  <span className="void-stamp">VOID</span>
                ) : (
                  <span className="badge badge-success">Completed</span>
                )}
              </div>
            </div>
          </div>

          {secureBackend &&
            ["owner", "manager"].includes(currentStaff?.role) && (
              <PaymentProofViewer
                transactionId={selected.id}
                isOwner={isOwner}
              />
            )}
          {selected.customerName && (
            <div className="table-container" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>Member</td>
                    <td className="text-right">{selected.customerName}</td>
                  </tr>
                  <tr>
                    <td>Member Code</td>
                    <td className="text-right">{selected.memberCode || "-"}</td>
                  </tr>
                  {Number(selected.loyaltyDiscount || 0) > 0 && (
                    <tr>
                      <td>Loyalty Discount</td>
                      <td className="text-right">
                        -{formatCurrency(selected.loyaltyDiscount)}
                      </td>
                    </tr>
                  )}
                  {Number(selected.loyaltyRedeemed || 0) > 0 && (
                    <tr>
                      <td>Points Redeemed</td>
                      <td className="text-right">{selected.loyaltyRedeemed}</td>
                    </tr>
                  )}
                  {Number(selected.loyaltyEarned || 0) > 0 && (
                    <tr>
                      <td>Points Earned</td>
                      <td className="text-right">{selected.loyaltyEarned}</td>
                    </tr>
                  )}
                  {selected.birthdayRewardRedeemed && (
                    <tr>
                      <td>Birthday Reward</td>
                      <td className="text-right">Redeemed</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!isCashier && selected.report && (
            <article className="report-panel">
              <h4>Reporting reconciliation</h4>
              <p className="report-help">
                The reporting view below applies saved reviews. Original items
                and receipt amounts are preserved below; View Receipt always
                shows the original receipt.
              </p>
              <div className="report-table-wrap">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Item / reporting type</th>
                      <th>Allocated sales</th>
                      <th>Historical line cost</th>
                      <th>Cost source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.report.lines.map((line) => (
                      <tr key={line.index}>
                        <th>
                          {line.name}
                          <div className="report-help">{line.kind}</div>
                        </th>
                        <td>{money(line.salesCents)}</td>
                        <td>{money(line.costCents)}</td>
                        <td>
                          {line.costSource === "review"
                            ? "Owner-reviewed cost"
                            : "Saved receipt cost"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selected.report.issues.length > 0 && (
                <p className="report-error">
                  This record has {selected.report.issues.length} unresolved
                  reporting issues. Owner review is available in Business Report
                  → Data Review.
                </p>
              )}
            </article>
          )}

          {(selected.report?.payments.length || 0) > 0 && (
            <div className="table-container" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Payment Method</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.report.payments.map((line, index) => (
                    <tr key={`${line.method}-${index}`}>
                      <td>
                        {line.method}
                        {selected.report.paymentSource === "review"
                          ? " (reviewed)"
                          : ""}
                      </td>
                      <td className="text-right">{money(line.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4
            style={{
              fontSize: "0.9rem",
              marginBottom: 8,
              color: "var(--text-secondary)",
            }}
          >
            Items
          </h4>
          <div className="table-container" style={{ marginBottom: 16 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Discount</th>
                  <th>Markup</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(selected.items || []).map((item, i) => (
                  <tr key={i}>
                    <td>
                      <div>{item.name}</div>
                      {item.note && (
                        <div
                          className="text-muted text-sm"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          Note: {item.note}
                        </div>
                      )}
                    </td>
                    <td>{item.quantity}</td>
                    <td>{formatUnitPrice(item)}</td>
                    <td>
                      {formatAdjustment(item.discount, item.discountAmount)}
                    </td>
                    <td>{formatAdjustment(item.markup, item.markupAmount)}</td>
                    <td style={{ fontWeight: 600 }}>
                      {formatCurrency(calcItemTotal(item))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(selected.orderDiscount > 0 || selected.orderDiscountAmount > 0) && (
            <div className="table-container" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <tbody>
                  {selected.subtotal && (
                    <tr>
                      <td>Subtotal</td>
                      <td className="text-right">
                        {formatCurrency(selected.subtotal)}
                      </td>
                    </tr>
                  )}
                  {selected.orderDiscount > 0 && (
                    <tr>
                      <td>Order Discount</td>
                      <td className="text-right">-{selected.orderDiscount}%</td>
                    </tr>
                  )}
                  {selected.orderDiscountAmount > 0 && (
                    <tr>
                      <td>Order Discount Cash</td>
                      <td className="text-right">
                        -{formatCurrency(selected.orderDiscountAmount)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {Number(selected.loyaltyDiscount || 0) > 0 && (
            <div className="table-container" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>Loyalty Discount</td>
                    <td className="text-right">
                      -{formatCurrency(selected.loyaltyDiscount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <div
            className="flex-between"
            style={{ fontSize: "1.1rem", fontWeight: 700 }}
          >
            <span>Total</span>
            <span>{formatCurrency(selected.total)}</span>
          </div>
        </Modal>
      )}

      {showVoid && (
        <Modal
          title="Void Transaction"
          onClose={() => {
            setShowVoid(null);
            setVoidError("");
          }}
          footer={
            <>
              <button
                className="btn btn-secondary"
                onClick={() => setShowVoid(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleVoid}
                disabled={!voidReason || !managerPin}
              >
                Confirm Void
              </button>
            </>
          }
        >
          <p style={{ marginBottom: 16, fontSize: "0.9rem" }}>
            Voiding <strong>{showVoid.receiptNo}</strong> —{" "}
            {formatCurrency(showVoid.total)}
          </p>
          <div className="form-group">
            <label className="form-label">Reason for voiding *</label>
            <input
              className="form-input"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Enter reason"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Manager PIN *</label>
            <input
              className="form-input"
              type="password"
              maxLength={4}
              value={managerPin}
              onChange={(e) => {
                setManagerPin(e.target.value);
                setVoidError("");
              }}
              placeholder="Enter manager PIN"
            />
          </div>
          {voidError && (
            <p style={{ color: "var(--danger)", fontSize: "0.85rem" }}>
              {voidError}
            </p>
          )}
        </Modal>
      )}

      {showReceipt && (
        <ReceiptModal
          transaction={showReceipt}
          onClose={() => setShowReceipt(null)}
        />
      )}
      {records && (
        <ReportRecordsDialog
          {...records}
          onClose={() => setRecords(null)}
          onRefresh={load}
        />
      )}
    </ReportFrame>
  );
}
