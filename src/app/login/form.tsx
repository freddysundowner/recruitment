"use client";

import { useActionState } from "react";
import { login } from "../actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="grid gap-3">
      {state?.error && <div className="alert">{state.error}</div>}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
