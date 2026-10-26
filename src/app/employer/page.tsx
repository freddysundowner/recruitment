import Link from "next/link";
import { withEmployer } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { formatMoney } from "@/lib/money";

export default async function EmployerHome() {
  const ctx = await requireCtx();
  const d = await withEmployer(ctx.tenantId, ctx.employerId!, async (tx) => ({
    jobs: await tx`
      SELECT j.id, j.title, j.country, j.quantity, j.status, j.deadline,
        (SELECT count(*) FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id WHERE p.job_order_id = j.id AND p.outcome <> 'closed' AND s.position IN (3, 4)) AS waiting,
        (SELECT count(*) FROM placements p WHERE p.job_order_id = j.id AND p.outcome <> 'closed') AS active
      FROM job_orders j ORDER BY (j.status = 'pending') DESC, j.created_at DESC`,
    invoices: await tx`
      SELECT currency, sum(amount_minor - COALESCE((SELECT sum(amount_minor) FROM payments WHERE invoice_id = i.id), 0)) AS due
      FROM invoices i WHERE status = 'open' GROUP BY currency`,
  }));
  const waiting = d.jobs.reduce((s, j) => s + Number(j.waiting), 0);
  return (
    <>
      <h1 className="h1">Overview</h1>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card"><div className="muted text-xs font-semibold">Candidates waiting for your decision</div><div className="text-2xl font-bold mt-1">{waiting}</div></div>
        <div className="card"><div className="muted text-xs font-semibold">Open job orders</div><div className="text-2xl font-bold mt-1">{d.jobs.filter((j) => j.status === "open").length}</div></div>
        <div className="card"><div className="muted text-xs font-semibold">Invoices to pay</div>
          {d.invoices.length === 0 ? <div className="text-2xl font-bold mt-1">None</div> : d.invoices.map((i) => <div key={i.currency} className="text-xl font-bold mt-1">{formatMoney(i.due, i.currency)}</div>)}
        </div>
      </div>
      <div className="card p-0 overflow-x-auto">
        <div className="p-4 pb-0 h2">Your job orders</div>
        <table className="table mt-2">
          <thead><tr><th>Role</th><th>Country</th><th>Workers</th><th>Waiting for you</th><th>Status</th></tr></thead>
          <tbody>
            {d.jobs.map((j) => (
              <tr key={j.id}>
                <td><Link className="link" href={`/employer/jobs/${j.id}`}>{j.title}</Link></td>
                <td>{j.country}</td><td>{Number(j.active)} / {j.quantity}</td>
                <td>{Number(j.waiting) > 0 ? <span className="badge badge-warn">{Number(j.waiting)} to review</span> : "—"}</td>
                <td><span className={`badge ${j.status === "open" ? "badge-good" : j.status === "pending" ? "badge-warn" : ""}`}>{j.status === "pending" ? "waiting for approval" : j.status}</span></td>
              </tr>
            ))}
            {d.jobs.length === 0 && <tr><td colSpan={5} className="muted">No job orders yet. <Link className="link" href="/employer/request">Request workers</Link>.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
