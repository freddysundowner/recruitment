import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { ActionForm } from "@/components/ActionForm";
import { SettingsCard } from "@/components/ui/SettingsCard";
import { saveSecurity } from "@/app/actions/org";

export default async function SecuritySettings() {
  const ctx = await requirePageCan("users:manage");
  const d = await withTenant(ctx.tenantId, async (tx) => ({
    settings: (await tx`SELECT settings FROM tenants WHERE id = ${ctx.tenantId}`)[0].settings,
    users: await tx`SELECT name, totp_enabled FROM users WHERE role <> 'employer' AND status = 'active' ORDER BY name`,
  }));
  const on = d.users.filter((u) => u.totp_enabled).length;
  return (
    <>
      <SettingsCard title="Two-step sign-in" badge={<span className="badge">{on} of {d.users.length} staff have it on</span>}
        desc="After their password, people enter a 6-digit code from an authenticator app on their phone. It stops a stolen password from being enough to reach your candidates' passports and records.">
        <ActionForm action={saveSecurity} submit="Save" resetOnSuccess={false} className="grid gap-3 max-w-xl">
          <label className="flex items-start gap-2.5">
            <input type="checkbox" name="require_2fa" defaultChecked={Boolean(d.settings?.require_2fa)} className="mt-1" />
            <span><b>Require it for everyone</b><span className="block muted text-xs">People who have not set it up are taken to set it up the next time they open the system. Employers are included.</span></span>
          </label>
        </ActionForm>
        {d.users.some((u) => !u.totp_enabled) && (
          <div className="mt-4 pt-4 border-t border-[var(--line)]">
            <div className="label">Not set up yet</div>
            <div className="flex gap-1.5 flex-wrap">{d.users.filter((u) => !u.totp_enabled).map((u) => <span key={u.name} className="badge badge-warn">{u.name}</span>)}</div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Your own account" desc="Turn on two-step sign-in for yourself, change your password, or see your recovery codes.">
        <Link href="/account/security" className="btn"><ShieldCheck size={16} /> Open my account security</Link>
      </SettingsCard>
    </>
  );
}
