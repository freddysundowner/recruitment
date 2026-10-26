import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { formatMoney } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { approveJobOrder, setJobOrderStatus } from "@/app/actions/org";
import { CURRENCIES } from "@/lib/money";
import { decideApplication } from "@/app/actions/operations";

export default async function JobOrder({ params }: PageProps<"/job-orders/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { j, people, applicants } = await withTenant(ctx.tenantId, async (tx) => ({
    applicants: await tx`
      SELECT a.id, a.created_at, c.id AS cid, c.first_name, c.last_name, c.county, c.skills,
             EXISTS (SELECT 1 FROM placements p WHERE p.candidate_id = c.id AND p.outcome <> 'closed' AND p.job_order_id IS NULL) AS free
      FROM applications a JOIN candidates c ON c.id = a.candidate_id WHERE a.job_order_id = ${id} AND a.status = 'pending' ORDER BY a.created_at`,
    j: (await tx`SELECT j.*, e.company, e.vetted, e.id AS employer_id FROM job_orders j JOIN employers e ON e.id = j.employer_id WHERE j.id = ${id}`)[0],
    people: await tx`
      SELECT p.id, p.outcome, c.first_name, c.last_name, s.name AS stage
      FROM placements p JOIN candidates c ON c.id = p.candidate_id JOIN pipeline_stages s ON s.id = p.stage_id
      WHERE p.job_order_id = ${id} AND p.outcome <> 'closed' ORDER BY s.position DESC`,
  }));
  if (!j) notFound();

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="h1">{j.title}</h1>
          <div className="muted">
            <Link className="link" href={`/employers/${j.employer_id}`}>{j.company}</Link> · {j.country}{j.category ? ` · ${j.category}` : ""}
            {!j.vetted && <span className="badge badge-warn ml-2">employer not vetted</span>}
          </div>
        </div>
        {can(ctx.role, "joborders:write") && j.status !== "pending" && (
          <ActionForm
            action={setJobOrderStatus.bind(null, j.id, j.status === "open" ? "closed" : "open")}
            submit={j.status === "open" ? "Close job order" : j.status === "pending" ? "Approve and open" : "Reopen"}
            buttonClass="btn btn-sm"
            className=""
            confirm={j.status === "open" ? "Close this job order?" : undefined}
          ><></></ActionForm>
        )}
      </div>
      <div className="card grid sm:grid-cols-4 gap-3">
        <div><div className="label">Workers</div>{people.length} of {j.quantity}</div>
        <div><div className="label">Salary</div>{j.salary || "—"}</div>
        <div><div className="label">Costs paid by</div>{j.payment_model === "employer_paid" ? "Employer, repaid after deployment" : "Candidate"}</div>
        <div><div className="label">Placement fee</div>{Number(j.placement_fee_minor) ? formatMoney(j.placement_fee_minor, j.fee_currency) : "—"}</div>
        {j.terms && <div className="sm:col-span-4"><div className="label">Terms</div><p className="whitespace-pre-wrap">{j.terms}</p></div>}
      </div>
      {j.status === "pending" && (
        <div className="card grid gap-3">
          <div className="alert">The employer asked for these workers. Check the details, choose how it is paid, then approve to open the job order.</div>
          {can(ctx.role, "joborders:write") && (
            <ActionForm action={approveJobOrder.bind(null, j.id)} submit="Approve and open" resetOnSuccess={false}>
              <div className="grid sm:grid-cols-3 gap-3">
                <div><label className="label" htmlFor="payment_model">Who pays the costs</label><select id="payment_model" name="payment_model" className="select" defaultValue="employer_paid"><option value="employer_paid">Employer (agency fronts costs)</option><option value="candidate_paid">Candidate pays</option></select></div>
                <div><label className="label" htmlFor="fee">Placement fee per worker</label><input id="fee" name="fee" placeholder="0.00" className="input" /></div>
                <div><label className="label" htmlFor="fee_currency">Currency</label><select id="fee_currency" name="fee_currency" className="select" defaultValue="USD">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              </div>
            </ActionForm>
          )}
        </div>
      )}
      {applicants.length > 0 && (
        <div className="card p-0 overflow-x-auto">
          <div className="p-4 pb-0 h2">Applied online ({applicants.length})</div>
          <table className="table">
            <tbody>
              {applicants.map((a) => (
                <tr key={a.id}>
                  <td><Link className="link" href={`/candidates/${a.cid}`}>{a.first_name} {a.last_name}</Link><div className="muted text-xs">{a.county} {a.skills && `· ${a.skills}`}</div></td>
                  <td className="text-right whitespace-nowrap">
                    {can(ctx.role, "pipeline:move") && (
                      <span className="inline-flex gap-1">
                        {a.free && <ActionForm action={decideApplication.bind(null, a.id, "shortlisted", j.id)} submit="Shortlist" buttonClass="btn btn-sm btn-primary" className="inline"><></></ActionForm>}
                        <ActionForm action={decideApplication.bind(null, a.id, "declined", j.id)} submit="Decline" buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                      </span>
                    )}
                    {!a.free && <span className="muted text-xs">already on another job</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card p-0 overflow-x-auto">
        <div className="p-4 pb-0 h2">Candidates on this order</div>
        <table className="table">
          <thead><tr><th>Candidate</th><th>Stage</th><th></th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.first_name} {p.last_name}</td>
                <td><span className="badge">{p.stage}</span></td>
                <td className="text-right"><Link className="link" href={`/placements/${p.id}`}>Open</Link></td>
              </tr>
            ))}
            {people.length === 0 && <tr><td colSpan={3} className="muted">Nobody assigned yet. Assign this job order from a candidate&apos;s page.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
