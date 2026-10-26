import { requirePageCan } from "@/lib/session";
import { getAccess } from "@/lib/plan";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsNav, type SettingsGroup } from "@/components/shell/SettingsNav";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const ctx = await requirePageCan("users:manage");
  const access = await getAccess(ctx.tenantId);
  const t = await withTenant(ctx.tenantId, async (tx) => (await tx`SELECT name FROM tenants WHERE id = ${ctx.tenantId}`)[0]);
  const groups: SettingsGroup[] = [
    { title: "Agency", items: [
      { href: "/settings/general", label: "General", icon: "general", hint: "Name, colour, candidate page" },
      { href: "/settings/team", label: "Team", icon: "team", hint: "Staff accounts and roles" },
    ] },
    { title: "Recruitment", items: [
      { href: "/settings/pipeline", label: "Pipeline and checklists", icon: "pipeline", hint: "Stages, rules, country lists" },
    ] },
    { title: "Money and messages", items: [
      ...(!access.singleInstall ? [{ href: "/billing", label: "Plan and billing", icon: "billing" as const, hint: "Your subscription" }] : []),
      { href: "/settings/payments", label: "Payments", icon: "payments", hint: "M-Pesa and fee limit" },
      { href: "/settings/messages", label: "Messages", icon: "messages", hint: "SMS, WhatsApp, email" },
    ] },
    { title: "Security and records", items: [
      { href: "/settings/security", label: "Security", icon: "security", hint: "Two-step sign-in" },
      { href: "/settings/activity", label: "Activity log", icon: "activity", hint: "Who did what, when" },
      ...(access.singleInstall ? [{ href: "/settings/activation", label: "Activation", icon: "activation" as const, hint: "Your activation key" }] : []),
    ] },
  ];
  return (
    <>
      <PageHeader title="Settings" sub={`${t.name}${access.singleInstall ? "" : ` · ${access.planName} plan`}`} />
      <div className="settings-wrap">
        <SettingsNav groups={groups} />
        <div className="settings-panel">{children}</div>
      </div>
    </>
  );
}
