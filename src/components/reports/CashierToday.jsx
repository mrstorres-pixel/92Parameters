import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import useCashierDay from "../../hooks/useCashierDay";
import useReport from "../../hooks/useReport";
import { money, periodParams } from "../../utils/reporting";
import { ReportFrame, ReportState, Metric } from "./ReportUI";

export function CashierCashTotals({ data, onOpen }) {
  const t = data.totals;
  const value = (cents) => (t.cashReady ? money(cents) : "Needs review");
  return (
    <div className="report-metrics">
      <Metric
        label="Cash sales today"
        value={value(t.cashSalesCents)}
        onOpen={onOpen ? () => onOpen("cashSales") : undefined}
      />
      <Metric
        label="Cash in today"
        value={value(t.cashInCents)}
        onOpen={onOpen ? () => onOpen("cashIn") : undefined}
      />
      <Metric
        label="Cash out today"
        value={value(t.cashOutCents)}
        onOpen={onOpen ? () => onOpen("cashOut") : undefined}
      />
      <Metric
        label="Recorded drawer movement"
        value={value(t.cashSalesCents + t.cashInCents - t.cashOutCents)}
        note="Cash sales + cash in − cash out"
        onOpen={onOpen ? () => onOpen("drawerMovement") : undefined}
      />
    </div>
  );
}
export function TodayPeriod({ bounds }) {
  return (
    <p className="report-help">
      <strong>Today only</strong>
      {bounds
        ? ` · ${bounds.startDate} · Philippine time`
        : " · Loading business date…"}
    </p>
  );
}
export default function CashierToday() {
  const day = useCashierDay(true),
    [reload, setReload] = useState(0),
    navigate = useNavigate();
  const state = useReport(
    "report_cash_v2",
    day.bounds ? periodParams(day.bounds) : {},
    reload,
    Boolean(day.bounds),
  );
  return (
    <ReportFrame
      title="Today's overview"
      generatedAt={state.data?.generatedAt}
      period={<TodayPeriod bounds={day.bounds} />}
      onRefresh={() => {
        day.refresh();
        setReload((value) => value + 1);
      }}
    >
      {day.error ? (
        <p role="alert" className="report-error">
          {day.error}
        </p>
      ) : (
        <ReportState state={state} />
      )}
      {state.data && <CashierCashTotals data={state.data} />}
      <div className="report-actions">
        <button className="btn btn-primary" onClick={() => navigate("/pos")}>
          New sale
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => navigate("/transactions")}
        >
          Today's transactions
        </button>
        <button className="btn btn-secondary" onClick={() => navigate("/cash")}>
          Cash drawer
        </button>
      </div>
    </ReportFrame>
  );
}
