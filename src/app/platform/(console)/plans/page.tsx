import { sql } from "@/lib/db";
import { requirePlatform } from "@/lib/platform";
import { ActionForm } from "@/components/ActionForm";
import { updatePlan } from "@/app/actions/platform";

const FEATURES: [string, string][] = [["candidate_portal", "Candidate portal"], ["employer_portal", "Employer portal"], ["mpesa", "M-Pesa collection"], ["whatsapp", "WhatsApp"], ["reports", "Reports"], ["exports", "CSV exports"]];

export default async function Plans() {
  await requirePlatform();
  const plans = await sql`SELECT * FROM plans ORDER BY sort`;
  return (
    <>
      <h1 className="h1">Plans</h1>
      <p className="muted">Changes apply to every agency on the plan straight away. Leave a limit empty for unlimited.</p>
      {plans.map((p) => (
        <div key={p.code} className="card">
          <ActionForm confirm="Save this plan? New limits apply to every agency on it immediately." action={updatePlan.bind(null, p.code)} submit="Save plan" resetOnSuccess={false} className="grid gap-3">
            <div className="h2">{p.code}</div>
            <div className="grid sm:grid-cols-4 gap-3">
              <div><label className="label" htmlFor={`n_${p.code}`}>Name</label><input id={`n_${p.code}`} name="name" defaultValue={p.name} className="input" /></div>
              <div><label className="label" htmlFor={`p_${p.code}`}>Price per month (KES)</label><input id={`p_${p.code}`} name="price" defaultValue={(Number(p.price_kes_minor) / 100).toFixed(2)} className="input" /></div>
              <div><label className="label" htmlFor={`u_${p.code}`}>Staff accounts</label><input id={`u_${p.code}`} name="max_users" type="number" defaultValue={p.max_users ?? ""} className="input" /></div>
              <div><label className="label" htmlFor={`c_${p.code}`}>Candidates</label><input id={`c_${p.code}`} name="max_candidates" type="number" defaultValue={p.max_candidates ?? ""} className="input" /></div>
            </div>
            <div className="flex flex-wrap gap-4">
              {FEATURES.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name={`f_${k}`} defaultChecked={Boolean(p.features[k])} /> {l}</label>)}
              <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={p.active} /> Offered to new agencies</label>
            </div>
          </ActionForm>
        </div>
      ))}
    </>
  );
}
