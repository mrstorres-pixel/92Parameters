import { useCallback, useEffect, useState } from "react";
import { api } from "../utils/secureApi";

// The server supplies Philippine midnight boundaries; device timezone/clock
// never determines which financial records a cashier is allowed to request.
export default function useCashierDay(enabled) {
  const [state, setState] = useState({ bounds: null, error: null });
  const [reload, refresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true,
      timer,
      controller;
    const sync = async () => {
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      const active = controller;
      setState({ bounds: null, error: null });
      try {
        const access = await api("report-access", { signal: active.signal });
        if (!alive || active.signal.aborted || controller !== active) return;
        setState({ bounds: access.bounds, error: null });
        timer = setTimeout(
          sync,
          Math.max(100, access.bounds.endExclusiveMs - access.serverNow + 50),
        );
      } catch (error) {
        if (alive && controller === active && error.name !== "AbortError")
          setState({ bounds: null, error: error.message });
      }
    };
    const focus = () => {
      if (!document.hidden) sync();
    };
    sync();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      alive = false;
      controller?.abort();
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [enabled, reload]);
  return {
    ...state,
    refresh: useCallback(() => refresh((value) => value + 1), []),
  };
}
