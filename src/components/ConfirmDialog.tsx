"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

/** Asks before something that is hard to undo or that tells other people. Escape or "Cancel" does nothing. */
export function ConfirmDialog({ message, confirmLabel, danger, onConfirm, onCancel }: {
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const answered = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const close = (yes: boolean) => {
    answered.current = true;
    ref.current?.close();
    (yes ? onConfirm : onCancel)();
  };

  return (
    <dialog
      ref={ref}
      className="dlg"
      style={{ maxWidth: 420 }}
      onClose={() => { if (!answered.current) onCancel(); }}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
      aria-labelledby="confirm-title"
    >
      <div className="dlg-body">
        <div className="dlg-icon" style={danger ? { background: "var(--bad-soft)", color: "var(--bad)" } : { background: "var(--warn-soft)", color: "var(--warn)" }}><AlertTriangle size={24} /></div>
        <h2 id="confirm-title" className="h1" style={{ fontSize: 19 }}>Are you sure?</h2>
        <p className="muted mt-1.5">{message}</p>
      </div>
      <div className="dlg-foot" style={{ gap: 8, paddingTop: 16 }}>
        <button type="button" className="btn btn-ghost" onClick={() => close(false)}>Cancel</button>
        <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={() => close(true)} autoFocus>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
