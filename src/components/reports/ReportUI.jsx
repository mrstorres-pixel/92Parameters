import React from "react";
import { NavLink } from "react-router-dom";
import { REPORT_MIGRATION_URL, money } from "../../utils/reporting";
import { reportDateTime } from "../../utils/reportDates";
import "../../styles/reports.css";
import { useAuthStore } from "../../stores/authStore";

export function ReportFrame({
  title,
  children,
  generatedAt,
  onRefresh,
  actions,
  period,
}) {
  const role = useAuthStore((state) => state.currentStaff?.role);
  return (
    <section className="reports-surface">
      <header className="report-heading">
        <h1 className="report-sr-only">{title}</h1>
        <nav className="report-links" aria-label="Report views">
          {role === "owner" && (
            <NavLink to="/reports" end>
              Business
            </NavLink>
          )}
          <NavLink to="/transactions">Transactions</NavLink>
          <NavLink to="/cash">Cash</NavLink>
        </nav>
        {actions && <div className="report-actions">{actions}</div>}
      </header>
      <div className="report-toolbar">
        {period}
        <div className="report-refresh">
          <button className="btn btn-secondary" onClick={onRefresh}>
            Refresh report
          </button>
          <p className="report-asof">
            {generatedAt
              ? `As of ${reportDateTime(generatedAt)}`
              : "Waiting for complete report"}
          </p>
        </div>
      </div>
      {children}
      <ReportExplanation title="About these figures">
        POS-recorded amounts · Philippine business time (Asia/Manila) · PHP.
        Sales are after discounts and loyalty reductions. No separate tax amount
        is recorded.
      </ReportExplanation>
    </section>
  );
}
export function ReportState({ state }) {
  if (state.status === "ready") return null;
  if (state.status === "loading")
    return (
      <div className="report-panel" role="status">
        Loading the complete report…
      </div>
    );
  return (
    <div className="report-notice report-notice-warning" role="alert">
      <h2>
        {state.error?.setupRequired
          ? "Reports update needs database setup"
          : "Report could not be verified"}
      </h2>
      <p>
        {state.error?.setupRequired
          ? "Run the additive reports migration in the café’s Supabase SQL Editor, then refresh. Existing receipts are unchanged. No partial totals are displayed."
          : state.error?.message}
      </p>
      {state.error?.setupRequired && (
        <a href={REPORT_MIGRATION_URL} target="_blank" rel="noreferrer">
          Open the reports SQL migration
        </a>
      )}
    </div>
  );
}
export function ReportPeriod({
  range,
  onRange,
  customStart,
  onStart,
  customEnd,
  onEnd,
  lookbackAmount,
  onAmount,
  lookbackUnit,
  onUnit,
  bounds,
  error,
}) {
  return (
    <div className="report-period">
      <div className="report-range-tabs" aria-label="Report period">
        {[
          ["today", "Today"],
          ["week", "7 Days"],
          ["month", "30 Days"],
          ["custom", "Custom"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={range === key}
            onClick={() => onRange(key)}
          >
            {label}
          </button>
        ))}
        <select
          aria-label="More periods"
          value={
            ["yesterday", "year", "lookback", "all"].includes(range)
              ? range
              : ""
          }
          onChange={(event) => onRange(event.target.value)}
        >
          <option value="" disabled>
            More periods
          </option>
          <option value="yesterday">Yesterday</option>
          <option value="year">365 Days</option>
          <option value="lookback">Look Back</option>
          <option value="all">All Time</option>
        </select>
      </div>
      {range === "custom" && (
        <div className="report-filter-row">
          <label>
            From
            <input
              type="date"
              value={customStart}
              onChange={(e) => onStart(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={customEnd}
              onChange={(e) => onEnd(e.target.value)}
            />
          </label>
        </div>
      )}
      {range === "lookback" && (
        <div className="report-filter-row">
          <label>
            Look back
            <input
              type="number"
              min="1"
              max="10000"
              step="1"
              value={lookbackAmount}
              onChange={(e) => onAmount(e.target.value)}
            />
          </label>
          <label>
            Unit
            <select
              value={lookbackUnit}
              onChange={(e) => onUnit(e.target.value)}
            >
              <option value="days">Days</option>
              <option value="months">Months</option>
              <option value="years">Years</option>
            </select>
          </label>
        </div>
      )}
      {error ? (
        <p role="alert" className="report-error">
          {error}
        </p>
      ) : (
        bounds && (
          <p className="report-period-label">
            {formatPeriodDate(bounds.startDate)} —{" "}
            {formatPeriodDate(bounds.endDate)} · inclusive
          </p>
        )
      )}
    </div>
  );
}
export function Metric({ label, value, note, tone, onOpen }) {
  return (
    <div className={`report-metric ${tone ? `report-metric-${tone}` : ""}`}>
      <h2>{label}</h2>
      {onOpen ? (
        <button
          type="button"
          className="report-figure-button"
          aria-label={`View ${label} records`}
          onClick={onOpen}
        >
          <strong>{value}</strong>
          <span className="report-figure-hint">View records ↗</span>
        </button>
      ) : (
        <strong>{value}</strong>
      )}
      {note && <p>{note}</p>}
    </div>
  );
}
function formatPeriodDate(value) {
  if (!value) return "All recorded dates";
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(`${value}T00:00:00+08:00`));
}
export function ReportExplanation({
  title = "How this is calculated",
  children,
}) {
  return (
    <details className="report-explanation">
      <summary>{title}</summary>
      <div className="report-help">{children}</div>
    </details>
  );
}
export function MoneyTable({ rows, caption, onOpen }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        {caption && <caption>{caption}</caption>}
        <tbody>
          {rows.map(([label, value, strong, figure]) => (
            <tr key={label} className={strong ? "report-total" : ""}>
              <th scope="row">{label}</th>
              <td>
                {onOpen && figure ? (
                  <button
                    type="button"
                    className="report-amount-button"
                    aria-label={`View ${label} records`}
                    onClick={() => onOpen(figure)}
                  >
                    <span>
                      {typeof value === "number" ? money(value) : value}
                    </span>
                    <span aria-hidden="true"> ↗</span>
                  </button>
                ) : typeof value === "number" ? (
                  money(value)
                ) : (
                  value
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function BarPanel({
  title,
  rows,
  valueKey = "salesCents",
  quantity = false,
  description,
}) {
  const maximum = Math.max(...rows.map((row) => row[valueKey]), 1);
  const format = (value) =>
    quantity
      ? new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(
          value,
        )
      : money(value);
  return (
    <article className="report-panel">
      <h2>{title}</h2>
      {description && <p className="report-help">{description}</p>}
      {!rows.length ? (
        <p className="report-help">No records for this selection.</p>
      ) : (
        <>
          <div className="report-bars" role="list" aria-label={title}>
            {rows.map((row, index) => (
              <div
                role="listitem"
                className="report-bar-row"
                key={`${row.name}-${index}`}
              >
                <span className="report-bar-name">{row.name}</span>
                <div className="report-bar-track" aria-hidden="true">
                  <div
                    className="report-bar"
                    style={{
                      width: `${(Math.max(0, row[valueKey]) / maximum) * 100}%`,
                    }}
                  />
                </div>
                <span className="report-bar-value">
                  {format(row[valueKey])}
                </span>
              </div>
            ))}
          </div>
          <details className="report-data-table">
            <summary>View exact values as a table</summary>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">{quantity ? "Quantity" : "Amount"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      <th scope="row">{row.name}</th>
                      <td>{format(row[valueKey])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </article>
  );
}
