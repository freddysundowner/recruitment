import Link from "next/link";
import { sql } from "@/lib/db";
import { requirePlatform } from "@/lib/platform";
import { ActionForm } from "@/components/ActionForm";
import { reviewSender } from "@/app/actions/platform";

const fmt = (d: unknown) => new Date(d as string).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });

export default async function Senders() {
  await requirePlatform();
  const rows = await sql`SELECT * FROM platform_senders_list()`;
  const pending = rows.filter((r) => r.status === "pending").length;
  return (
    <>
      <div>
        <h1 className="h1">Sender IDs</h1>
        <p className="muted">Agencies ask to send texts and emails under their own name. Register an SMS sender ID with BlessedTexts, or verify an email address in Brevo, then approve it here. Until then the agency uses your default sender.</p>
      </div>
      {pending > 0 && <div className="notice">{pending} request{pending === 1 ? "" : "s"} waiting.</div>}
      <div className="card p-0 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Agency</th><th>Type</th><th>Sender</th><th>Asked</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link className="link" href={`/platform/tenants/${r.tenant_id}`}>{r.tenant_name}</Link></td>
                <td>{r.kind === "sms" ? "SMS" : "Email"}</td>
                <td className="font-semibold">{r.display_name ? `${r.display_name} <${r.value}>` : r.value}</td>
                <td>{fmt(r.created_at)}</td>
                <td><span className={`badge ${r.status === "approved" ? "badge-good" : r.status === "rejected" ? "badge-bad" : "badge-warn"}`}>{r.status}</span>{r.note && <div className="muted text-xs">{r.note}</div>}</td>
                <td className="text-right whitespace-nowrap">
                  {r.status !== "approved" && <ActionForm confirm="Approve this sender? Make sure it is registered or verified with the provider first." action={reviewSender.bind(null, r.id, "approved")} submit="Approve" buttonClass="btn btn-sm btn-primary" className="inline"><></></ActionForm>}
                  {r.status === "pending" && <ActionForm confirm="Reject this sender?" action={reviewSender.bind(null, r.id, "rejected")} submit="Reject" buttonClass="btn btn-sm btn-danger" className="inline ml-1"><></></ActionForm>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No requests yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
