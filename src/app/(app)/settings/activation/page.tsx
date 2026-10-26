import { notFound } from "next/navigation";
import { requirePageCan } from "@/lib/session";
import { getAccess } from "@/lib/plan";
import { ActionForm } from "@/components/ActionForm";
import { SettingsCard } from "@/components/ui/SettingsCard";
import { activateKey } from "@/app/actions/setup";

export default async function Activation() {
  const ctx = await requirePageCan("users:manage");
  const access = await getAccess(ctx.tenantId);
  if (!access.singleInstall) notFound();
  const forever = access.periodEnd.getFullYear() > 2900;
  return (
    <SettingsCard title="Activation" badge={<span className={`badge ${access.writable ? "badge-good" : "badge-bad"}`}>{access.writable ? "active" : "ended"}</span>}
      desc={`${forever ? "Your activation key does not expire." : `Your activation key is valid until ${access.periodEnd.toLocaleDateString("en-KE")}.`}${access.maxUsers ? ` It allows ${access.maxUsers} staff accounts.` : ""} To renew or change it, paste the new key below.`}>
      <ActionForm action={activateKey} submit="Save key" className="grid gap-3 max-w-xl">
        <textarea name="key" rows={3} required className="textarea font-mono text-xs" placeholder="RAK1...." aria-label="Activation key" />
      </ActionForm>
    </SettingsCard>
  );
}
