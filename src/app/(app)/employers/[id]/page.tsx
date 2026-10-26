import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { ActionForm } from "@/components/ActionForm";
import { setVetted } from "@/app/actions/org";
import { addEmployerCheck } from "@/app/actions/operations";
import { createEmployerUser } from "@/app/actions/org";

export default async function Employer({ params }: PageProps<"/employers/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { e, jobs, checks, portalUsers } = await withTenant(ctx.tenantId, async (tx) => ({
    portalUsers: await tx`SELECT name, email, status FROM users WHERE employer_id = ${id} ORDER BY created_at`,
    checks: await tx`SELECT k.*, u.name AS who FROM employer_checks k LEFT JOIN users u ON u.id = k.checked_by WHERE k.employer_id = ${id} ORDER BY k.checked_on DESC, k.id`,
    e: (await tx`SELECT * FROM employers WHERE id = ${id}`)[0],
    jobs: await tx`
      SELECT j.*, (SELECT count(*) FROM placements p WHERE p.job_order_id = j.id AND p.outcome <> 'closed') AS filled
      FROM job_orders j WHERE j.employer_id = ${id} ORDER BY j.created_at DESC`,
  }));
  if (!e) notFound();
  const write = can(ctx.role, "employers:write");

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="h1">{e.company}</h1>
          <div className="muted">{e.country} · invoices in {e.currency}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`badge ${e.vetted ? "badge-good" : "badge-warn"}`}>{e.vetted ? "Vetted" : "Not vetted"}</span>
          {write && (
            <ActionForm action={setVetted.bind(null, e.id, !e.vetted)} confirm={e.vetted ? "Remove vetting? Candidates cannot move past the shortlist for this employer until it is marked as vetted again." : "Mark this employer as vetted? Make sure the registration check has passed."} submit={e.vetted ? "Remove vetting" : "Mark as vetted"} buttonClass="btn btn-sm" className="">
              <></>
            </ActionForm>
          )}
        </div>
      </div>
      <div className="card grid sm:grid-cols-3 gap-3">
        <div><div className="label">Contact</div>{e.contact_name ?? "—"}</div>
        <div><div className="label">Email</div>{e.email ?? "—"}</div>
        <div><div className="label">Phone</div>{e.phone ?? "—"}</div>
        {e.notes && <div className="sm:col-span-3"><div className="label">Notes</div>{e.notes}</div>}
      </div>
      <div id="checks" style={{ scrollMarginTop: 80 }} className="card">
        <div className="h2 mb-1">Vetting checks</div>
        <p className="muted text-xs mb-2">An employer can be marked vetted only after a registration check has passed. Record references, past complaints and any visits too.</p>
        <table className="table">
          <tbody>
            {checks.map((k) => (
              <tr key={k.id}>
                <td className="whitespace-nowrap">{new Date(k.checked_on).toLocaleDateString("en-KE")}</td>
                <td>{String(k.kind).replace("_", " ")}</td>
                <td><span className={`badge ${k.result === "ok" ? "badge-good" : "badge-bad"}`}>{k.result === "ok" ? "fine" : "concern"}</span></td>
                <td className="muted">{k.notes}</td><td className="muted text-xs">{k.who}</td>
              </tr>
            ))}
            {checks.length === 0 && <tr><td className="muted">No checks recorded.</td></tr>}
          </tbody>
        </table>
        {write && (
          <ActionForm action={addEmployerCheck.bind(null, e.id)} submit="Record check" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
            <div className="grid sm:grid-cols-4 gap-3">
              <div><label className="label" htmlFor="kind">Check</label><select id="kind" name="kind" className="select"><option value="registration">Company registration</option><option value="references">References</option><option value="past_complaints">Past complaints</option><option value="site_visit">Site visit</option><option value="other">Other</option></select></div>
              <div><label className="label" htmlFor="result">Result</label><select id="result" name="result" className="select"><option value="ok">Fine</option><option value="concern">Concern</option></select></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="notes">Notes</label><input id="notes" name="notes" className="input" /></div>
            </div>
          </ActionForm>
        )}
      </div>
      <div id="logins" style={{ scrollMarginTop: 80 }} className="card">
        <div className="h2 mb-1">Employer portal logins</div>
        <p className="muted text-xs mb-2">Lets this employer review shortlisted candidates, request interviews, select or reject, send their signed contract terms and see their invoices.</p>
        {portalUsers.map((u) => <div key={u.email} className="flex justify-between border-b border-[var(--line)] py-1.5 last:border-0"><span>{u.name} <span className="muted text-xs">{u.email}</span></span><span className="badge">{u.status}</span></div>)}
        {portalUsers.length === 0 && <p className="muted">No logins yet.</p>}
        {write && (
          <ActionForm action={createEmployerUser.bind(null, e.id)} submit="Create login" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
            <div className="grid sm:grid-cols-3 gap-3">
              <div><label className="label" htmlFor="pu_name">Name</label><input id="pu_name" name="name" required className="input" /></div>
              <div><label className="label" htmlFor="pu_email">Email</label><input id="pu_email" name="email" type="email" required className="input" /></div>
              <div><label className="label" htmlFor="pu_pw">Temporary password</label><input id="pu_pw" name="password" type="password" minLength={8} required className="input" /></div>
            </div>
          </ActionForm>
        )}
      </div>
      <div className="card p-0 overflow-x-auto">
        <div className="p-4 pb-0 h2">Job orders</div>
        <table className="table">
          <thead><tr><th>Title</th><th>Country</th><th>Filled</th><th>Costs paid by</th><th>Status</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><Link className="link" href={`/job-orders/${j.id}`}>{j.title}</Link></td>
                <td>{j.country}</td>
                <td>{Number(j.filled)} / {j.quantity}</td>
                <td>{j.payment_model === "employer_paid" ? "Employer" : "Candidate"}</td>
                <td><span className="badge">{j.status}</span></td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={5} className="muted">No job orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
