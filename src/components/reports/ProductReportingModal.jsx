import React, { useState } from "react";
import Modal from "../common/Modal";
import { supabase } from "../../db/database";
import "../../styles/reports.css";

export default function ProductReportingModal({ product, onClose, onSaved }) {
  const [type, setType] = useState(
    product.reportingType ||
      (/milk\s*\/\s*waste/i.test(product.name)
        ? "waste"
        : product.category === "Takeout Box"
          ? "packaging"
          : "sale"),
  );
  const [zero, setZero] = useState(product.costZeroConfirmed === true),
    [reason, setReason] = useState(""),
    [pin, setPin] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function save() {
    if (saving) return;
    if (reason.trim().length < 5) {
      setError("Enter a review reason of at least 5 characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await supabase.rpc("report_review_product_v2", {
        p_product_id: product.id,
        p_reporting_type: type,
        p_confirm_zero: zero,
        p_reason: reason,
        p_owner_pin: pin,
      });
      if (result.error) throw result.error;
      onSaved();
    } catch (failure) {
      setError(
        ["PGRST202", "42703"].includes(failure.code)
          ? "Run the reports database migration before reviewing product reporting."
          : failure.message,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className="reports-surface"
      style={{ minHeight: 0, padding: 0, background: "transparent" }}
    >
      <Modal
        title={`Reporting: ${product.name}`}
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
            <button
              className="btn btn-primary"
              disabled={saving}
              onClick={save}
            >
              {saving ? "Saving…" : "Confirm reporting type"}
            </button>
          </>
        }
      >
        <p className="report-help">
          Applies to future items and historical items without an explicit saved
          classification. Original receipt costs and amounts are never
          rewritten. The review is audited.
        </p>
        <label className="report-field">
          Reporting type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="sale">Customer merchandise</option>
            <option value="packaging">Packaging</option>
            <option value="waste">Waste</option>
          </select>
        </label>
        <label className="report-check">
          <input
            type="checkbox"
            checked={zero}
            onChange={(e) => setZero(e.target.checked)}
          />{" "}
          I verified that a zero product cost is intentional.
        </label>
        <label className="report-field">
          Review reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="report-field">
          Owner PIN
          <input
            type="password"
            autoComplete="off"
            inputMode="numeric"
            maxLength={4}
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
    </div>
  );
}
