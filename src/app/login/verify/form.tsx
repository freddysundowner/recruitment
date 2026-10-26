"use client";

import { useActionState } from "react";
import { verifyMfa } from "../../actions/auth";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyMfa, undefined);
  return (
    <form action={action} className="grid gap-3">
      {state?.error && <div className="alert">{state.error}</div>}
      <div>
        <label className="label" htmlFor="code">Code</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required className="input" />
      </div>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Checking…" : "Verify"}</button>
    </form>
  );
}
