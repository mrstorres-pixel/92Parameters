import { useCallback, useEffect, useRef, useState } from "react";
import { createTicketTracker, playKitchenChime } from "../utils/kitchenAlerts";

export default function useKitchenSound() {
  const audio = useRef(null),
    enabled = useRef(false),
    tracker = useRef(createTicketTracker());
  const [status, setStatus] = useState("off"),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      enabled.current = false;
      audio.current?.close();
      audio.current = null;
    },
    [],
  );
  const enable = async () => {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error("Sound is unavailable in this browser.");
      if (!audio.current) {
        audio.current = new Audio();
        audio.current.onstatechange = () =>
          setStatus(
            enabled.current
              ? audio.current?.state === "running"
                ? "on"
                : "paused"
              : "off",
          );
      }
      await audio.current.resume();
      if (audio.current.state !== "running")
        throw new Error("Tap Enable sound again to allow audio.");
      enabled.current = true;
      setStatus("on");
      setError("");
      playKitchenChime(audio.current);
    } catch (e) {
      enabled.current = false;
      setStatus("off");
      setError(e.message);
    }
  };
  const mute = () => {
    enabled.current = false;
    setStatus("off");
  };
  const test = async () => {
    try {
      await audio.current.resume();
      playKitchenChime(audio.current);
      setError("");
    } catch {
      setError("Tap Enable sound to restart audio.");
    }
  };
  const receive = useCallback((tickets) => {
    const arrivals = tracker.current(tickets);
    if (
      arrivals.length &&
      enabled.current &&
      audio.current?.state === "running"
    )
      playKitchenChime(audio.current);
  }, []);
  return { status, error, enable, mute, test, receive };
}
