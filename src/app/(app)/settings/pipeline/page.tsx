import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { ActionForm } from "@/components/ActionForm";
import { SettingsCard } from "@/components/ui/SettingsCard";
import { deleteChecklist, saveChecklist } from "@/app/actions/operations";
import { saveRules } from "@/app/actions/org";
import { DOC_TYPES } from "@/lib/stages";

export default async function PipelineSettings() {
  const ctx = await requirePageCan("users:manage");
  const d = await withTenant(ctx.tenantId, async (tx) => ({
    stages: await tx`SELECT * FROM pipeline_stages ORDER BY position`,
    checklists: await tx`SELECT * FROM country_checklists ORDER BY country, job_category`,
    rules: ((await tx`SELECT settings FROM tenants WHERE id = ${ctx.tenantId}`)[0].settings?.rules ?? {}) as { contract_check?: boolean; require_vetting?: boolean },
  }));
  return (
    <>
      <SettingsCard title="Rules you can relax" desc="Two checks that suit an established agency but can slow a new one down. Turn them on when you are ready. Document, fee, visa and orientation checks always apply.">
        <ActionForm action={saveRules} submit="Save" resetOnSuccess={false} className="grid gap-3 max-w-xl">
          <label className="flex items-start gap-2"><input type="checkbox" name="require_vetting" defaultChecked={d.rules.require_vetting !== false} className="mt-1" /><span><b>Only use vetted employers</b><span className="block muted text-xs">Candidates cannot go past the shortlist until the employer has a passed registration check.</span></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="contract_check" defaultChecked={d.rules.contract_check !== false} className="mt-1" /><span><b>Compare the candidate&apos;s and the employer&apos;s contract copies</b><span className="block muted text-xs">Both copies must be recorded and agree on salary, hours and length before the next stage. This catches contract substitution.</span></span></label>
        </ActionForm>
      </SettingsCard>

      <SettingsCard id="checklists" title="Country checklists" desc="What a worker needs before leaving for each country. The documents listed here replace the default list at the stage that checks documents. Leave the category empty to apply to every job in that country.">
        <div className="overflow-x-auto -mx-[18px]">
          <table className="table">
            <thead><tr><th>Country</th><th>Job category</th><th>Documents needed</th><th>Steps</th><th></th></tr></thead>
            <tbody>
              {d.checklists.map((c) => (
                <tr key={c.id}>
                  <td className="font-semibold">{c.country}</td><td>{c.job_category || "All jobs"}</td>
                  <td>{(c.required_doc_types as string[]).join(", ") || "—"}</td><td>{(c.steps as string[]).join("; ") || "—"}</td>
                  <td className="text-right"><ActionForm action={deleteChecklist.bind(null, c.id)} submit="Delete" buttonClass="btn btn-sm btn-danger" className="inline" confirm="Delete this checklist?"><></></ActionForm></td>
                </tr>
              ))}
              {d.checklists.length === 0 && <tr><td colSpan={5} className="muted">No checklists yet. Without one, the stage&apos;s default document list applies.</td></tr>}
            </tbody>
          </table>
        </div>
        <ActionForm action={saveChecklist} submit="Save checklist" className="grid gap-3 mt-4 pt-4 border-t border-[var(--line)]">
          <div className="h2">Add or update a checklist</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="cl_country">Country</label><input id="cl_country" name="country" required className="input" placeholder="United Arab Emirates" /></div>
            <div><label className="label" htmlFor="cl_cat">Job category (optional)</label><input id="cl_cat" name="category" className="input" placeholder="Nurse" /></div>
          </div>
          <div><label className="label" htmlFor="cl_docs">Required documents, separated by commas</label><input id="cl_docs" name="docs" className="input" placeholder={DOC_TYPES.slice(0, 3).join(", ")} /></div>
          <div><label className="label" htmlFor="cl_steps">Steps, one per line</label><textarea id="cl_steps" name="steps" rows={3} className="textarea" placeholder={"Attend embassy briefing\nSign employment contract"} /></div>
        </ActionForm>
      </SettingsCard>

      <SettingsCard title="Pipeline stages" desc="The nine stages every candidate goes through, and the rules that stop a candidate moving on until they are met. Only an admin can override a rule, and must give a reason.">
        <div className="overflow-x-auto -mx-[18px]">
          <table className="table">
            <thead><tr><th>#</th><th>Stage</th><th>Before leaving this stage</th></tr></thead>
            <tbody>
              {d.stages.map((s) => {
                const rules = [
                  (s.required_doc_types as string[]).length ? `verified: ${(s.required_doc_types as string[]).join(", ")}` : "",
                  s.requires_payment && "fees due are paid", s.requires_contract && "both contract copies agree", s.requires_visa && "visa approved",
                  s.requires_orientation && "orientation done", s.requires_arrival && "arrival confirmed",
                ].filter(Boolean) as string[];
                const entering = [s.requires_job_order && "a job order", s.requires_vetted_employer && "a vetted employer"].filter(Boolean) as string[];
                return (
                  <tr key={s.id}>
                    <td className="muted">{s.position}</td>
                    <td><span className="font-semibold">{s.name}</span><div className="muted text-xs">{s.description}</div></td>
                    <td className="text-[13px]">
                      {rules.length ? rules.map((r) => <span key={r} className="badge badge-warn mr-1 mb-1">{r}</span>) : <span className="muted">No rule</span>}
                      {entering.length > 0 && <div className="muted text-xs mt-0.5">To enter: {entering.join(" and ")}</div>}
                      {s.marks_deployed && <div className="text-xs mt-0.5"><span className="badge badge-good">counts as deployed</span></div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SettingsCard>
    </>
  );
}
