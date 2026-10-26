import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { can, ROLE_LABEL } from "@/lib/perms";
import { getAccess } from "@/lib/plan";
import { Suspense } from "react";
import { AppShell, type NavGroup } from "@/components/shell/AppShell";
import { NextStepHost } from "@/components/NextStepHost";
import { logout } from "../actions/auth";
import { exitSupport } from "../actions/platform";

import type { Metadata } from "next";

// Private pages: keep them out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireCtx();
  if (ctx.role === "employer") redirect("/employer");
  if (ctx.mustSetup2fa) redirect("/account/security?required=1");
  const access = await getAccess(ctx.tenantId);

  const info = await withTenant(ctx.tenantId, async (tx) => {
    const [t] = await tx`SELECT name, settings FROM tenants WHERE id = ${ctx.tenantId}`;
    const [n] = await tx`
      SELECT (SELECT count(*) FROM documents WHERE status = 'pending') AS docs,
             (SELECT count(*) FROM complaints WHERE status <> 'resolved') AS complaints,
             (SELECT count(*) FROM checkins WHERE done_on IS NULL AND due_on < current_date) AS checkins,
             (SELECT count(*) FROM messages WHERE status = 'failed') AS failed,
             (SELECT sms_credits FROM tenants WHERE id = ${ctx.tenantId}) AS credits`;
    return { brand: (t.settings?.brand_name as string) || (t.name as string), color: t.settings?.brand_color as string | undefined, n };
  });
  const color = /^#[0-9a-f]{6}$/i.test(info.color ?? "") ? info.color : undefined;
  const admin = can(ctx.role, "users:manage");

  const verifyBadge = can(ctx.role, "documents:verify") ? Number(info.n.docs) : 0;
  const waiting = verifyBadge + Number(info.n.complaints) + Number(info.n.checkins) + Number(info.n.failed);
  const groups: NavGroup[] = [
    {
      title: "Overview",
      items: [
        { href: "/", label: "Home", icon: "dashboard" },
        { href: "/todo", label: "To do", icon: "todo", badge: waiting, tone: "warn" },
      ],
    },
    {
      title: "Recruit",
      items: [
        { href: "/candidates", label: "Candidates", icon: "candidates" },
        { href: "/pipeline", label: "Pipeline", icon: "pipeline" },
        { href: "/job-orders", label: "Job orders", icon: "jobs" },
        { href: "/employers", label: "Employers", icon: "employers" },
        ...(can(ctx.role, "documents:verify") ? [{ href: "/verify", label: "Verify documents", icon: "verify" as const, badge: Number(info.n.docs), tone: "warn" as const }] : []),
      ],
    },
    {
      title: "Follow through",
      items: [
        { href: "/follow-up", label: "Follow-up", icon: "followup", badge: Number(info.n.checkins), tone: "warn" },
        { href: "/complaints", label: "Complaints", icon: "complaints", badge: Number(info.n.complaints), tone: "bad" },
        ...(ctx.role !== "finance" ? [{ href: "/messages", label: "Messages", icon: "messages" as const, badge: Number(info.n.failed), tone: "bad" as const }] : []),
      ],
    },
    {
      title: "Money and insight",
      items: [
        ...(can(ctx.role, "finance:read") ? [{ href: "/finance", label: "Finance", icon: "finance" as const }] : []),
        { href: "/reports", label: "Reports", icon: "reports" },
      ],
    },
    ...(admin
      ? [{ title: "Admin", items: [...(!access.singleInstall ? [{ href: "/billing", label: "Billing", icon: "billing" as const }] : []), { href: "/settings", label: "Settings", icon: "settings" as const }] }]
      : []),
  ];

  return (
    <div style={color ? ({ "--brand": color } as React.CSSProperties) : undefined}>
      <AppShell groups={groups} brand={info.brand} user={{ name: ctx.name, role: ROLE_LABEL[ctx.role] }} logout={logout} fab={can(ctx.role, "candidates:write") ? { href: "/candidates/new", label: "Add candidate" } : undefined}>
        {ctx.support && (
          <div className="alert flex items-center justify-between gap-3 flex-wrap">
            <span>Support access by {ctx.support}. This session is read-only and is recorded in this agency&apos;s activity log.</span>
            <form action={exitSupport}><button className="btn btn-sm">Exit support access</button></form>
          </div>
        )}
        {access.singleInstall && access.licenseNote && (
          <div className={access.writable ? "notice" : "alert"}>{access.licenseNote} {admin && <Link className="underline font-semibold" href="/settings/activation">Enter a key in Settings</Link>}</div>
        )}
        {!ctx.support && !access.singleInstall && !access.writable && (
          <div className="alert">This account is read-only. {admin ? <Link className="underline font-semibold" href="/billing">Renew on the Billing page</Link> : "Ask your agency admin to renew."}</div>
        )}
        {!access.singleInstall && access.writable && access.inGrace && (
          <div className="alert">Your subscription ended. You have {7 + access.daysLeft} day(s) before the account becomes read-only. {admin && <Link className="underline font-semibold" href="/billing">Renew now</Link>}</div>
        )}
        {!access.singleInstall && access.status === "trialing" && access.daysLeft > 0 && access.daysLeft <= 7 && admin && (
          <div className="notice">Your free trial ends in {access.daysLeft} day{access.daysLeft === 1 ? "" : "s"}. <Link className="underline font-semibold" href="/billing">Choose a plan</Link></div>
        )}
        {!access.singleInstall && admin && !ctx.support && Number(info.n.credits) <= 5 && (
          <div className={Number(info.n.credits) === 0 ? "alert" : "notice"}>
            {Number(info.n.credits) === 0 ? "You are out of SMS credits, so texts to candidates are not being sent." : `You have ${Number(info.n.credits)} SMS credit${Number(info.n.credits) === 1 ? "" : "s"} left.`} <Link className="underline font-semibold" href="/billing#credits">Buy credits</Link>
          </div>
        )}
        <Suspense><NextStepHost /></Suspense>
        {children}
      </AppShell>
    </div>
  );
}
