"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { Step } from "@/lib/next-steps";

/** The "what next?" dialog. Closing it, or pressing Escape, leaves you where you are. */
export function NextStepDialog({ step, onClose }: { step: Step; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, [step]);

  return (
    <dialog ref={ref} className="dlg" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} aria-labelledby="dlg-title">
      <div className="dlg-body">
        <div className="dlg-icon"><CheckCircle2 size={24} /></div>
        <h2 id="dlg-title" className="h1" style={{ fontSize: 19 }}>{step.title}</h2>
        {step.body && <p className="muted mt-1">{step.body}</p>}
      </div>
      <div className="dlg-actions">
        <div className="eyebrow mb-0.5">What would you like to do next?</div>
        {step.actions.map((a) => (
          <Link key={a.href + a.label} href={a.href} className={`dlg-option ${a.primary ? "primary" : ""}`} onClick={() => ref.current?.close()}>
            <span className="flex-1 min-w-0">
              <span className="t block">{a.label}</span>
              {a.hint && <span className="d block">{a.hint}</span>}
            </span>
            <ArrowRight size={16} className="muted" />
          </Link>
        ))}
      </div>
      <div className="dlg-foot"><button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>Not now</button></div>
    </dialog>
  );
}
