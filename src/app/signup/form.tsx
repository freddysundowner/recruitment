"use client";

import { ActionForm } from "@/components/ActionForm";
import { signup } from "../actions/signup";

export function SignupForm() {
  return (
    <ActionForm action={signup} submit="Create my workspace" resetOnSuccess={false}>
      <div>
        <label className="label" htmlFor="agency">Agency name</label>
        <input id="agency" name="agency" required className="input" autoFocus />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="name">Your name</label><input id="name" name="name" required className="input" /></div>
        <div><label className="label" htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="username" className="input" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="password">Password (8+ characters)</label><input id="password" name="password" type="password" minLength={8} required autoComplete="new-password" className="input" /></div>
      </div>
      <label className="flex items-start gap-2"><input type="checkbox" name="terms" className="mt-1" /><span>I agree to the terms of service and privacy policy.</span></label>
    </ActionForm>
  );
}
