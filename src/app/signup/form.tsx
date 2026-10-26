"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { signup } from "../actions/signup";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);

export function SignupForm({ plans }: { plans: { code: string; label: string }[] }) {
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  return (
    <ActionForm action={signup} submit="Create my workspace" resetOnSuccess={false}>
      <div>
        <label className="label" htmlFor="agency">Agency name</label>
        <input id="agency" name="agency" required className="input" onChange={(e) => { if (!touched) setSlug(slugify(e.target.value)); }} />
      </div>
      <div>
        <label className="label" htmlFor="slug">Web address for your candidates</label>
        <div className="flex items-center gap-1"><span className="muted text-sm">/c/</span><input id="slug" name="slug" value={slug} onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)); }} required className="input" /></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="name">Your name</label><input id="name" name="name" required className="input" /></div>
        <div><label className="label" htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="username" className="input" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="password">Password (10+ characters)</label><input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" className="input" /></div>
      </div>
      <div>
        <label className="label" htmlFor="plan">Plan to try</label>
        <select id="plan" name="plan" className="select" defaultValue="pro">{plans.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</select>
      </div>
      <label className="flex items-start gap-2"><input type="checkbox" name="terms" className="mt-1" /><span>I agree to the terms of service and privacy policy.</span></label>
    </ActionForm>
  );
}
