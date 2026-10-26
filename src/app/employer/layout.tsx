import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { withEmployer } from "@/lib/db";
import { getAccess } from "@/lib/plan";
import { Suspense } from "react";
import { NextStepHost } from "@/components/NextStepHost";
import { logout } from "../actions/auth";

export default async function EmployerLayout({ children }: LayoutProps<"/employer">) {
  const ctx = await requireCtx();
  if (ctx.role !== "employer" || !ctx.employerId) redirect("/");
  if (ctx.mustSetup2fa) redirect("/account/security?required=1");
  const access = await getAccess(ctx.tenantId);
  if (!access.features.employer_portal) {
    return <div className="max-w-xl mx-auto p-6"><div className="card"><h1 className="h1">Employer portal unavailable</h1><p className="mt-2">This agency is not currently offering the employer portal. Please contact them directly.</p></div></div>;
  }
  const info = await withEmployer(ctx.tenantId, ctx.employerId, async (tx) => ({
    company: (await tx`SELECT company FROM employers WHERE id = ${ctx.employerId!}`)[0]?.company as string,
    agency: (await tx`SELECT name, settings FROM tenants WHERE id = ${ctx.tenantId}`)[0],
  }));
  const brand = /^#[0-9a-f]{6}$/i.test(info.agency.settings?.brand_color ?? "") ? info.agency.settings.brand_color : undefined;
  return (
    <div className="min-h-screen" style={brand ? ({ "--brand": brand } as React.CSSProperties) : undefined}>
      <header className="bg-[var(--brand)] text-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div><div className="font-bold text-lg">{info.company}</div><div className="text-xs opacity-80">Employer portal · {info.agency.settings?.brand_name || info.agency.name}</div></div>
          <div className="flex items-center gap-3 text-sm">
            <span>{ctx.name}</span>
            <Link href="/account/security" className="underline">Security</Link>
            <form action={logout}><button className="underline">Sign out</button></form>
          </div>
        </div>
        <nav className="max-w-5xl mx-auto px-2 flex overflow-x-auto">
          {[["/employer", "Overview"], ["/employer/request", "Request workers"], ["/employer/invoices", "Invoices"]].map(([h, l]) => (
            <Link key={h} href={h} className="px-3 py-2 text-sm font-medium whitespace-nowrap hover:bg-white/15">{l}</Link>
          ))}
        </nav>
      </header>
      <main className="max-w-5xl mx-auto p-4 grid gap-4"><Suspense><NextStepHost /></Suspense>{children}</main>
    </div>
  );
}
