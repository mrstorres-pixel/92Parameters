import React, { useState } from "react";
import { Link } from "react-router-dom";
import useReport from "../hooks/useReport";
import { reportRange, reportDateTime } from "../utils/reportDates";
import {
  businessBreakdowns,
  money,
  periodParams,
  reportMetrics,
} from "../utils/reporting";
import {
  ReportFrame,
  ReportState,
  ReportPeriod,
  Metric,
  MoneyTable,
  BarPanel,
  ReportExplanation,
} from "../components/reports/ReportUI";
import ReviewReportItem from "../components/reports/ReviewReportItem";
import ReportRecordsDialog from "../components/reports/ReportRecordsDialog";
import { useReportPeriod } from "../stores/reportPeriodStore";

export default function BusinessReport() {
  const {
    range,
    setRange,
    customStart,
    setStart,
    customEnd,
    setEnd,
    lookbackAmount,
    setAmount,
    lookbackUnit,
    setUnit,
  } = useReportPeriod();
  const [records, setRecords] = useState(null);
  const [tab, setTab] = useState("overview"),
    [payment, setPayment] = useState("All"),
    [reload, setReload] = useState(0),
    [review, setReview] = useState(null);
  const [reviewGroup, setReviewGroup] = useState("all");
  let bounds, rangeError;
  try {
    bounds = reportRange({
      range,
      customStart,
      customEnd,
      lookbackAmount,
      lookbackUnit,
    });
  } catch (error) {
    rangeError = error.message;
  }
  const state = useReport(
    "report_business_v2",
    bounds ? periodParams(bounds) : {},
    reload,
    Boolean(bounds),
  );
  const data = state.data,
    metrics = data ? reportMetrics(data) : null,
    breakdown = data ? businessBreakdowns(data) : null;
  const refresh = () => setReload((value) => value + 1);
  const openRecords = (figure) => setRecords({ figure, source: data });
  const paidTotal =
    breakdown?.payments.reduce((sum, row) => sum + row.salesCents, 0) || 0;
  const issueGroup = (issue) =>
    issue.code === "classification_review"
      ? "classification"
      : issue.code === "cost_review"
        ? "cost"
        : "reconciliation";
  const reviewGroups = [
    ["classification", "Product classification"],
    ["cost", "Costs"],
    ["reconciliation", "Reconciliation"],
  ];
  return (
    <ReportFrame
      title="Business Report"
      generatedAt={data?.generatedAt}
      onRefresh={refresh}
      period={
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
          onStart={setStart}
          onEnd={setEnd}
          onAmount={setAmount}
          onUnit={setUnit}
          error={rangeError}
        />
      }
    >
      {!rangeError && <ReportState state={state} />}
      {data && !rangeError && (
        <>
          <div
            className="report-section-tabs"
            role="tablist"
            aria-label="Business report sections"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              const tabs = [
                ...event.currentTarget.querySelectorAll('[role="tab"]'),
              ];
              const current = tabs.indexOf(document.activeElement);
              if (current < 0) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (current +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              tabs[next].click();
              tabs[next].focus();
            }}
          >
            {[
              ["overview", "Overview"],
              ["sales", "Sales & Payments"],
              ["profit", "Profit & Expenses"],
              ["review", "Data Review"],
            ].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                tabIndex={tab === key ? 0 : -1}
                aria-controls={`report-${key}`}
                id={`tab-${key}`}
                onClick={() => setTab(key)}
              >
                {label}
                {key === "review" &&
                metrics.issueCount + metrics.unclassifiedCount > 0
                  ? ` (${metrics.issueCount + metrics.unclassifiedCount})`
                  : ""}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`report-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "overview" && (
              <>
                <div className="report-metrics">
                  <Metric
                    label="Sales"
                    onOpen={() => openRecords("sales")}
                    value={
                      metrics.salesReady
                        ? money(metrics.salesCents)
                        : "Needs review"
                    }
                    note="Completed customer sales, after discounts"
                  />
                  <Metric
                    label="Customer Transactions"
                    onOpen={() => openRecords("transactions")}
                    value={metrics.transactionCount}
                    note={`${metrics.freeCustomerCount} fully discounted customer sales included`}
                  />
                  <Metric
                    label="Average Customer Sale"
                    onOpen={() => openRecords("average")}
                    value={
                      metrics.salesReady
                        ? money(
                            metrics.transactionCount
                              ? Math.round(
                                  metrics.salesCents / metrics.transactionCount,
                                )
                              : 0,
                          )
                        : "Needs review"
                    }
                  />
                  <Metric
                    label="Customer Items Sold"
                    onOpen={() => openRecords("items")}
                    value={metrics.customerItems}
                    note="Excludes packaging and waste"
                  />
                </div>
                <div
                  className={`report-notice report-profit-status ${!metrics.profitReady ? "report-notice-warning" : ""}`}
                >
                  <div>
                    <h2>
                      {metrics.profitReady
                        ? "Operating profit"
                        : "Profit pending review"}
                    </h2>
                    {metrics.profitReady ? (
                      <button
                        className="report-amount-button report-profit-amount"
                        aria-label="View operating profit records"
                        onClick={() => openRecords("operatingProfit")}
                      >
                        {money(metrics.operatingProfitCents)} ↗
                      </button>
                    ) : (
                      <p>
                        {metrics.unclassifiedCount} unclassified cash-outs (
                        {money(metrics.unclassifiedCents)}) and{" "}
                        {metrics.issueCount} receipt or cash-data issues.
                      </p>
                    )}
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={() =>
                      setTab(metrics.profitReady ? "profit" : "review")
                    }
                  >
                    {metrics.profitReady
                      ? "View profit calculation"
                      : "Review outstanding records"}
                  </button>
                </div>
                <div className="report-columns">
                  <BarPanel
                    title="Customer sales by hour"
                    rows={breakdown.hours.filter((row) => row.salesCents > 0)}
                    description="Exact receipt amounts grouped by Philippine hour."
                  />
                  <BarPanel
                    title="Top customer products"
                    rows={breakdown.products.slice(0, 8)}
                    valueKey="quantity"
                    quantity
                    description="Quantity sold. Packaging and milk/waste are excluded."
                  />
                </div>
                <ReportExplanation title="What is included in the overview?">
                  {metrics.wasteRecordCount} waste-only records are separate
                  from customer transactions. Sales use POS-recorded amounts; no
                  separate tax amount is recorded.
                </ReportExplanation>
              </>
            )}
            {tab === "sales" && (
              <>
                <div className="report-columns">
                  <BarPanel
                    title="Sales by category"
                    rows={breakdown.categories}
                    description="Includes packaging revenue. Receipt discounts and loyalty reductions are allocated to reconcile exactly to sales."
                  />
                  <article className="report-panel">
                    <h2>Category reconciliation</h2>
                    <div className="report-table-wrap">
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th>Quantity</th>
                            <th>Sales after discounts</th>
                            <th>Recorded cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdown.categories.map((row) => (
                            <tr key={row.name}>
                              <th scope="row">{row.name}</th>
                              <td>{row.quantity}</td>
                              <td>{money(row.salesCents)}</td>
                              <td>
                                {row.costReady
                                  ? money(row.costCents)
                                  : "Needs review"}
                              </td>
                            </tr>
                          ))}
                          <tr className="report-total">
                            <th>Total including packaging</th>
                            <td>—</td>
                            <td>
                              {metrics.salesReady
                                ? money(metrics.salesCents)
                                : "Needs review"}
                            </td>
                            <td>
                              {metrics.costReady
                                ? money(metrics.cogsCents)
                                : "Needs review"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </article>
                </div>
                <article className="report-panel">
                  <h2>Recorded payment portions</h2>
                  <p className="report-help">
                    POS-recorded payments, not confirmation of bank or
                    delivery-platform payouts. This filter affects only the
                    payment breakdown.
                  </p>
                  <label className="report-field report-inline">
                    Payment method
                    <select
                      value={payment}
                      onChange={(e) => setPayment(e.target.value)}
                    >
                      <option>All</option>
                      {breakdown.payments.map((row) => (
                        <option key={row.name}>{row.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="report-table-wrap">
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Method</th>
                          <th>Receipts using method</th>
                          <th>Recorded amount</th>
                          <th>Share of payments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdown.payments
                          .filter(
                            (row) => payment === "All" || payment === row.name,
                          )
                          .map((row) => (
                            <tr key={row.name}>
                              <th>{row.name}</th>
                              <td>{row.quantity}</td>
                              <td>{money(row.salesCents)}</td>
                              <td>
                                {(paidTotal
                                  ? (100 * row.salesCents) / paidTotal
                                  : 0
                                ).toFixed(1)}
                                %
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="report-help">
                    {metrics.freeCustomerCount} fully discounted customer
                    receipts have no payment amount. Split-payment receipt
                    counts must not be added across methods.
                  </p>
                </article>
                <BarPanel
                  title="Payment amounts"
                  rows={breakdown.payments.filter(
                    (row) => payment === "All" || payment === row.name,
                  )}
                />
              </>
            )}
            {tab === "profit" && (
              <>
                <article className="report-panel report-profit-calculation">
                  <h2>Operating profit</h2>
                  <p className="report-help">
                    All payment methods · {bounds.startDate} to {bounds.endDate}
                  </p>
                  <MoneyTable
                    onOpen={openRecords}
                    rows={[
                      [
                        "Sales after discounts",
                        metrics.salesReady
                          ? metrics.salesCents
                          : "Needs review",
                        false,
                        "sales",
                      ],
                      [
                        "Less: cost of goods sold",
                        metrics.costReady ? metrics.cogsCents : "Needs review",
                        false,
                        "cogs",
                      ],
                      [
                        "Gross profit",
                        metrics.salesReady && metrics.costReady
                          ? metrics.grossProfitCents
                          : "Pending cost review",
                        true,
                        "grossProfit",
                      ],
                      [
                        "Reviewed operating cash-out expenses",
                        metrics.operatingCashOutCents,
                        false,
                        "operatingCashOut",
                      ],
                      [
                        "Recorded waste expense",
                        metrics.costReady
                          ? metrics.wasteCents
                          : "Needs cost review",
                        false,
                        "waste",
                      ],
                      [
                        "Total operating expenses",
                        metrics.costReady && metrics.cashReady
                          ? metrics.operatingExpenseCents
                          : "Needs review",
                        false,
                        "operatingExpenses",
                      ],
                      [
                        "Operating profit",
                        metrics.profitReady
                          ? metrics.operatingProfitCents
                          : "Profit pending review",
                        true,
                        "operatingProfit",
                      ],
                    ]}
                  />
                  <ReportExplanation>
                    Product costs include ingredients. Waste is deducted once,
                    separately from goods sold. Stock purchases and owner
                    withdrawals are not operating expenses. This recorded result
                    is before tax and financing costs; unrecorded expenses and
                    depreciation are not included.
                  </ReportExplanation>
                  {!metrics.profitReady && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => setTab("review")}
                    >
                      Review profit inputs
                    </button>
                  )}
                </article>
                <div className="report-columns">
                  <article className="report-panel">
                    <h2>Physical cash-out breakdown</h2>
                    <MoneyTable
                      onOpen={openRecords}
                      rows={[
                        [
                          "Operating expenses",
                          metrics.operatingCashOutCents,
                          false,
                          "operatingCashOut",
                        ],
                        [
                          "Stock purchases",
                          metrics.stockPurchaseCents,
                          false,
                          "stockPurchase",
                        ],
                        [
                          "Owner withdrawals",
                          metrics.ownerWithdrawalCents,
                          false,
                          "ownerWithdrawal",
                        ],
                        [
                          "Unclassified — needs review",
                          metrics.unclassifiedCents,
                          false,
                          "unclassified",
                        ],
                        [
                          "Total cash out",
                          metrics.cashReady
                            ? metrics.cashOutCents
                            : "Needs review",
                          true,
                          "cashOut",
                        ],
                      ]}
                    />
                    <Link to="/cash?review=1">
                      Review cash-out categories in Monthly Reports
                    </Link>
                  </article>
                  <article className="report-panel">
                    <h2>Recorded drawer movement</h2>
                    <MoneyTable
                      onOpen={openRecords}
                      rows={[
                        [
                          "Cash portions of customer sales",
                          metrics.cashReady
                            ? metrics.cashSalesCents
                            : "Needs payment review",
                          false,
                          "cashSales",
                        ],
                        [
                          "Manual cash in",
                          metrics.cashInCents,
                          false,
                          "cashIn",
                        ],
                        [
                          "Less: cash out",
                          metrics.cashOutCents,
                          false,
                          "cashOut",
                        ],
                        [
                          "Recorded drawer movement",
                          metrics.cashReady
                            ? metrics.drawerMovementCents
                            : "Pending cash review",
                          true,
                          "drawerMovement",
                        ],
                      ]}
                    />
                    <ReportExplanation title="What drawer movement means">
                      Movement only. This is not profit, a counted drawer
                      balance, or total collections across all payment methods.
                    </ReportExplanation>
                  </article>
                </div>
              </>
            )}
            {tab === "review" && (
              <>
                <div className="report-notice report-review-intro">
                  <h2>
                    {metrics.profitReady
                      ? "Report inputs reconcile"
                      : "Profit pending review"}
                  </h2>
                  <p>
                    Review the groups below to complete the profit calculation.
                  </p>
                  <Link to="/cash?review=1">
                    Review {metrics.unclassifiedCount} unclassified cash-outs (
                    {money(metrics.unclassifiedCents)})
                  </Link>
                </div>
                <div
                  className="report-group-filters"
                  role="group"
                  aria-label="Review issue groups"
                >
                  <button
                    aria-pressed={reviewGroup === "all"}
                    onClick={() => setReviewGroup("all")}
                  >
                    All receipt issues ({breakdown.issues.length})
                  </button>
                  {reviewGroups.map(([key, label]) => (
                    <button
                      key={key}
                      aria-pressed={reviewGroup === key}
                      onClick={() => setReviewGroup(key)}
                    >
                      {label} (
                      {
                        breakdown.issues.filter(
                          (issue) => issueGroup(issue) === key,
                        ).length
                      }
                      )
                    </button>
                  ))}
                </div>
                <article className="report-panel">
                  <h2>Receipt and cost issues</h2>
                  {!breakdown.issues.length ? (
                    <p>No unresolved receipt issues in this period.</p>
                  ) : (
                    <div className="report-table-wrap">
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>Receipt / date</th>
                            <th>Item</th>
                            <th>Review needed</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdown.issues
                            .filter(
                              (issue) =>
                                reviewGroup === "all" ||
                                issueGroup(issue) === reviewGroup,
                            )
                            .map((issue, index) => (
                              <tr key={index}>
                                <td>
                                  {issue.transaction.receiptNo ||
                                    issue.transaction.id}
                                  <br />
                                  <small>
                                    {reportDateTime(issue.transaction.datetime)}
                                  </small>
                                </td>
                                <td>
                                  {issue.line?.name || "Receipt / payments"}
                                </td>
                                <td>
                                  {issue.message}
                                  {issue.differenceCents != null && (
                                    <div>
                                      Difference: {money(issue.differenceCents)}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setReview(issue)}
                                  >
                                    Review record
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {breakdown.issues.length > 0 &&
                    !breakdown.issues.some(
                      (issue) =>
                        reviewGroup === "all" ||
                        issueGroup(issue) === reviewGroup,
                    ) && <p>No outstanding issues in this group.</p>}
                </article>
                {data.cashEntries.some(
                  (row) =>
                    row.amountCents == null ||
                    row.amountCents <= 0 ||
                    !["in", "out"].includes(row.type),
                ) && (
                  <div className="report-notice report-notice-warning">
                    Cash records have invalid amounts or types.{" "}
                    <Link to="/cash">Review the original cash records</Link>{" "}
                    before relying on totals.
                  </div>
                )}
                <p className="report-help">
                  Owner-PIN-confirmed reviews are recorded separately with a
                  reason and timestamp.
                </p>
              </>
            )}
          </div>
          {review && (
            <ReviewReportItem
              issue={review}
              onClose={() => setReview(null)}
              onSaved={() => {
                setReview(null);
                refresh();
              }}
            />
          )}
        </>
      )}
      {records && (
        <ReportRecordsDialog {...records} onClose={() => setRecords(null)} />
      )}
    </ReportFrame>
  );
}
