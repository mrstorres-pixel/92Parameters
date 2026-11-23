import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import db, { supabase } from "../db/database";
import Modal from "../components/common/Modal";
import { useAuthStore } from "../stores/authStore";
import { useToast } from "../components/common/Toast";
import CashOutCategoryField from "../components/cash/CashOutCategoryField";
import {
  getCashOutCategory,
  cashOutCategoryLabel,
  suggestCashOutCategory,
  cashCategorySaveError,
} from "../utils/cashOutCategories";
import {
  businessDate,
  reportRange,
  reportDateTime,
} from "../utils/reportDates";
import { money, periodParams, reportMetrics } from "../utils/reporting";
import { downloadJson } from "../utils/durability";
import useReport from "../hooks/useReport";
import {
  ReportFrame,
  ReportState,
  Metric,
  MoneyTable,
  ReportExplanation,
} from "../components/reports/ReportUI";

function CashReportContent({ data, canReview, onReview }) {
  const m = reportMetrics(data);
  return (
    <>
      <div className="report-metrics">
        <Metric
          label="Cash sales portions"
          value={m.cashReady ? money(m.cashSalesCents) : "Needs review"}
        />
        <Metric
          label="Manual cash in"
          value={m.cashReady ? money(m.cashInCents) : "Needs review"}
        />
        <Metric
          label="Total cash out"
          value={m.cashReady ? money(m.cashOutCents) : "Needs review"}
        />
        <Metric
          label="Recorded drawer movement"
          value={
            m.cashReady ? money(m.drawerMovementCents) : "Pending cash review"
          }
          note="Cash sales + cash in − cash out"
        />
      </div>
      <ReportExplanation title="How drawer movement is calculated">
        Cash sales + manual cash in − physical cash out. Totals cover the
        complete selected period; list filters do not change them.
        <p>
          Drawer movement is not profit or a counted balance. Every Cash Out is
          physical drawer cash; non-cash sale portions do not enter this
          calculation.
        </p>
      </ReportExplanation>
      <article className="report-panel">
        <h2>Cash-out categories</h2>
        <MoneyTable
          rows={[
            ["Operating expenses", m.operatingCashOutCents],
            ["Stock purchases", m.stockPurchaseCents],
            ["Owner withdrawals", m.ownerWithdrawalCents],
            ["Unclassified — needs review", m.unclassifiedCents],
            [
              "Total cash out",
              m.cashReady ? m.cashOutCents : "Needs review",
              true,
            ],
          ]}
        />
        {m.unclassifiedCount > 0 && (
          <p className="report-help">
            {m.unclassifiedCount} cash-outs need category review before
            operating profit can be displayed.
          </p>
        )}
      </article>
      <article className="report-panel">
        <h2>Cash records ({data.matchingEntries.length} matching)</h2>
        <div className="report-table-wrap">
          <table className="report-table report-record-table">
            <thead>
              <tr>
                <th>Date / time</th>
                <th>Type</th>
                <th>Category</th>
                <th className="report-secondary-column">Notes</th>
                <th className="report-secondary-column">Staff</th>
                <th>Amount</th>
                {canReview && (
                  <th className="report-secondary-column">Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.matchingEntries.map((entry) => (
                <tr key={entry.id}>
                  <td
                    data-label="Date / time"
                    className="report-record-identity"
                  >
                    {reportDateTime(entry.datetime)}
                    <details className="report-record-extra">
                      <summary>Details</summary>
                      <dl>
                        <dt>Notes</dt>
                        <dd>{entry.notes || "No notes"}</dd>
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
                    {entry.type === "in"
                      ? "Cash in"
                      : entry.type === "out"
                        ? "Cash out"
                        : "Needs review"}
                  </td>
                  <td data-label="Category">{cashOutCategoryLabel(entry)}</td>
                  <td
                    className="report-secondary-column"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {entry.notes || "—"}
                  </td>
                  <td className="report-secondary-column">
                    {entry.staffName || "Unknown"}
                  </td>
                  <td data-label="Amount" className="report-money">
                    {money(entry.amountCents)}
                  </td>
                  {canReview && (
                    <td className="report-secondary-column">
                      {entry.type === "out" && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => onReview(entry)}
                        >
                          Review category
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.matchingEntries.length && (
          <p>No cash records match this selection.</p>
        )}
      </article>
    </>
  );
}

export default function CashManagement() {
  const location = useLocation();
  const [filterDate, setFilterDate] = useState(businessDate()),
    [reportMonth, setReportMonth] = useState(businessDate().slice(0, 7));
  const [showMonthly, setShowMonthly] = useState(
    new URLSearchParams(location.search).has("review"),
  );
  const [search, setSearch] = useState(""),
    [reviewOnly, setReviewOnly] = useState(
      new URLSearchParams(location.search).has("review"),
    );
  const [reload, setReload] = useState(0),
    [form, setForm] = useState(null),
    [amount, setAmount] = useState(""),
    [notes, setNotes] = useState("");
  const [category, setCategory] = useState(null),
    [touched, setTouched] = useState(false),
    [saving, setSaving] = useState(false);
  const [reviewEntry, setReviewEntry] = useState(null),
    [reviewCategory, setReviewCategory] = useState(null),
    [reason, setReason] = useState(""),
    [pin, setPin] = useState(""),
    [saveError, setSaveError] = useState("");
  const staff = useAuthStore((state) => state.currentStaff),
    canReview = staff?.role === "owner",
    toast = useToast();
  let day, month, dateError, monthError;
  try {
    day = reportRange({
      range: "custom",
      customStart: filterDate,
      customEnd: filterDate,
    });
    if (!filterDate) throw new Error("Choose a drawer date.");
  } catch (error) {
    dateError = error.message;
  }
  try {
    month = reportRange({ range: "calendar-month", monthValue: reportMonth });
  } catch (error) {
    monthError = error.message;
  }
  const daily = useReport(
    "report_cash_v2",
    day ? periodParams(day) : {},
    reload,
    Boolean(day) && !dateError,
  );
  const monthly = useReport(
    "report_cash_v2",
    month
      ? {
          ...periodParams(month),
          p_search: search.trim(),
          p_review_only: reviewOnly,
        }
      : {},
    reload,
    showMonthly && Boolean(month),
  );
  const refresh = () => setReload((value) => value + 1);
  function openForm(type) {
    setForm(type);
    setAmount("");
    setNotes("");
    setCategory(null);
    setTouched(false);
    setSaveError("");
  }
  function openReview(entry) {
    setReviewEntry(entry);
    setReviewCategory(
      getCashOutCategory(entry) || suggestCashOutCategory(entry.notes),
    );
    setReason("");
    setPin("");
    setSaveError("");
  }
  async function save() {
    if (saving) return;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      setSaveError("Enter a valid amount greater than zero.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await db.cashDrawer.add({
        type: form,
        amount: Number(amount),
        notes,
        ...(form === "out" && category ? { category } : {}),
        staffId: staff?.id,
        staffName: staff?.name,
        datetime: Date.now(),
      });
      setForm(null);
      refresh();
      toast("Cash movement recorded");
    } catch (error) {
      setSaveError(
        form === "out"
          ? cashCategorySaveError(error)
          : "Could not record cash in. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function saveCategory() {
    if (saving || !canReview) return;
    if (reason.trim().length < 5) {
      setSaveError("Enter a review reason of at least 5 characters.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const result = await supabase.rpc("report_review_cash_v2", {
        p_id: reviewEntry.id,
        p_category: reviewCategory,
        p_reason: reason,
        p_owner_pin: pin,
      });
      if (result.error) throw result.error;
      setReviewEntry(null);
      refresh();
      toast("Category saved with its review history");
    } catch (error) {
      setSaveError(error.message || cashCategorySaveError(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <ReportFrame
      title="Cash Drawer & Reports"
      generatedAt={daily.data?.generatedAt}
      onRefresh={refresh}
      period={
        <div className="report-period">
          <label className="report-field report-inline">
            Drawer date
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </label>
          {day && (
            <p className="report-period-label">
              {day.startDate} · Philippine business day
            </p>
          )}
        </div>
      }
      actions={
        <>
          <button
            className="btn btn-secondary"
            onClick={() => setShowMonthly(true)}
          >
            Monthly Reports
          </button>
          <button className="btn btn-success" onClick={() => openForm("in")}>
            Cash In
          </button>
          <button className="btn btn-danger" onClick={() => openForm("out")}>
            Cash Out
          </button>
        </>
      }
    >
      {dateError ? (
        <p className="report-error" role="alert">
          {dateError}
        </p>
      ) : (
        <>
          <ReportState state={daily} />
          {daily.data && (
            <CashReportContent
              data={daily.data}
              canReview={canReview}
              onReview={openReview}
            />
          )}
        </>
      )}
      {showMonthly && (
        <Modal
          title="Monthly Cash Movement Report"
          large
          onClose={() => setShowMonthly(false)}
          footer={
            <button
              className="btn btn-primary"
              onClick={() => setShowMonthly(false)}
            >
              Done
            </button>
          }
        >
          <div className="report-filter-row">
            <label>
              Report month
              <input
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
              />
            </label>
            <label>
              Search cash records
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Notes, staff, type or category"
              />
            </label>
          </div>
          <details
            className="report-explanation"
            open={reviewOnly || undefined}
          >
            <summary>More filters ({Number(reviewOnly)} active)</summary>
            <label className="report-check">
              <input
                type="checkbox"
                checked={reviewOnly}
                onChange={(e) => setReviewOnly(e.target.checked)}
              />{" "}
              Only cash-outs needing category review
            </label>
          </details>
          {monthly.data && (
            <div className="report-actions">
              <p className="report-asof">
                As of {reportDateTime(monthly.data.generatedAt)}
              </p>
              <button
                className="btn btn-secondary"
                onClick={() =>
                  downloadJson(`cash-report-${reportMonth}.json`, monthly.data)
                }
              >
                Export matching records
              </button>
              <button className="btn btn-secondary" onClick={refresh}>
                Refresh monthly report
              </button>
            </div>
          )}
          {monthError ? (
            <p className="report-error" role="alert">
              {monthError}
            </p>
          ) : (
            <>
              <ReportState state={monthly} />
              {monthly.data && (
                <CashReportContent
                  data={monthly.data}
                  canReview={canReview}
                  onReview={openReview}
                />
              )}
            </>
          )}
        </Modal>
      )}
      {form && (
        <Modal
          title={form === "in" ? "Cash In" : "Cash Out"}
          onClose={() => {
            if (!saving) setForm(null);
          }}
          footer={
            <>
              <button
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => setForm(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={save}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <label className="report-field">
            Amount (PHP)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              disabled={saving}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </label>
          <label className="report-field">
            Notes
            <input
              value={notes}
              disabled={saving}
              onChange={(e) => {
                setNotes(e.target.value);
                if (!touched)
                  setCategory(suggestCashOutCategory(e.target.value));
              }}
            />
          </label>
          {form === "out" && (
            <CashOutCategoryField
              value={category}
              onChange={(value) => {
                setCategory(value);
                setTouched(true);
              }}
              suggested={!touched && Boolean(category)}
              disabled={saving}
            />
          )}
          <p className="report-help">
            Recorded by {staff?.name || "Unknown staff"}
          </p>
          {saveError && (
            <p className="report-error" role="alert">
              {saveError}
            </p>
          )}
        </Modal>
      )}
      {reviewEntry && (
        <Modal
          title="Review Cash-out Category"
          onClose={() => {
            if (!saving) setReviewEntry(null);
          }}
          footer={
            <>
              <button
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => setReviewEntry(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={saveCategory}
              >
                {saving ? "Saving…" : "Save category"}
              </button>
            </>
          }
        >
          <p>
            {reportDateTime(reviewEntry.datetime)} ·{" "}
            {money(reviewEntry.amountCents)}
          </p>
          <p className="report-help" style={{ whiteSpace: "pre-wrap" }}>
            {reviewEntry.notes || "No notes recorded."}
          </p>
          <CashOutCategoryField
            value={reviewCategory}
            onChange={setReviewCategory}
            suggested={
              !getCashOutCategory(reviewEntry) && Boolean(reviewCategory)
            }
            disabled={saving}
          />
          <label className="report-field">
            Review reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="report-field">
            Owner PIN
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              autoComplete="off"
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
          <p className="report-help">
            Only the category changes. Original notes and amounts are preserved;
            the owner, reason and before/after category are recorded.
          </p>
          {saveError && (
            <p className="report-error" role="alert">
              {saveError}
            </p>
          )}
        </Modal>
      )}
    </ReportFrame>
  );
}
