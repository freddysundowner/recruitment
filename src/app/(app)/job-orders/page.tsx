import Link from "next/link";
import { Briefcase, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";

export default async function Openings() {
  const ctx = await requireCtx();
  const rows = await withTenant(ctx.tenantId, (tx) => tx`
    SELECT j.*, e.company,
      (SELECT count(*) FROM placements p WHERE p.job_order_id = j.id AND p.outcome <> 'closed') AS filled
    FROM job_orders j JOIN employers e ON e.id = j.employer_id
    ORDER BY (j.status = 'open') DESC, j.created_at DESC`);
  return (
    <div className="grid gap-4">
      <PageHeader title="Openings" sub="The jobs companies need filled, and how many places are taken.">
        {can(ctx.role, "joborders:write") && <Link href="/job-orders/new" className="btn btn-primary"><Plus size={16} /> New opening</Link>}
      </PageHeader>
      <div className="card p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<Briefcase size={22} />} title="No openings yet">
            An opening is a job a company needs filled: the role, how many workers, and what a recruit must meet. Add the company first, then the opening.
            <div className="flex gap-2 justify-center mt-3"><Link href="/employers/new" className="btn">Add a company</Link><Link href="/job-orders/new" className="btn btn-primary"><Plus size={16} /> New opening</Link></div>
          </EmptyState>
        ) : (
          <table className="table">
            <thead><tr><th>Role</th><th>Company</th><th>Filled</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td><Link className="link" href={`/job-orders/${j.id}`}>{j.title}</Link><div className="muted text-xs">{j.country}{j.is_sample ? " · sample" : ""}</div></td>
                  <td>{j.company}</td>
                  <td>
                    <div className="progress" style={{ width: 80, height: 6 }}><span style={{ width: `${Math.min(100, (Number(j.filled) / j.quantity) * 100)}%` }} /></div>
                    <span className="text-xs muted">{Number(j.filled)} of {j.quantity}</span>
                  </td>
                  <td><span className={`badge ${j.status === "open" ? "badge-good" : j.status === "pending" ? "badge-warn" : ""}`}>{j.status === "pending" ? "needs approval" : j.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
