import React, { useState } from "react";
import { money, reportMetrics } from "../../utils/reporting";
import { reportDateTime } from "../../utils/reportDates";
import { cashOutCategoryLabel } from "../../utils/cashOutCategories";
import { Metric, MoneyTable } from "../reports/ReportUI";
import ReportRecordsDialog from "../reports/ReportRecordsDialog";

export default function CashDrawerContent({
  data,
  canReview,
  onReview,
  isCashier = false,
  recordTools,
  filters,
  onNeedsReview,
}) {
  const m = data ? reportMetrics(data) : null,
    [records, setRecords] = useState(null);
  const openRecords = (figure) => setRecords({ figure, source: data });
  const value = (cents) => (m.cashReady ? money(cents) : "Needs review");
  return (
    <>
      {data && (
        <div
          className="report-metrics cash-drawer-metrics"
          aria-label="Cash drawer totals"
        >
          <Metric
            label="Cash sales"
            value={value(m.cashSalesCents)}
            tone={m.cashReady ? "positive" : undefined}
            onOpen={() => openRecords("cashSales")}
          />
          <Metric
            label="Manual cash in"
            value={value(m.cashInCents)}
            tone={m.cashReady ? "positive" : undefined}
            onOpen={() => openRecords("cashIn")}
          />
          <Metric
            label="Total cash out"
            value={value(m.cashOutCents)}
            tone={m.cashReady ? "negative" : undefined}
            onOpen={() => openRecords("cashOut")}
          />
          <Metric
            label="Recorded drawer movement"
            value={value(m.drawerMovementCents)}
            onOpen={() => openRecords("drawerMovement")}
          />
        </div>
      )}
      {data && !m.cashReady && (
        <p className="cash-review-notice" role="status">
          Some cash records need review. Open a figure to see its underlying
          records.
        </p>
      )}
      <article className="cash-records">
        <header className="cash-records-heading">
          <h2>
            Cash records{" "}
            {data && <span>({data.matchingEntries.length} matching)</span>}
          </h2>
          {recordTools}
        </header>
        {filters}
        {canReview && m?.unclassifiedCount > 0 && onNeedsReview && (
          <button className="cash-review-notice" onClick={onNeedsReview}>
            {m.unclassifiedCount} cash-out{m.unclassifiedCount === 1 ? "" : "s"}{" "}
            need category review <span aria-hidden="true">→</span>
          </button>
        )}
        {data && (
          <div className="report-table-wrap">
            <table className="report-table cash-records-table">
              <thead>
                <tr>
                  <th>Date / time</th>
                  <th>Type</th>
                  <th className="report-money">Amount</th>
                  <th className="cash-category-column">Category</th>
                  <th>Notes</th>
                  <th className="cash-staff-column">Staff</th>
                </tr>
              </thead>
              <tbody>
                {data.matchingEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="cash-record-date" data-label="Date / time">
                      <span>{reportDateTime(entry.datetime)}</span>
                      <details className="cash-record-details report-record-extra">
                        <summary>Details</summary>
                        <dl>
                          <dt>Category</dt>
                          <dd>{cashOutCategoryLabel(entry)}</dd>
                          <dt>Staff</dt>
                          <dd>{entry.staffName || "Unknown"}</dd>
                        </dl>
                        {canReview && entry.type === "out" && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => onReview(entry)}
                          >
                            Review category
                          </button>
                        )}
                      </details>
                    </td>
                    <td data-label="Type">
                      <span className={`cash-type cash-type-${entry.type}`}>
                        {entry.type === "in"
                          ? "Cash in"
                          : entry.type === "out"
                            ? "Cash out"
                            : "Needs review"}
                      </span>
                    </td>
                    <td
                      data-label="Amount"
                      className="report-money cash-record-amount"
                    >
                      {money(entry.amountCents)}
                    </td>
                    <td className="cash-category-column" data-label="Category">
                      {canReview && entry.type === "out" ? (
                        <button
                          className="cash-category-action"
                          aria-label="Review category"
                          onClick={() => onReview(entry)}
                        >
                          {cashOutCategoryLabel(entry)}
                        </button>
                      ) : (
                        cashOutCategoryLabel(entry)
                      )}
                    </td>
                    <td className="cash-record-notes" data-label="Notes">
                      {entry.notes || "—"}
                    </td>
                    <td className="cash-staff-column" data-label="Staff">
                      {entry.staffName || "Unknown"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && !data.matchingEntries.length && (
          <p className="cash-empty">No cash records match this selection.</p>
        )}
      </article>
      {data && (
        <details className="cash-drawer-details report-explanation">
          <summary>
            {isCashier
              ? "How drawer totals work"
              : "Drawer details & category totals"}
          </summary>
          <p>
            Cash sales + manual cash in − total cash out = recorded drawer
            movement. Only the cash portion of split payments enters the drawer.
          </p>
          <p className="report-help">
            This is movement for the selected period, not a counted cash balance
            or profit. Search and filters change the records shown; the four
            totals still cover the complete period. Tap a figure to inspect its
            source records.
          </p>
          {!isCashier && (
            <MoneyTable
              onOpen={openRecords}
              rows={[
                [
                  "Operating expenses",
                  m.operatingCashOutCents,
                  false,
                  "operatingCashOut",
                ],
                [
                  "Stock purchases",
                  m.stockPurchaseCents,
                  false,
                  "stockPurchase",
                ],
                [
                  "Owner withdrawals",
                  m.ownerWithdrawalCents,
                  false,
                  "ownerWithdrawal",
                ],
                [
                  "Unclassified — needs review",
                  m.unclassifiedCents,
                  false,
                  "unclassified",
                ],
                [
                  "Total cash out",
                  m.cashReady ? m.cashOutCents : "Needs review",
                  true,
                  "cashOut",
                ],
              ]}
            />
          )}
        </details>
      )}
      {records && (
        <ReportRecordsDialog {...records} onClose={() => setRecords(null)} />
      )}
    </>
  );
}
