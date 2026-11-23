import React, { useState } from "react";
import Modal from "../common/Modal";
import { supabase } from "../../db/database";
import { money } from "../../utils/reporting";

export default function ReviewReportItem({ issue, onClose, onSaved }) {
  const { transaction: tx, line } = issue;
  const [scope, setScope] = useState("item");
  const [kind, setKind] = useState(line?.kind || "sale");
  const [cost, setCost] = useState(
    line?.unitCost == null ? "" : String(line.unitCost),
  );
  const [confirmZero, setConfirmZero] = useState(false);
  const [correctPayments, setCorrectPayments] = useState(false);
  const [payments, setPayments] = useState(
    JSON.stringify(
      tx.report.payments.map((p) => ({
        method: p.method,
        amount: p.amountCents / 100,
      })),
      null,
      2,
    ),
  );
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (saving) return;
    setError("");
    if (reason.trim().length < 5) {
      setError("Enter a review reason of at least 5 characters.");
      return;
    }
    setSaving(true);
    try {
      let name, params;
      if (line && scope === "product") {
        name = "report_review_product_v2";
        params = {
          p_product_id: line.productId,
          p_reporting_type: kind,
          p_confirm_zero: confirmZero,
          p_reason: reason,
          p_owner_pin: pin,
        };
      } else {
        const data = line
          ? { reportingType: kind, confirmZero }
          : { confirmAdjustment: true };
        if (line && cost !== "") {
          if (!Number.isFinite(Number(cost)) || Number(cost) < 0)
            throw new Error("Enter a valid non-negative historical unit cost.");
          data.unitCost = Number(cost);
        }
        if (!line && correctPayments) {
          data.paymentLines = JSON.parse(payments);
          if (!Array.isArray(data.paymentLines))
            throw new Error("Payment portions must be a JSON array.");
          const cents = data.paymentLines.reduce((sum, p) => {
            if (
              !p.method?.trim() ||
              !Number.isFinite(Number(p.amount)) ||
              Number(p.amount) < 0
            )
              throw new Error(
                "Each payment needs a method and a valid amount.",
              );
            return sum + Math.round(Number(p.amount) * 100);
          }, 0);
          if (cents !== tx.report.totalCents)
            throw new Error(
              "The reviewed payment portions must equal the saved receipt total.",
            );
        }
        name = "report_review_item_v2";
        params = {
          p_transaction_id: tx.id,
          p_item_index: issue.itemIndex,
          p_source_hash: line?.sourceHash || tx.report.sourceHash,
          p_data: data,
          p_reason: reason,
          p_owner_pin: pin,
        };
      }
      const result = await supabase.rpc(name, params);
      if (result.error) throw new Error(result.error.message);
      onSaved();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={`Review ${tx.receiptNo || tx.id}`}
      large
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <button
            className="btn btn-secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save reviewed correction"}
          </button>
        </>
      }
    >
      <p className="report-help">
        {issue.message} Original receipts remain unchanged; reviews are saved
        separately with the owner and reason.
      </p>
      {line ? (
        <>
          <h4>{line.name}</h4>
          {line.productId && (
            <label className="report-field">
              Apply classification to
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="item">Only this historical receipt item</option>
                <option value="product">
                  This product’s untyped historical items and future items
                </option>
              </select>
            </label>
          )}
          <label className="report-field">
            Reporting type
            <select
              aria-label="Reporting type"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="sale">Customer merchandise</option>
              <option value="packaging">Packaging</option>
              <option value="waste">Waste</option>
            </select>
          </label>
          {scope === "item" && (
            <label className="report-field">
              Historical unit cost (PHP)
              <input
                type="number"
                min="0"
                step="0.0001"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </label>
          )}
          <label className="report-check">
            <input
              type="checkbox"
              checked={confirmZero}
              onChange={(e) => setConfirmZero(e.target.checked)}
            />{" "}
            I verified that a zero cost is intentional, if applicable.
          </label>
          {scope === "product" && (
            <p className="report-help">
              Historical costs are never replaced with today’s cost.
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            Saved receipt total: <strong>{money(tx.report.totalCents)}</strong>.
            Confirming an adjustment does not clear invalid prices, quantities,
            statuses or missing payments.
          </p>
          <label className="report-check">
            <input
              type="checkbox"
              checked={correctPayments}
              onChange={(e) => setCorrectPayments(e.target.checked)}
            />{" "}
            Review/correct the recorded payment portions
          </label>
          {correctPayments && (
            <label className="report-field">
              Payment portions (method and amount in PHP)
              <textarea
                rows="7"
                value={payments}
                onChange={(e) => setPayments(e.target.value)}
              />
            </label>
          )}
        </>
      )}
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
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </label>
      {error && (
        <p className="report-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
