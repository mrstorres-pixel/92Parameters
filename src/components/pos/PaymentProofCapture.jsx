import React, { useEffect, useRef, useState } from "react";
import { api } from "../../utils/secureApi";

export default function PaymentProofCapture({
  method,
  amountCents,
  checkoutKey,
  proof,
  onProof,
  disabled,
}) {
  const video = useRef(null),
    stream = useRef(null),
    mounted = useRef(true);
  const [camera, setCamera] = useState(false),
    [image, setImage] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);
  useEffect(() => {
    if (camera && video.current) {
      video.current.srcObject = stream.current;
      video.current.play().catch(() => {});
    }
  }, [camera]);
  async function open() {
    setBusy(true);
    try {
      setError("");
      stop();
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
      });
      if (!mounted.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = next;
      setCamera(true);
      setImage(null);
    } catch (e) {
      if (mounted.current)
        setError(
          e.name === "NotAllowedError"
            ? "Allow camera access in Safari settings to capture proof."
            : "Camera unavailable. This payment method needs a fresh photo.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function capture() {
    if (!video.current?.videoWidth) return;
    const canvas = document.createElement("canvas"),
      scale = Math.min(
        1,
        1600 / Math.max(video.current.videoWidth, video.current.videoHeight),
      );
    canvas.width = Math.round(video.current.videoWidth * scale);
    canvas.height = Math.round(video.current.videoHeight * scale);
    canvas
      .getContext("2d")
      .drawImage(video.current, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL("image/jpeg", 0.78);
    if (data.length > 1_350_000) data = canvas.toDataURL("image/jpeg", 0.5);
    if (data.length > 1_350_000) {
      setError("Photo is too large. Retake from slightly further away.");
      return;
    }
    setImage(data);
    stop();
    setCamera(false);
  }
  async function upload() {
    setBusy(true);
    setError("");
    try {
      const saved = await api("proofs", {
        method: "POST",
        body: { method, amountCents, checkoutKey, image: image.split(",")[1] },
      });
      onProof(saved);
      setImage(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="payment-proof">
      <h3>{method} · payment photo required</h3>
      <p>
        Capture the approval receipt or transfer confirmation. Keep full card
        numbers and security codes out of the photo.
      </p>
      {proof ? (
        <p role="status">Photo uploaded for this payment portion ✓</p>
      ) : (
        <>
          {camera && (
            <>
              <video
                ref={video}
                autoPlay
                playsInline
                muted
                aria-label={`${method} proof camera`}
              />
              <button
                className="btn btn-primary"
                disabled={disabled}
                onClick={capture}
              >
                Take photo
              </button>
            </>
          )}
          {image && (
            <>
              <img src={image} alt={`${method} proof preview`} />
              <button
                className="btn btn-primary"
                onClick={upload}
                disabled={busy || disabled}
              >
                {busy ? "Uploading…" : "Use this photo"}
              </button>
            </>
          )}
          {!camera && (
            <button
              className="btn btn-secondary"
              disabled={busy || disabled}
              onClick={open}
            >
              {image ? "Retake photo" : "Open camera"}
            </button>
          )}
        </>
      )}
      {proof && (
        <button
          className="btn btn-secondary"
          disabled={disabled}
          onClick={() => {
            onProof(null);
            open();
          }}
        >
          Retake photo
        </button>
      )}
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
