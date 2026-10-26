import Link from "next/link";
import { redirect } from "next/navigation";
import { Globe2 } from "lucide-react";
import { getCtx } from "@/lib/session";
import { isSingleInstall } from "@/lib/plan";
import { getPlatformConfig } from "@/lib/platform-config";
import { sql } from "@/lib/db";
import { LoginForm } from "./form";

import type { Metadata } from "next";

// Private pages: keep them out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function LoginPage() {
  if (await getCtx()) redirect("/");
  if (isSingleInstall()) {
    const [{ install_has_tenant: exists }] = await sql`SELECT install_has_tenant()`;
    if (!exists) redirect("/setup");
  }
  return (
    <main className="min-h-screen grid place-items-center p-4" style={{ background: "linear-gradient(180deg, #eef3f2 0%, var(--bg) 60%)" }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-5">
          <span className="brand-mark" style={{ width: 46, height: 46, borderRadius: 14 }}><Globe2 size={24} /></span>
          <h1 className="h1 mt-3">Sign in to your workspace</h1>
          <p className="muted">Agency staff and employers sign in here.</p>
        </div>
        <div className="card" style={{ padding: 24 }}>
          <LoginForm />
        </div>
        {(await getPlatformConfig()).signup.enabled && <p className="muted text-sm text-center mt-4">New agency? <Link className="link" href="/signup">Start a free trial</Link></p>}
        <p className="muted text-xs text-center mt-2">Looking for work abroad? Ask your agency for its candidate page address.</p>
      </div>
    </main>
  );
}
