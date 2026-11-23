import React, { useEffect, useState } from "react";
import { api, secureBackend } from "../../utils/secureApi";
import { useAuthStore } from "../../stores/authStore";

export default function SecureBoundary({ children }) {
  const [status, setStatus] = useState(secureBackend ? "loading" : "ready");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const expired = () => useAuthStore.getState().login(null);
    window.addEventListener("cafe-session-expired", expired);
    return () => window.removeEventListener("cafe-session-expired", expired);
  }, []);
  useEffect(() => {
    if (!secureBackend) return;
    const abort = new AbortController();
    (async () => {
      try {
        await api("health", { signal: abort.signal });
        try {
          const staff = await api("session", { signal: abort.signal });
          if (!abort.signal.aborted) useAuthStore.getState().login(staff);
        } catch (e) {
          if (e.status !== 401) throw e;
        }
        if (!abort.signal.aborted) setStatus("ready");
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(e.message);
          setStatus("error");
        }
      }
    })();
    return () => abort.abort();
  }, [attempt]);
  if (status === "ready") return children;
  return (
    <main className="secure-start">
      <h1>
        {status === "loading"
          ? "Connecting to the café…"
          : "Secure connection needs attention"}
      </h1>
      {error && <p role="alert">{error}</p>}
      {status === "error" && (
        <button
          className="btn btn-primary"
          onClick={() => {
            setStatus("loading");
            setAttempt((v) => v + 1);
          }}
        >
          Try again
        </button>
      )}
    </main>
  );
}
