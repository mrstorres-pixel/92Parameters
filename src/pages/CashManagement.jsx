import React, { useState, useEffect } from "react";
import useCashierDay from "../hooks/useCashierDay";
import { TodayPeriod } from "../components/reports/CashierToday";
import { useLocation } from "react-router-dom";
import db, { supabase } from "../db/database";
import Modal from "../components/common/Modal";
import { useAuthStore } from "../stores/authStore";
import { useToast } from "../components/common/Toast";
import CashOutCategoryField from "../components/cash/CashOutCategoryField";
import {
  getCashOutCategory,
  suggestCashOutCategory,
  cashCategorySaveError,
} from "../utils/cashOutCategories";
import {
  businessDate,
  reportRange,
  reportDateTime,
} from "../utils/reportDates";
import { money, periodParams } from "../utils/reporting";
import { downloadJson } from "../utils/durability";
import useReport from "../hooks/useReport";
import { ReportState, ReportPeriod } from "../components/reports/ReportUI";
import { useReportPeriod } from "../stores/reportPeriodStore";
import CashDrawerContent from "../components/cash/CashDrawerContent";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarDays,
  BarChart3,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import "../styles/cashDrawer.css";

export default function CashManagement() {
  const location = useLocation();
  const {
    range,
    setRange,
    customStart,
    setStart,
    customEnd,
    setEnd,
    lookbackAmount,
    setAmount: setLookbackAmount,
    lookbackUnit,
    setUnit,
    setDates,
  } = useReportPeriod();
  const [reportMonth, setReportMonth] = useState(businessDate().slice(0, 7));
  const [showMonthly, setShowMonthly] = useState(false);
  const [showPeriod, setShowPeriod] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(
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
  const isCashier = staff?.role === "cashier";
  const cashierDay = useCashierDay(isCashier);
  useEffect(() => {
    if (isCashier) {
      setShowMonthly(false);
      setReviewEntry(null);
    }
  }, [isCashier, cashierDay.bounds?.startMs]);
  let day, month, dateError, monthError;
  try {
    day = isCashier
      ? cashierDay.bounds
      : reportRange({
          range,
          customStart,
          customEnd,
          lookbackAmount,
          lookbackUnit,
        });
  } catch (error) {
    dateError = error.message;
  }
  if (isCashier) dateError = cashierDay.error;
  try {
    month = reportRange({ range: "calendar-month", monthValue: reportMonth });
  } catch (error) {
    monthError = error.message;
  }
  const daily = useReport(
    "report_cash_v2",
    day
      ? {
          ...periodParams(day),
          p_search: search.trim(),
          p_review_only: reviewOnly,
        }
      : {},
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
    !isCashier && showMonthly && Boolean(month),
  );
  const refresh = () => {
    if (isCashier) cashierDay.refresh();
    setReload((value) => value + 1);
  };
  function chooseMonth(value) {
    setReportMonth(value);
    try {
      const selected = reportRange({
        range: "calendar-month",
        monthValue: value,
      });
      setDates(selected.startDate, selected.endDate);
    } catch {
      /* Invalid month input remains visible in the modal. */
    }
  }
  function openMonthly() {
    if (isCashier) return;
    chooseMonth(
      range !== "all" && day
        ? day.startDate.slice(0, 7)
        : businessDate().slice(0, 7),
    );
    setShowMonthly(true);
  }
  const formatPeriod = (value) =>
    new Intl.DateTimeFormat("en-PH", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Manila",
    }).format(new Date(`${value}T00:00:00+08:00`));
  const periodLabel = day
    ? day.startDate === day.endDate
      ? formatPeriod(day.startDate)
      : `${formatPeriod(day.startDate)} — ${formatPeriod(day.endDate)} · inclusive`
    : "Select a date";
  const activeFilters = Number(Boolean(search.trim())) + Number(reviewOnly);
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
    <section className="reports-surface cash-drawer-surface">
      <header className="cash-drawer-heading">
        <div>
          <h1>Cash Drawer</h1>
          {isCashier && <TodayPeriod bounds={day} />}
        </div>
        <div className="cash-drawer-actions">
          {!isCashier && (
            <>
              <button
                className="btn btn-secondary cash-period-control"
                aria-label="Choose drawer period"
                onClick={() => setShowPeriod(true)}
              >
                <CalendarDays size={20} />
                <span className="report-period-label">{periodLabel}</span>
              </button>
              <button className="btn btn-secondary" onClick={openMonthly}>
                <BarChart3 size={20} />
                Monthly Reports
              </button>
            </>
          )}
          <button className="btn btn-success" onClick={() => openForm("in")}>
            <ArrowDownCircle size={20} />
            Cash In
          </button>
          <button className="btn btn-danger" onClick={() => openForm("out")}>
            <ArrowUpCircle size={20} />
            Cash Out
          </button>
        </div>
      </header>
      {dateError ? (
        <p className="report-error" role="alert">
          {dateError}
        </p>
      ) : (
        <ReportState state={daily} />
      )}
      <CashDrawerContent
        key={day?.startMs}
        data={dateError ? null : daily.data}
        canReview={canReview}
        isCashier={isCashier}
        onReview={openReview}
        onNeedsReview={() => {
          setReviewOnly(true);
          setFiltersOpen(true);
        }}
        recordTools={
          <div className="cash-record-tools">
            <button
              className="btn btn-ghost"
              aria-expanded={filtersOpen}
              aria-controls="cash-record-filters"
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal size={18} />
              Search &amp; filters
              {activeFilters > 0 ? " (" + activeFilters + ")" : ""}
            </button>
            {activeFilters > 0 && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setSearch("");
                  setReviewOnly(false);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        }
        filters={
          filtersOpen && (
            <div className="cash-record-filters" id="cash-record-filters">
              <label className="report-field">
                Search cash records
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Notes, staff, type or category"
                />
              </label>
              <label className="report-check">
                <input
                  type="checkbox"
                  checked={reviewOnly}
                  onChange={(event) => setReviewOnly(event.target.checked)}
                />
                Only cash-outs needing category review
              </label>
              <p className="report-help">
                Filters change the list. Cash totals still include the complete
                selected period.
              </p>
            </div>
          )
        }
      />
      <footer className="cash-drawer-footer">
        <div className="cash-refresh">
          <button className="btn btn-ghost" onClick={refresh}>
            <RefreshCw size={18} />
            Refresh drawer
          </button>
          <p className="report-asof">
            {daily.data
              ? "As of " + reportDateTime(daily.data.generatedAt)
              : "Waiting for complete drawer data"}
          </p>
        </div>
        <nav aria-label="Related reports" className="cash-related-reports">
          {staff?.role === "owner" && <NavLink to="/reports">Business</NavLink>}
          <NavLink to="/transactions">Transactions</NavLink>
        </nav>
      </footer>
      {showPeriod && !isCashier && (
        <Modal
          title="Choose drawer period"
          onClose={() => setShowPeriod(false)}
          footer={
            <button
              className="btn btn-primary"
              onClick={() => setShowPeriod(false)}
            >
              Done
            </button>
          }
        >
          <label className="report-field">
            Drawer date
            <input
              type="date"
              value={
                day?.startDate === day?.endDate ? day?.startDate || "" : ""
              }
              onChange={(event) => {
                if (event.target.value)
                  setDates(event.target.value, event.target.value);
              }}
            />
          </label>
          <ReportPeriod
            {...{ range, customStart, customEnd, lookbackAmount, lookbackUnit }}
            bounds={day}
            onRange={setRange}
            onStart={setStart}
            onEnd={setEnd}
            onAmount={setLookbackAmount}
            onUnit={setUnit}
            error={dateError}
          />
        </Modal>
      )}
      {showMonthly && !isCashier && (
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
                onChange={(e) => chooseMonth(e.target.value)}
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
          <p className="report-help">
            The selected calendar month is shared with Business and
            Transactions. Search and category filters affect the cash list only.
          </p>
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
                <CashDrawerContent
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
    </section>
  );
}
