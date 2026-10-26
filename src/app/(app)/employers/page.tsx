import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";

export default async function Companies() {
  const ctx = await requireCtx();
  const rows = await withTenant(ctx.tenantId, (tx) => tx`
    SELECT e.*, (SELECT count(*) FROM job_orders j WHERE j.employer_id = e.id AND j.status = 'open') AS open_jobs
    FROM employers e ORDER BY e.company`);
  return (
    <div className="grid gap-4">
      <PageHeader title="Companies" sub="The companies that need workers. Record them here, then add their openings.">
        {can(ctx.role, "employers:write") && <Link href="/employers/new" className="btn btn-primary"><Plus size={16} /> Add company</Link>}
      </PageHeader>
      <div className="card p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<Building2 size={22} />} title="No companies yet">
            Add the first company that needs workers. It only takes a name and a country.
            <div className="mt-3"><Link href="/employers/new" className="btn btn-primary"><Plus size={16} /> Add company</Link></div>
          </EmptyState>
        ) : (
          <table className="table">
            <thead><tr><th>Company</th><th>Contact</th><th>Phone</th><th>Open openings</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><Link className="link" href={`/employers/${e.id}`}>{e.company}</Link><div className="muted text-xs">{e.country}{e.is_sample ? " · sample" : ""}</div></td>
                  <td>{e.contact_name}<div className="muted text-xs">{e.email}</div></td>
                  <td>{e.phone}</td>
                  <td>{Number(e.open_jobs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
