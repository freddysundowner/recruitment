import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { ActionForm } from "@/components/ActionForm";
import { reviewDocument } from "@/app/actions/candidates";

export default async function Verify() {
  const ctx = await requirePageCan("documents:verify");
  const rows = await withTenant(ctx.tenantId, (tx) => tx`
    SELECT d.id, d.doc_type, d.expiry_date, d.file_name, d.file_key, d.created_at, c.id AS cid, c.first_name, c.last_name
    FROM documents d JOIN candidates c ON c.id = d.candidate_id WHERE d.status = 'pending' ORDER BY d.created_at LIMIT 100`);
  return (
    <div className="grid gap-4">
      <PageHeader title="Documents to verify" sub="Open each document, check it against the candidate, then verify or reject it." />
      <div className="card p-0 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Candidate</th><th>Document</th><th>Expires</th><th>Sent</th><th></th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td><Link className="link" href={`/candidates/${d.cid}`}>{d.first_name} {d.last_name}</Link></td>
                <td>{d.doc_type}<div className="muted text-xs">{d.file_name}</div></td>
                <td>{d.expiry_date ? new Date(d.expiry_date).toLocaleDateString("en-KE") : "—"}</td>
                <td>{new Date(d.created_at).toLocaleDateString("en-KE")}</td>
                <td className="text-right whitespace-nowrap">
                  {d.file_key !== "seed/none" && <a className="link mr-3" href={`/files/${d.id}`} target="_blank">View</a>}
                  <span className="inline-flex gap-1">
                    <ActionForm action={reviewDocument.bind(null, d.id, d.cid, "verified")} submit="Verify" buttonClass="btn btn-sm btn-primary" className="inline"><></></ActionForm>
                    <ActionForm confirm="Reject this document? The candidate will be asked to send a new one." action={reviewDocument.bind(null, d.id, d.cid, "rejected")} submit="Reject" buttonClass="btn btn-sm btn-danger" className="inline"><></></ActionForm>
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Nothing is waiting.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
