"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { FormState } from "@/lib/form";
import { emitNext } from "@/lib/next-bus";

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submit?: string;
  className?: string;
  buttonClass?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
};

/**
 * A form that runs a server action and shows its error or success message.
 * It submits through a transition instead of `<form action>` so that React does not
 * wipe the fields when the server reports a validation error.
 */
export function ActionForm({ action, children, submit, className, buttonClass = "btn btn-primary", resetOnSuccess = true, confirm }: Props) {
  // Announce the suggestion as soon as the server answers. Waiting for an effect is too late when the page
  // refresh replaces this form in the same update.
  const [state, run, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r?.next) emitNext(r.next);
    return r;
  }, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      // If the browser submits before this component has loaded, a POST keeps personal data out of the URL.
      method="post"
      className={className ?? "grid gap-3"}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
    >
      {state?.error && <div className="alert col-span-full">{state.error}</div>}
      {state?.ok && <div className="badge badge-good w-fit col-span-full">{state.ok}</div>}
      {state?.data && (
        <pre className="col-span-full bg-[#f1f3f6] rounded-lg p-3 text-xs whitespace-pre-wrap select-all">{state.data.join("\n")}</pre>
      )}
      {children}
      {submit && (
        <div>
          <button className={buttonClass} disabled={pending}>{pending ? "Working…" : submit}</button>
        </div>
      )}
    </form>
  );
}
