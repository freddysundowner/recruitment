import Link from "next/link";
import { ExternalLink, FlaskConical } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { getAccess } from "@/lib/plan";
import { ActionForm } from "@/components/ActionForm";
import { SettingsCard } from "@/components/ui/SettingsCard";
import { saveGeneral } from "@/app/actions/org";

export default async function General() {
  const ctx = await requirePageCan("users:manage");
  const t = await withTenant(ctx.tenantId, async (tx) => (await tx`SELECT name, slug, settings FROM tenants WHERE id = ${ctx.tenantId}`)[0]);
  const access = await getAccess(ctx.tenantId);
  const url = `${process.env.APP_URL ?? "http://localhost:3100"}/c/${t.slug}`;
  const open = t.settings?.candidate_portal !== false;

  return (
    <>
      <SettingsCard title="Your agency" desc="How your agency appears to candidates and employers, in messages and on their pages.">
        <ActionForm action={saveGeneral} submit="Save" resetOnSuccess={false} className="grid gap-4 max-w-xl">
          <div>
            <label className="label" htmlFor="brand_name">Name shown to candidates</label>
            <input id="brand_name" name="brand_name" defaultValue={t.settings?.brand_name ?? ""} placeholder={t.name} className="input" />
            <p className="muted text-xs mt-1">Leave empty to use &ldquo;{t.name}&rdquo;.</p>
          </div>
          <div>
            <label className="label" htmlFor="brand_color">Brand colour</label>
            <div className="flex items-center gap-2"><input id="brand_color" name="brand_color" defaultValue={t.settings?.brand_color ?? ""} placeholder="#0f6b5c" className="input" style={{ maxWidth: 160 }} /><span className="muted text-xs">Used for buttons and headers. A hex code such as #1d4ed8.</span></div>
          </div>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" name="candidate_portal" defaultChecked={open} className="mt-1" disabled={!access.features.candidate_portal} />
            <span><b>Candidates can register and sign in online</b><span className="block muted text-xs">Turn this off to close registration and sign-in while you are not taking applications.</span></span>
          </label>
        </ActionForm>
      </SettingsCard>

      <SettingsCard title="Candidate page" desc="Share this address with candidates. They register with their phone, send documents, apply for jobs, and follow their progress.">
        {access.features.candidate_portal ? (
          <div className="flex items-center gap-2 flex-wrap">
            <code className="select-all" style={{ padding: "8px 12px", fontSize: 13.5 }}>{url}</code>
            <Link href={`/c/${t.slug}`} target="_blank" className="btn btn-sm"><ExternalLink size={14} /> Open</Link>
            {!open && <span className="badge badge-warn">currently closed</span>}
          </div>
        ) : <p className="muted">The candidate portal is not part of your plan. <Link className="link" href="/billing">Upgrade</Link> to turn it on.</p>}
      </SettingsCard>

      <SettingsCard title="Sample data" desc="Ten sample candidates, three employers and three jobs to explore with. Sample records are never messaged or charged.">
        <Link href="/getting-started" className="btn"><FlaskConical size={16} /> Manage sample data</Link>
      </SettingsCard>
    </>
  );
}
