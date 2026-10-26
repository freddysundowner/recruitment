import Link from "next/link";
import { Briefcase, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";

export default async function JobOrders() {
  const ctx = await requireCtx();
  const rows = await withTenant(ctx.tenantId, (tx) => tx`
    SELECT j.*, e.company, e.vetted,
      (SELECT count(*) FROM placements p WHERE p.job_order_id = j.id AND p.outcome <> 'closed') AS filled
    FROM job_orders j JOIN employers e ON e.id = j.employer_id
    ORDER BY (j.status = 'open') DESC, j.deadline NULLS LAST, j.created_at DESC`);
  return (
    <div className="grid gap-4">
      <PageHeader title="Job orders" sub="What your employers have asked for, and how many places are filled.">
        {can(ctx.role, "joborders:write") && <Link href="/job-orders/new" className="btn btn-primary"><Plus size={16} /> New job order</Link>}
      </PageHeader>
      <div className="card p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<Briefcase size={22} />} title="No job orders yet">
            A job order says what an employer needs: the role, how many workers, and who pays the costs. Add an employer first, then create the job order.
            <div className="flex gap-2 justify-center mt-3"><Link href="/employers/new" className="btn">Add an employer</Link><Link href="/job-orders/new" className="btn btn-primary"><Plus size={16} /> New job order</Link></div>
          </EmptyState>
        ) : (
          <table className="table">
            <thead><tr><th>Role</th><th>Employer</th><th>Filled</th><th>Costs paid by</th><th>Deadline</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td><Link className="link" href={`/job-orders/${j.id}`}>{j.title}</Link><div className="muted text-xs">{j.country}{j.is_sample ? " · sample" : ""}</div></td>
                  <td>{j.company}{!j.vetted && <span className="badge badge-warn ml-2">not vetted</span>}</td>
                  <td>
                    <div className="progress" style={{ width: 80, height: 6 }}><span style={{ width: `${Math.min(100, (Number(j.filled) / j.quantity) * 100)}%` }} /></div>
                    <span className="text-xs muted">{Number(j.filled)} of {j.quantity}</span>
                  </td>
                  <td>{j.payment_model === "employer_paid" ? "Employer" : "Candidate"}</td>
                  <td>{j.deadline ? new Date(j.deadline).toLocaleDateString("en-KE") : "—"}</td>
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
