import React, { useEffect, useState } from "react";
import { api } from "../../utils/secureApi";
import Modal from "../common/Modal";
import { money } from "../../utils/reporting";
import "../../styles/paymentProof.css";

function ProofImage({ id, large = false, onExpand }) {
  const [state, setState] = useState({ url: null, error: "", loading: true }),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ url: null, error: "", loading: true });
    api(`proofs/${id}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ url: data.signedUrl, error: "", loading: false });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState({ url: null, error: e.message, loading: false });
      });
    return () => controller.abort();
  }, [id, reload]);
  return (
    <div className="proof-image">
      {state.loading && <p role="status">Loading payment photo…</p>}
      {state.url &&
        (large ? (
          <img
            src={state.url}
            alt="Full size proof of payment"
            onError={() =>
              setState({
                url: null,
                error:
                  "Photo could not be loaded. Its temporary link may have expired.",
                loading: false,
              })
            }
          />
        ) : (
          <button
            type="button"
            className="proof-thumbnail"
            onClick={onExpand}
            aria-label="Enlarge payment photo"
          >
            <img
              src={state.url}
              alt="Saved proof of payment"
              onError={() =>
                setState({
                  url: null,
                  error:
                    "Photo could not be loaded. Its temporary link may have expired.",
                  loading: false,
                })
              }
            />
            <span>Tap to enlarge</span>
          </button>
        ))}
      {state.error && <p role="alert">{state.error}</p>}
      {!state.loading && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setReload((value) => value + 1)}
        >
          Reload photo
        </button>
      )}
    </div>
  );
}

function ProofList({ transactionId, isOwner }) {
  const [state, setState] = useState({ proofs: [], loading: true, error: "" }),
    [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState(null),
    [shown, setShown] = useState({}),
    [deleting, setDeleting] = useState(null),
    [actionError, setActionError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setState({ proofs: [], loading: true, error: "" });
    api(`proofs?transactionId=${encodeURIComponent(transactionId)}`, {
      signal: controller.signal,
    })
      .then((proofs) => {
        if (!controller.signal.aborted)
          setState({ proofs, loading: false, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState({ proofs: [], loading: false, error: e.message });
      });
    return () => controller.abort();
  }, [transactionId, reload]);
  async function remove(proof) {
    const reason = window.prompt(
      "Reason for deleting this payment photo? The receipt stays unchanged.",
    );
    if (!reason?.trim()) return;
    setDeleting(proof.id);
    setActionError("");
    try {
      await api(`proofs/${proof.id}`, { method: "DELETE", body: { reason } });
      setExpanded(null);
      setReload((value) => value + 1);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setDeleting(null);
    }
  }
  return (
    <section className="payment-proof">
      <h3>Payment photos</h3>
      <p>
        Available to owners and managers for 90 days. A photo records evidence;
        it does not verify bank settlement.
      </p>
      {state.loading && <p role="status">Loading payment evidence…</p>}
      {state.error && (
        <div role="alert">
          <p>{state.error}</p>
          <button
            className="btn btn-secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry payment photos
          </button>
        </div>
      )}
      {!state.loading && !state.error && !state.proofs.length && (
        <p>No saved payment photos for this receipt.</p>
      )}
      {state.proofs.map((proof) => {
        const expired =
          proof.status === "expired" ||
          Date.parse(proof.expires_at) <= Date.now();
        const available = proof.status === "attached" && !expired;
        return (
          <article className="proof-record" key={proof.id}>
            <strong>
              {proof.method} · {money(proof.amount_cents)}
            </strong>
            <p>
              {proof.status === "deleted"
                ? "Photo deleted"
                : expired
                  ? "Photo expired — the retention period has ended."
                  : available
                    ? `Expires ${new Date(proof.expires_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}`
                    : "Photo is not attached to this receipt."}
            </p>
            {available && (
              <>
                {proof.method === "Bank Transfer" || shown[proof.id] ? (
                  <ProofImage
                    id={proof.id}
                    onExpand={() => setExpanded(proof)}
                  />
                ) : (
                  <button
                    className="btn btn-secondary"
                    onClick={() =>
                      setShown((previous) => ({
                        ...previous,
                        [proof.id]: true,
                      }))
                    }
                  >
                    View {proof.method} photo
                  </button>
                )}
                {isOwner && (
                  <button
                    className="btn btn-danger"
                    disabled={Boolean(deleting)}
                    onClick={() => remove(proof)}
                  >
                    {deleting === proof.id ? "Deleting…" : "Delete photo"}
                  </button>
                )}
              </>
            )}
          </article>
        );
      })}
      {actionError && <p role="alert">{actionError}</p>}
      {expanded && (
        <Modal
          title={`${expanded.method} payment photo`}
          large
          onClose={() => setExpanded(null)}
          footer={
            <button
              className="btn btn-primary"
              onClick={() => setExpanded(null)}
            >
              Close photo
            </button>
          }
        >
          <ProofImage id={expanded.id} large />
        </Modal>
      )}
    </section>
  );
}

export default function PaymentProofViewer(props) {
  return <ProofList key={props.transactionId} {...props} />;
}
