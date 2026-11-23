import React, { useEffect, useState } from "react";
import { api } from "../../utils/secureApi";

export default function PaymentProofViewer({ transactionId, isOwner }) {
  const [proofs, setProofs] = useState([]),
    [image, setImage] = useState(null),
    [error, setError] = useState("");
  async function load() {
    try {
      setProofs(await api(`proofs?transactionId=${transactionId}`));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    setImage(null);
    load();
  }, [transactionId]);
  async function view(proof) {
    try {
      const signed = await api(`proofs/${proof.id}`);
      setImage(signed.signedUrl);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(proof) {
    const reason = window.prompt(
      "Reason for deleting this payment photo? The receipt stays unchanged.",
    );
    if (!reason) return;
    try {
      await api(`proofs/${proof.id}`, { method: "DELETE", body: { reason } });
      setImage(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="payment-proof">
      <h3>Payment photos</h3>
      <p>
        Photos are available for 90 days after payment. Attaching a photo
        records evidence; it does not verify a bank settlement.
      </p>
      {!proofs.length && <p>No saved payment photos for this receipt.</p>}
      {proofs.map((proof) => (
        <div key={proof.id}>
          <strong>
            {proof.method} · ₱{(proof.amount_cents / 100).toFixed(2)}
          </strong>
          <p>
            {proof.status === "attached"
              ? `Expires ${new Date(proof.expires_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}`
              : proof.status}
          </p>
          {proof.status === "attached" && (
            <>
              <button className="btn btn-secondary" onClick={() => view(proof)}>
                View photo
              </button>
              {isOwner && (
                <button
                  className="btn btn-danger"
                  onClick={() => remove(proof)}
                >
                  Delete photo
                </button>
              )}
            </>
          )}
        </div>
      ))}
      {image && <img src={image} alt="Saved proof of payment" />}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
