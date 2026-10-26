import Link from "next/link";
import { Tabs } from "@/components/shell/Tabs";
import { TABS } from "@/components/shell/tabs-data";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { ActionForm } from "@/components/ActionForm";
import { eraseCandidate, handleDataRequest, updateComplaint } from "@/app/actions/operations";

export default async function Complaints() {
  const ctx = await requireCtx();
  const rows = await withTenant(ctx.tenantId, (tx) => tx`
    SELECT x.*, c.first_name, c.last_name, j.title, e.company
    FROM complaints x JOIN candidates c ON c.id = x.candidate_id
    LEFT JOIN placements p ON p.id = x.placement_id LEFT JOIN job_orders j ON j.id = p.job_order_id LEFT JOIN employers e ON e.id = j.employer_id
    ORDER BY (x.status = 'resolved'), x.created_at DESC LIMIT 200`);
  const requests = await withTenant(ctx.tenantId, (tx) => tx`
    SELECT r.*, c.first_name, c.last_name FROM data_requests r JOIN candidates c ON c.id = r.candidate_id
    ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 30`);
  const write = can(ctx.role, "candidates:write");
  const admin = can(ctx.role, "users:manage");
  return (
    <div className="grid gap-4">
      <Tabs items={TABS.todo} />
      <div>
        <h1 className="h1">Complaints and requests</h1>
        <p className="muted">Raised by workers on the candidate portal or recorded by staff. Every complaint needs an answer.</p>
      </div>
      {rows.map((x) => (
        <div key={x.id} className="card grid gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="h2">{x.subject}</div>
              <div className="muted text-xs">
                <Link className="link" href={`/candidates/${x.candidate_id}`}>{x.first_name} {x.last_name}</Link>
                {x.company ? ` · ${x.title} at ${x.company}` : ""} · via {x.raised_via} · {new Date(x.created_at).toLocaleDateString("en-KE")}
              </div>
            </div>
            <span className={`badge ${x.status === "resolved" ? "badge-good" : x.status === "open" ? "badge-bad" : "badge-warn"}`}>{x.status}</span>
          </div>
          <p className="whitespace-pre-wrap">{x.body}</p>
          {x.resolution && <p className="muted"><b>Resolution:</b> {x.resolution}</p>}
          {write && x.status !== "resolved" && (
            <ActionForm action={updateComplaint.bind(null, x.id)} submit="Update" className="grid sm:grid-cols-[180px_1fr_auto] gap-2 items-end" resetOnSuccess={false}>
              <select name="status" className="select" defaultValue={x.status}><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select>
              <input name="resolution" defaultValue={x.resolution} placeholder="What was done (required to resolve)" className="input" />
            </ActionForm>
          )}
        </div>
      ))}
      {rows.length === 0 && <div className="card muted">No complaints.</div>}

      <div className="card">
        <div className="h2 mb-1">Requests about personal data</div>
        <p className="muted text-xs mb-2">Candidates can ask for a copy of their information or for it to be deleted. Deleting removes their details and documents but keeps the money records, without a name attached.</p>
        {requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] py-2 last:border-0">
            <div>
              <b>{r.first_name} {r.last_name}</b> asked to {r.kind === "delete" ? "delete their information" : "receive a copy of their information"}
              <div className="muted text-xs">{new Date(r.created_at).toLocaleDateString("en-KE")}</div>
            </div>
            {r.status === "open" && admin ? (
              <div className="flex gap-2 flex-wrap">
                {r.kind === "delete" && <ActionForm action={eraseCandidate.bind(null, r.candidate_id)} submit="Delete their information" buttonClass="btn btn-sm btn-danger" className="inline" confirm="Permanently delete this candidate's details and documents? This cannot be undone."><></></ActionForm>}
                {r.kind === "export" && <Link className="btn btn-sm" href={`/export/candidates?from=1900-01-01`}>Open exports</Link>}
                <ActionForm confirm="Mark this request as done? The candidate is told." action={handleDataRequest.bind(null, r.id, "done")} submit="Mark done" buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                <ActionForm confirm="Decline this request? The candidate is told." action={handleDataRequest.bind(null, r.id, "declined")} submit="Decline" buttonClass="btn btn-sm" className="inline"><></></ActionForm>
              </div>
            ) : <span className={`badge ${r.status === "done" ? "badge-good" : r.status === "open" ? "badge-warn" : ""}`}>{r.status}</span>}
          </div>
        ))}
        {requests.length === 0 && <p className="muted">None.</p>}
      </div>
    </div>
  );
}
