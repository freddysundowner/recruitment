import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { decrypt, mask } from "@/lib/crypto";
import { DOC_TYPES } from "@/lib/stages";
import { ActionForm } from "@/components/ActionForm";
import { CandidateFields } from "@/components/CandidateFields";
import { assignJobOrder, reopenCandidate } from "@/app/actions/placements";
import { reviewDocument, updateCandidate, uploadDocument } from "@/app/actions/candidates";
import { addComplaint } from "@/app/actions/operations";

const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-KE") : "—");

export default async function Candidate({ params }: PageProps<"/candidates/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const data = await withTenant(ctx.tenantId, async (tx) => {
    const [c] = await tx`SELECT * FROM candidates WHERE id = ${id}`;
    if (!c) return null;
    return {
      c,
      docs: await tx`SELECT *, (expiry_date - current_date) AS days FROM documents WHERE candidate_id = ${id} ORDER BY created_at DESC`,
      placements: await tx`
        SELECT p.*, s.name AS stage, j.title, e.company FROM placements p
        JOIN pipeline_stages s ON s.id = p.stage_id
        LEFT JOIN job_orders j ON j.id = p.job_order_id LEFT JOIN employers e ON e.id = j.employer_id
        WHERE p.candidate_id = ${id} ORDER BY p.created_at DESC`,
      complaints: await tx`SELECT * FROM complaints WHERE candidate_id = ${id} ORDER BY created_at DESC`,
      messages: await tx`SELECT channel, status, template, left(body, 120) AS body, created_at FROM messages WHERE candidate_id = ${id} ORDER BY created_at DESC LIMIT 8`,
      jobs: await tx`
        SELECT j.id, j.title, j.country, j.quantity, e.company, e.vetted,
          (SELECT count(*) FROM placements p WHERE p.job_order_id = j.id AND p.outcome <> 'closed') AS filled
        FROM job_orders j JOIN employers e ON e.id = j.employer_id WHERE j.status = 'open' ORDER BY e.company, j.title`,
    };
  });
  if (!data) notFound();
  const { c, docs, placements, jobs, complaints, messages } = data;
  const live = placements.find((p) => p.outcome !== "closed");
  const writeC = can(ctx.role, "candidates:write");
  const writeD = can(ctx.role, "documents:write");
  const verify = can(ctx.role, "documents:verify");
  const move = can(ctx.role, "pipeline:move");

  return (
    <div className="grid gap-4">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <span className="avatar" style={{ width: 48, height: 48, fontSize: 16 }}>{`${c.first_name[0]}${c.last_name[0]}`}</span>
          <div>
            <h1 className="h1">{c.first_name} {c.last_name}</h1>
            <div className="muted flex items-center gap-2 flex-wrap">{c.phone}{c.county ? ` · ${c.county}` : ""}<span className={`badge ${c.status === "placed" ? "badge-good" : ""}`}>{c.status}</span>{c.source === "sample" && <span className="badge badge-info">sample</span>}</div>
          </div>
        </div>
        <Link href="/candidates" className="btn btn-ghost">Back to candidates</Link>
      </div>

      <div id="placement" className="card" style={{ scrollMarginTop: 80 }}>
        <div className="h2 mb-2">Placement</div>
        {live ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="badge badge-brand">{live.stage}</span>
              <span>{live.title ? `${live.title} · ${live.company}` : "No job order assigned yet"}</span>
              <Link className="link" href={`/placements/${live.id}`}>Open placement</Link>
            </div>
            {!live.job_order_id && move && (
              <ActionForm action={assignJobOrder.bind(null, live.id)} submit="Assign job order" className="flex flex-wrap items-end gap-2" buttonClass="btn btn-primary">
                <div className="min-w-64">
                  <label className="label" htmlFor="job_order_id">Match to a job order</label>
                  <select id="job_order_id" name="job_order_id" className="select" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id} disabled={Number(j.filled) >= j.quantity}>
                        {j.title} · {j.company} ({Number(j.filled)}/{j.quantity}){j.vetted ? "" : " · not vetted"}
                      </option>
                    ))}
                  </select>
                </div>
              </ActionForm>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="muted">Not in the pipeline.</span>
            {move && <ActionForm action={reopenCandidate.bind(null, c.id)} submit="Re-enter pipeline" buttonClass="btn btn-sm" className=""><></></ActionForm>}
          </div>
        )}
        {placements.filter((p) => p.outcome === "closed").length > 0 && (
          <div className="mt-3 muted text-xs">
            Past: {placements.filter((p) => p.outcome === "closed").map((p) => `${p.title ?? "no job"} (${p.close_reason})`).join("; ")}
          </div>
        )}
      </div>

      <div id="documents" className="card" style={{ scrollMarginTop: 80 }}>
        <div className="h2 mb-2">Documents</div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Type</th><th>Number</th><th>Expires</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.doc_type}<div className="muted text-xs">{d.file_name}</div></td>
                  <td>{mask(d.doc_number_enc ? decrypt(d.doc_number_enc) : null)}</td>
                  <td>
                    {fmt(d.expiry_date)}
                    {d.days !== null && Number(d.days) < 60 && (
                      <span className={`badge ml-2 ${Number(d.days) < 0 ? "badge-bad" : "badge-warn"}`}>{Number(d.days) < 0 ? "expired" : `${d.days}d`}</span>
                    )}
                  </td>
                  <td><span className={`badge ${d.status === "verified" ? "badge-good" : d.status === "rejected" ? "badge-bad" : "badge-warn"}`}>{d.status}</span></td>
                  <td className="text-right whitespace-nowrap">
                    {d.file_key !== "seed/none" && <a className="link mr-3" href={`/files/${d.id}`} target="_blank">View</a>}
                    {verify && d.status !== "verified" && (
                      <ActionForm action={reviewDocument.bind(null, d.id, c.id, "verified")} submit="Verify" buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                    )}
                    {verify && d.status === "pending" && (
                      <ActionForm action={reviewDocument.bind(null, d.id, c.id, "rejected")} submit="Reject" buttonClass="btn btn-sm btn-danger" className="inline ml-1"><></></ActionForm>
                    )}
                  </td>
                </tr>
              ))}
              {docs.length === 0 && <tr><td colSpan={5} className="muted">No documents uploaded yet. Upload the passport and ID first.</td></tr>}
            </tbody>
          </table>
        </div>
        {writeD && (
          <ActionForm action={uploadDocument.bind(null, c.id)} submit="Upload document" className="grid gap-3 mt-4 pt-4 border-t border-[var(--line)]">
            <div className="grid sm:grid-cols-4 gap-3">
              <div>
                <label className="label" htmlFor="doc_type">Type</label>
                <select id="doc_type" name="doc_type" className="select" required>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              </div>
              <div><label className="label" htmlFor="doc_number">Number</label><input id="doc_number" name="doc_number" className="input" /></div>
              <div><label className="label" htmlFor="issue_date">Issued</label><input id="issue_date" name="issue_date" type="date" className="input" /></div>
              <div><label className="label" htmlFor="expiry_date">Expires</label><input id="expiry_date" name="expiry_date" type="date" className="input" /></div>
            </div>
            <div><label className="label" htmlFor="file">File (PDF, JPG or PNG, up to 8 MB)</label><input id="file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required className="input" /></div>
          </ActionForm>
        )}
      </div>

      <div className="card">
        <div className="h2 mb-2">Messages sent</div>
        <table className="table"><tbody>
          {messages.map((m, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap">{new Date(m.created_at).toLocaleDateString("en-KE")}</td>
              <td><span className="badge">{m.channel}</span></td>
              <td>{m.body}</td>
              <td><span className={`badge ${m.status === "sent" ? "badge-good" : m.status === "failed" ? "badge-bad" : ""}`}>{m.status}</span></td>
            </tr>
          ))}
          {messages.length === 0 && <tr><td className="muted">No messages yet.</td></tr>}
        </tbody></table>
      </div>

      <div className="card">
        <div className="h2 mb-2">Complaints</div>
        {complaints.map((x) => (
          <div key={x.id} className="mb-2"><span className={`badge ${x.status === "resolved" ? "badge-good" : "badge-bad"} mr-2`}>{x.status}</span><b>{x.subject}</b><div className="muted text-xs">{x.body}</div></div>
        ))}
        {complaints.length === 0 && <p className="muted">None.</p>}
        {writeC && (
          <details className="mt-2">
            <summary className="link cursor-pointer">Record a complaint on their behalf</summary>
            <ActionForm action={addComplaint.bind(null, c.id)} submit="Record complaint" className="grid gap-3 mt-2">
              <div><label className="label" htmlFor="subject">Subject</label><input id="subject" name="subject" required className="input" /></div>
              <div><label className="label" htmlFor="body">What happened</label><textarea id="body" name="body" rows={3} required className="textarea" /></div>
            </ActionForm>
          </details>
        )}
      </div>

      {writeC && (
        <details className="card">
          <summary className="h2 cursor-pointer">Edit profile</summary>
          <ActionForm action={updateCandidate.bind(null, c.id)} submit="Save changes" resetOnSuccess={false} className="grid gap-3 mt-3">
            <CandidateFields v={{ ...c, id_number: c.id_number_enc ? decrypt(c.id_number_enc) : "", dob: c.dob ? new Date(c.dob).toISOString().slice(0, 10) : "" }} />
          </ActionForm>
        </details>
      )}
    </div>
  );
}
