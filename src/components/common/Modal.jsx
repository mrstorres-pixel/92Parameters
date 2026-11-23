import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export default function Modal({
  title,
  onClose,
  children,
  footer,
  large,
  overlayClassName = "",
}) {
  const titleId = useId();
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    const focusable = () =>
      [
        ...node.querySelectorAll(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length);
    if (!node.contains(document.activeElement))
      (focusable()[0] || node).focus();
    const keydown = (event) => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      const topDialog = dialogs.reduce((top, current) => {
        const layer = (element) =>
          Number(getComputedStyle(element.closest(".modal-overlay")).zIndex) ||
          0;
        return !top || layer(current) >= layer(top) ? current : top;
      }, null);
      if (topDialog !== node) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const elements = focusable(),
          first = elements[0],
          last = elements[elements.length - 1];
        if (!first) {
          event.preventDefault();
          node.focus();
        } else if (!node.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === node)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className={`modal-overlay ${overlayClassName}`} onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal ${large ? "modal-lg" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button
            aria-label="Close dialog"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
