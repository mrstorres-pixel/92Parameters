import { useEffect, useState } from "react";
import { requestReport } from "../utils/reporting";

export default function useReport(name, params, reloadKey = 0, enabled = true) {
  const key = JSON.stringify(params);
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
    key,
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: null, key });
    requestReport(name, JSON.parse(key), controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ status: "ready", data, error: null, key });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ status: "error", data: null, error, key });
      });
    return () => controller.abort();
  }, [name, key, reloadKey, enabled]);
  return state.key !== key || !enabled
    ? { status: "loading", data: null, error: null }
    : state;
}
