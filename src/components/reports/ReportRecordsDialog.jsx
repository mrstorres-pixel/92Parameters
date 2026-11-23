import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "../common/Modal";
import useReport from "../../hooks/useReport";
import { buildReportRecords, reportFigure } from "../../utils/reportRecords";
import { money } from "../../utils/reporting";
import { businessDate, reportDateTime } from "../../utils/reportDates";
import { ReportState } from "./ReportUI";

const number = (value) =>
  new Intl.NumberFormat("en-PH", { maximumFractionDigits: 6 }).format(value);
export default function ReportRecordsDialog({
  source,
  request,
  figure,
  payment,
  expected,
  onClose,
  onRefresh,
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const state = useReport(
    request?.name || "report_business_v2",
    request?.params || {},
    0,
    Boolean(request),
  );
  const snapshot = source || state.data;
  const model = useMemo(
    () => (snapshot ? buildReportRecords(snapshot, figure, payment) : null),
    [snapshot, figure, payment],
  );
  const title =
    model?.title ||
    (expected ? reportFigure(expected, figure).title : "Source records");
  const changed =
    expected &&
    model &&
    (reportFigure(expected, figure).value !== model.value ||
      reportFigure(expected, figure).ready !== model.ready);
  const filtered =
    model?.rows.filter((row) =>
      `${row.label} ${row.description} ${row.entry?.staffName || row.transaction?.staffName || ""} ${row.line?.name || row.transaction?.report.lines.map((line) => line.name).join(" ") || ""}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
    ) || [];
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const format = (value) =>
    value == null
      ? "Needs review"
      : model?.quantity
        ? number(value)
        : money(value);
  // Keep nested monthly-report dialogs outside the parent's scrolling body.
  return createPortal(
    <Modal
      title={`${title} — source records`}
      large
      overlayClassName="report-source-overlay"
      onClose={onClose}
      footer={
        <>
          {changed && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                onClose();
                onRefresh?.();
              }}
            >
              Refresh summary
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            Close records
          </button>
        </>
      }
    >
      {!source && <ReportState state={state} />}
      {model && (
        <>
          <p className="report-help">
            {businessDate(snapshot.startMs)} —{" "}
            {businessDate(snapshot.endExclusiveMs - 1)} · inclusive ·
            Asia/Manila
            <br />
            As of {reportDateTime(snapshot.generatedAt)}
          </p>
          {changed && (
            <div className="report-notice" role="status">
              Records have changed since the summary loaded. These records and
              their total come from a fresh snapshot. Refresh the summary to
              update it.
            </div>
          )}
          {!model.ready && (
            <div className="report-notice report-notice-warning" role="status">
              {figure === "operatingProfit"
                ? "Profit pending review. "
                : "This figure needs review. "}
              {model.reconciles
                ? "Some report inputs remain unresolved."
                : "Missing or unresolved contributions prevent a verified total."}{" "}
              Original records are shown below.
            </div>
          )}
          <div className="report-records-summary">
            <span>{model.title}</span>
            <strong>
              {model.ready ? format(model.value) : "Needs review"}
            </strong>
            <p className="report-help">
              {model.rows.length} contributing records · totals include every
              page
            </p>
            {model.denominator != null && (
              <p className="report-help">
                {model.denominator > 0
                  ? `${money(model.knownTotal)} sales ÷ ${model.denominator} customer transactions. Zero-value records remain visible.`
                  : "No customer transactions in this period; the average is shown as ₱0.00."}
              </p>
            )}
          </div>
          <label className="report-field">
            Search source records
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Receipt, product, notes or staff"
            />
          </label>
          <p className="report-help">
            {filtered.length} matching source records
          </p>
          <div className="report-source-list">
            {filtered.slice(page * 50, (page + 1) * 50).map((row) => (
              <article className="report-source-record" key={row.id}>
                <div className="report-source-heading">
                  <h3>{row.label}</h3>
                  <strong>{format(row.value)}</strong>
                </div>
                <p>{row.description}</p>
                <p className="report-help">{reportDateTime(row.datetime)}</p>
                <details>
                  <summary>
                    Details for {row.label}
                    {row.line ? ` · ${row.line.name}` : ""}
                  </summary>
                  {row.entry ? (
                    <dl className="report-source-details">
                      <dt>Type</dt>
                      <dd>Cash {row.entry.type}</dd>
                      <dt>Category</dt>
                      <dd>
                        {row.entry.type === "in"
                          ? "Cash in"
                          : row.entry.category?.replaceAll("_", " ") ||
                            "Unclassified — needs review"}
                      </dd>
                      <dt>Notes</dt>
                      <dd>{row.entry.notes || "No notes"}</dd>
                      <dt>Staff</dt>
                      <dd>{row.entry.staffName || "Unknown"}</dd>
                      <dt>Original withdrawal / deposit</dt>
                      <dd>{money(row.entry.amountCents)}</dd>
                    </dl>
                  ) : (
                    <>
                      <p className="report-help">
                        {row.transaction.status} ·{" "}
                        {row.transaction.staffName || "Unknown staff"} ·{" "}
                        {row.transaction.orderType || "Order type not recorded"}
                      </p>
                      <p>
                        Full receipt value:{" "}
                        {money(row.transaction.report.totalCents)}
                      </p>
                      <p>
                        Payment portions:{" "}
                        {row.transaction.report.payments
                          .map(
                            (part) =>
                              `${part.method}: ${money(part.amountCents)}`,
                          )
                          .join(" + ") || "No recorded payment amount"}
                      </p>
                      <div className="report-table-wrap">
                        <table className="report-table">
                          <thead>
                            <tr>
                              <th>Saved receipt item</th>
                              <th>Quantity</th>
                              <th>Reporting type</th>
                              <th>Saved line cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(row.line
                              ? [row.line]
                              : row.transaction.report.lines
                            ).map((line) => (
                              <tr key={line.index}>
                                <th scope="row">{line.name}</th>
                                <td>
                                  {line.quantity == null
                                    ? "Needs review"
                                    : number(line.quantity)}
                                </td>
                                <td>{line.kind || "Needs review"}</td>
                                <td>{money(line.costCents)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {row.transaction.report.issues.length > 0 && (
                        <ul className="report-help">
                          {row.transaction.report.issues.map((issue, index) => (
                            <li key={index}>{issue.message}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </details>
              </article>
            ))}
          </div>
          {!filtered.length && <p>No source records match this selection.</p>}
          <div className="pagination">
            <button
              className="btn btn-secondary"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous records
            </button>
            <span>
              Page {page + 1} of {pages}
            </span>
            <button
              className="btn btn-secondary"
              disabled={page + 1 >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next records
            </button>
          </div>
        </>
      )}
    </Modal>,
    document.querySelector(".reports-surface") || document.body,
  );
}
