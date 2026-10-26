import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isSingleInstall } from "@/lib/plan";
import { ActionForm } from "@/components/ActionForm";
import { runSetup } from "../actions/setup";

import type { Metadata } from "next";

// Private pages: keep them out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Depends on the database, so it is built when asked for, never ahead of time.
export const dynamic = "force-dynamic";

export default async function Setup() {
  if (!isSingleInstall()) redirect("/login");
  const [{ install_has_tenant: exists }] = await sql`SELECT install_has_tenant()`;
  if (exists) redirect("/login");
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="card w-full max-w-xl grid gap-3">
        <div><h1 className="h1">Set up your recruitment system</h1><p className="muted">This takes a minute. You will need the activation key you were given when you bought the system.</p></div>
        <ActionForm action={runSetup} submit="Activate and create my agency" resetOnSuccess={false}>
          <div><label className="label" htmlFor="key">Activation key</label><textarea id="key" name="key" rows={3} required className="textarea font-mono text-xs" placeholder="RAK1...." /></div>
          <div><label className="label" htmlFor="agency">Agency name</label><input id="agency" name="agency" required className="input" /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="name">Your name</label><input id="name" name="name" required className="input" /></div>
            <div><label className="label" htmlFor="email">Your email (your sign-in)</label><input id="email" name="email" type="email" required className="input" /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="password">Password (8+ characters)</label><input id="password" name="password" type="password" minLength={8} required autoComplete="new-password" className="input" /></div>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
