import Link from "next/link";
import { Plus, Search, Upload, Users } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { blindIndex } from "@/lib/crypto";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function Candidates({ searchParams }: PageProps<"/candidates">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const like = `%${q}%`;

  const rows = await withTenant(ctx.tenantId, (tx) => tx`
    SELECT c.id, c.first_name, c.last_name, c.phone, c.county, c.status, c.source, s.name AS stage, s.position, j.title AS job, e.country,
      (SELECT count(*) FROM documents d WHERE d.candidate_id = c.id AND d.status = 'pending') AS pending_docs,
      (SELECT count(*) FROM documents d WHERE d.candidate_id = c.id AND d.expiry_date < current_date + 60) AS expiring
    FROM candidates c
    LEFT JOIN placements p ON p.candidate_id = c.id AND p.outcome <> 'closed'
    LEFT JOIN pipeline_stages s ON s.id = p.stage_id
    LEFT JOIN job_orders j ON j.id = p.job_order_id
    LEFT JOIN employers e ON e.id = j.employer_id
    WHERE c.status <> 'inactive' AND ${q === "" ? tx`true` : tx`(c.first_name || ' ' || c.last_name ILIKE ${like} OR c.phone ILIKE ${like} OR c.id_number_idx = ${blindIndex(q)})`}
    ORDER BY c.created_at DESC LIMIT 200`);
  const write = can(ctx.role, "candidates:write");

  return (
    <>
      <PageHeader title="Candidates" sub={q ? `${rows.length} result${rows.length === 1 ? "" : "s"} for “${q}”` : `${rows.length} ${rows.length === 1 ? "person" : "people"} registered`}>
        {write && <Link href="/candidates/import" className="btn"><Upload size={16} /> Import CSV</Link>}
        {write && <Link href="/candidates/new" className="btn btn-primary"><Plus size={16} /> Add candidate</Link>}
      </PageHeader>

      <form className="flex gap-2 max-w-lg">
        <div className="search" style={{ maxWidth: "none" }}>
          <Search size={16} />
          <input name="q" defaultValue={q} placeholder="Search name, phone or exact ID number" className="input" />
        </div>
        <button className="btn">Search</button>
        {q && <Link href="/candidates" className="btn btn-ghost">Clear</Link>}
      </form>

      <div className="card p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<Users size={22} />} title={q ? "No one matches that search" : "No candidates yet"}>
            {q ? "Check the spelling, or search by phone number." : "Add your first candidate, or import your existing records from a spreadsheet."}
            {!q && write && (
              <div className="flex gap-2 justify-center mt-3">
                <Link href="/candidates/new" className="btn btn-primary"><Plus size={16} /> Add candidate</Link>
                <Link href="/candidates/import" className="btn"><Upload size={16} /> Import CSV</Link>
              </div>
            )}
          </EmptyState>
        ) : (
          <>
          <div className="m-list">
            {rows.map((r) => (
              <Link key={r.id} href={`/candidates/${r.id}`} className="m-row">
                <span className="avatar" style={{ width: 40, height: 40 }}>{`${r.first_name[0]}${r.last_name[0]}`}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-[var(--ink)] truncate">{r.first_name} {r.last_name}</span>
                  <span className="block text-xs muted truncate">{r.job ?? "Not matched yet"}{r.country ? ` · ${r.country}` : ""}</span>
                  <span className="flex flex-wrap gap-1 mt-1">
                    {r.stage ? <span className="badge badge-brand">{r.position}. {r.stage}</span> : <span className="badge">{r.status}</span>}
                    {Number(r.pending_docs) > 0 && <span className="badge badge-warn">{r.pending_docs} to verify</span>}
                    {Number(r.expiring) > 0 && <span className="badge badge-bad">{r.expiring} expiring</span>}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          <table className="table d-table">
            <thead><tr><th>Candidate</th><th>Stage</th><th>Job</th><th>Alerts</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/candidates/${r.id}`} className="flex items-center gap-3">
                      <span className="avatar">{`${r.first_name[0]}${r.last_name[0]}`}</span>
                      <span>
                        <span className="block font-semibold text-[var(--ink)]">{r.first_name} {r.last_name}{r.source === "sample" && <span className="badge badge-info ml-2">sample</span>}</span>
                        <span className="block text-xs muted">{r.phone}{r.county ? ` · ${r.county}` : ""}</span>
                      </span>
                    </Link>
                  </td>
                  <td>{r.stage ? <span className="badge badge-brand">{r.position}. {r.stage}</span> : <span className="badge">{r.status}</span>}</td>
                  <td>{r.job ?? <span className="muted">Not matched yet</span>}{r.country && <div className="muted text-xs">{r.country}</div>}</td>
                  <td className="space-x-1">
                    {Number(r.pending_docs) > 0 && <span className="badge badge-warn">{r.pending_docs} to verify</span>}
                    {Number(r.expiring) > 0 && <span className="badge badge-bad">{r.expiring} expiring</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>
    </>
  );
}
