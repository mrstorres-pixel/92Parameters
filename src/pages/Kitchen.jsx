import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../utils/secureApi";
import { reportDateTime } from "../utils/reportDates";
import "../styles/reports.css";
import "../styles/kitchen.css";

export function useKitchenFeed() {
  const [tickets, setTickets] = useState([]),
    [status, setStatus] = useState("connecting"),
    [lastSync, setLastSync] = useState(null),
    [error, setError] = useState("");
  const cursor = useRef(null),
    lastFull = useRef(0),
    busy = useRef(false),
    alive = useRef(false),
    request = useRef(null);
  const refresh = useCallback(async (full = false) => {
    if (busy.current || !alive.current) return;
    busy.current = true;
    request.current = new AbortController();
    full = full || Date.now() - lastFull.current > 30000;
    try {
      const data = await api(
        `kitchen${!full && cursor.current ? `?since=${encodeURIComponent(cursor.current)}` : ""}`,
        { signal: request.current.signal },
      );
      if (!alive.current) return;
      if (full) lastFull.current = Date.now();
      setTickets((previous) => {
        const map = new Map(
          previous
            .filter(
              (ticket) =>
                ["new", "preparing"].includes(ticket.status) ||
                ticket.change_notice ||
                Date.parse(ticket.updated_at) > Date.now() - 86400000,
            )
            .map((ticket) => [ticket.id, ticket]),
        );
        data.tickets.forEach((ticket) => {
          if (
            !map.has(ticket.id) ||
            map.get(ticket.id).revision <= ticket.revision
          )
            map.set(ticket.id, ticket);
        });
        return [...map.values()].sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
      });
      cursor.current = data.cursor || cursor.current;
      setLastSync(data.asOf);
      setStatus("connected");
      setError("");
    } catch (e) {
      if (alive.current && e.name !== "AbortError") {
        setStatus("offline");
        setError(e.message);
        cursor.current = null;
      }
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh(true);
    const timer = setInterval(() => {
        if (!document.hidden) refresh();
      }, 2000),
      focus = () => refresh(true);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      alive.current = false;
      request.current?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  const acceptTicket = (updated) =>
    setTickets((previous) =>
      previous.map((ticket) =>
        ticket.id === updated.id ? { ...ticket, ...updated } : ticket,
      ),
    );
  return { tickets, status, lastSync, error, refresh, acceptTicket };
}
export default function Kitchen() {
  const feed = useKitchenFeed(),
    [view, setView] = useState("active"),
    [saving, setSaving] = useState(null),
    [error, setError] = useState("");
  const visible = feed.tickets.filter((ticket) =>
    view === "active"
      ? ticket.status === "new" ||
        ticket.status === "preparing" ||
        ticket.change_notice
      : ticket.status === "completed" || ticket.status === "cancelled",
  );
  async function action(ticket, action, lineId) {
    setSaving(ticket.id);
    setError("");
    try {
      const updated = await api("kitchen/action", {
        method: "POST",
        body: {
          ticketId: ticket.id,
          revision: ticket.revision,
          action,
          lineId,
        },
      });
      feed.acceptTicket(updated);
      await feed.refresh(true);
    } catch (e) {
      setError(e.message);
      await feed.refresh(true);
    } finally {
      setSaving(null);
    }
  }
  return (
    <section className="reports-surface kitchen-surface">
      <header className="kitchen-heading">
        <div>
          <h1 className="report-sr-only">Kitchen tickets</h1>
          <p role="status">
            {feed.status === "connected"
              ? "Connected · live updates"
              : feed.status === "offline"
                ? "Disconnected · updates paused"
                : "Connecting…"}
            {feed.lastSync && ` · Last sync ${reportDateTime(feed.lastSync)}`}
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => feed.refresh(true)}
        >
          Refresh tickets
        </button>
      </header>
      {(feed.error || error) && (
        <p role="alert" className="report-notice report-notice-warning">
          {error || feed.error} Changes are saved only after confirmation from
          the server.
        </p>
      )}
      <div className="report-section-tabs">
        <button
          aria-pressed={view === "active"}
          onClick={() => setView("active")}
        >
          Active tickets
        </button>
        <button
          aria-pressed={view === "completed"}
          onClick={() => setView("completed")}
        >
          Completed / cancelled
        </button>
      </div>
      {!visible.length && (
        <p>
          {feed.status === "connected"
            ? "No tickets in this view."
            : "Waiting for a confirmed connection…"}
        </p>
      )}
      <div className="kitchen-grid">
        {visible.map((ticket) => (
          <article className="report-panel kitchen-ticket" key={ticket.id}>
            <div className="kitchen-ticket-title">
              <h2>{ticket.app_orders.label}</h2>
              <span>
                {ticket.status === "completed"
                  ? "Completed"
                  : ticket.status === "preparing"
                    ? "Preparing"
                    : ticket.status === "cancelled"
                      ? "Cancelled"
                      : "New"}
              </span>
            </div>
            <p>
              {ticket.app_orders.order_type} ·{" "}
              {Math.max(
                0,
                Math.floor(
                  (Date.now() - Date.parse(ticket.created_at)) / 60000,
                ),
              )}{" "}
              min · {ticket.app_orders.staff_name}
            </p>
            {ticket.change_notice && (
              <div className="report-notice report-notice-warning">
                <h3>Change needs acknowledgement</h3>
                <p>{ticket.change_notice}</p>
                <button
                  className="btn btn-primary"
                  disabled={saving === ticket.id || feed.status !== "connected"}
                  onClick={() => action(ticket, "acknowledge")}
                >
                  Acknowledge{" "}
                  {ticket.cancel_requested ? "cancellation" : "change"}
                </button>
              </div>
            )}
            {ticket.items.map((item) => (
              <label
                className={`kitchen-item ${item.removed ? "kitchen-removed" : ""}`}
                key={item.lineId}
              >
                <input
                  type="checkbox"
                  checked={Boolean(item.done)}
                  disabled={
                    item.removed ||
                    Boolean(ticket.change_notice) ||
                    ticket.status === "completed" ||
                    ticket.status === "cancelled" ||
                    saving === ticket.id ||
                    feed.status !== "connected"
                  }
                  onChange={() => action(ticket, "toggle", item.lineId)}
                />
                <span>
                  <strong>
                    {item.quantity} × {item.name}
                    {item.removed ? " — removed" : ""}
                  </strong>
                  {item.note && <small>{item.note}</small>}
                </span>
              </label>
            ))}
            <div className="report-actions">
              {ticket.status === "new" && (
                <button
                  className="btn btn-secondary"
                  disabled={
                    Boolean(ticket.change_notice) ||
                    saving === ticket.id ||
                    feed.status !== "connected"
                  }
                  onClick={() => action(ticket, "start")}
                >
                  Start preparing
                </button>
              )}
              {["new", "preparing"].includes(ticket.status) && (
                <button
                  className="btn btn-primary"
                  disabled={
                    Boolean(ticket.change_notice) ||
                    !ticket.items.every((item) => item.done || item.removed) ||
                    saving === ticket.id ||
                    feed.status !== "connected"
                  }
                  onClick={() => action(ticket, "complete")}
                >
                  Complete ticket
                </button>
              )}
              {ticket.status === "completed" && (
                <button
                  className="btn btn-secondary"
                  disabled={saving === ticket.id || feed.status !== "connected"}
                  onClick={() => {
                    if (window.confirm("Reopen this ticket for preparation?"))
                      action(ticket, "reopen");
                  }}
                >
                  Reopen ticket
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
