import React from "react";
import { Link } from "react-router-dom";
import { REPORT_MIGRATION_URL, money } from "../../utils/reporting";
import { reportDateTime } from "../../utils/reportDates";
import "../../styles/reports.css";

export function ReportFrame({
  title,
  children,
  generatedAt,
  onRefresh,
  actions,
}) {
  return (
    <section className="reports-surface">
      <header className="report-heading">
        <div>
          <p className="report-eyebrow">92PARAMETERS / REPORTS</p>
          <h1>{title}</h1>
          <p className="report-subtitle">
            Recorded POS amounts · Philippine business time · PHP
          </p>
        </div>
        <div className="report-actions">
          {actions}
          <button className="btn btn-secondary" onClick={onRefresh}>
            Refresh report
          </button>
        </div>
      </header>
      <nav className="report-links" aria-label="Report views">
        <Link to="/reports">Business overview</Link>
        <Link to="/transactions">Transactions</Link>
        <Link to="/cash">Cash drawer & monthly reports</Link>
      </nav>
      {generatedAt && (
        <p className="report-asof">As of {reportDateTime(generatedAt)}</p>
      )}
      {children}
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
    <div className="report-panel report-period">
      <div className="report-range-tabs" aria-label="Report period">
        {[
          ["today", "Today"],
          ["yesterday", "Yesterday"],
          ["week", "7 Days"],
          ["month", "30 Days"],
          ["year", "365 Days"],
          ["lookback", "Look Back"],
          ["custom", "Custom"],
          ["all", "All Time"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={range === key}
            onClick={() => onRange(key)}
          >
            {label}
          </button>
        ))}
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
            {bounds.startDate} — {bounds.endDate}, inclusive · Asia/Manila
          </p>
        )
      )}
    </div>
  );
}
export function Metric({ label, value, note, tone }) {
  return (
    <div className={`report-metric ${tone ? `report-metric-${tone}` : ""}`}>
      <h2>{label}</h2>
      <strong>{value}</strong>
      {note && <p>{note}</p>}
    </div>
  );
}
export function MoneyTable({ rows, caption }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        {caption && <caption>{caption}</caption>}
        <tbody>
          {rows.map(([label, value, strong]) => (
            <tr key={label} className={strong ? "report-total" : ""}>
              <th scope="row">{label}</th>
              <td>{typeof value === "number" ? money(value) : value}</td>
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
          <div
            className="report-bars"
            role="img"
            aria-label={`${title}. Exact values follow in the data table.`}
          >
            {rows.map((row, index) => (
              <div className="report-bar-row" key={`${row.name}-${index}`}>
                <span className="report-bar-name">{row.name}</span>
                <div className="report-bar-track">
                  <div
                    className="report-bar"
                    style={{
                      width: `${(Math.max(0, row[valueKey]) / maximum) * 100}%`,
                    }}
                  />
                </div>
                <span className="report-bar-value" tabIndex="0">
                  {format(row[valueKey])}
                  <span role="tooltip" className="report-chart-tooltip">
                    {row.name}: {format(row[valueKey])}
                  </span>
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
