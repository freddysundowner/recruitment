import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { decrypt, mask } from "@/lib/crypto";
import { loadGuide } from "@/lib/guide";
import { CLOSE_REASONS, DOC_TYPES } from "@/lib/stages";
import { placementDocItems, placementFit } from "@/lib/requirements";
import { ReqRow } from "@/components/placement/ReqRow";
import { ActionForm } from "@/components/ActionForm";
import { CandidateFields } from "@/components/CandidateFields";
import { OpenOnHash } from "@/components/OpenOnHash";
import { GuidedPanel } from "@/components/placement/GuidedPanel";
import { Operations } from "@/components/placement/Operations";
import { Money } from "@/components/placement/Money";
import { Section } from "@/components/ui/Section";
import { closePlacement, moveStageAction } from "@/app/actions/placements";
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
    const [live] = await tx`
      SELECT p.id, p.payment_model, p.outcome, c.phone AS cphone, s.position, s.required_doc_types,
             j.title, j.country, j.placement_fee_minor, j.fee_currency, e.company, e.currency AS employer_currency, e.vetted
      FROM placements p JOIN candidates c ON c.id = p.candidate_id JOIN pipeline_stages s ON s.id = p.stage_id
      LEFT JOIN job_orders j ON j.id = p.job_order_id LEFT JOIN employers e ON e.id = j.employer_id
      WHERE p.candidate_id = ${id} AND p.outcome <> 'closed' ORDER BY p.created_at DESC LIMIT 1`;
    return {
      c,
      live,
      docs: await tx`SELECT *, (expiry_date - current_date) AS days FROM documents WHERE candidate_id = ${id} ORDER BY created_at DESC`,
      closed: await tx`SELECT p.close_reason, j.title FROM placements p LEFT JOIN job_orders j ON j.id = p.job_order_id WHERE p.candidate_id = ${id} AND p.outcome = 'closed' ORDER BY p.created_at DESC`,
      history: live ? await tx`
        SELECT h.*, f.name AS from_name, t.name AS to_name, u.name AS who
        FROM stage_history h LEFT JOIN pipeline_stages f ON f.id = h.from_stage_id
        LEFT JOIN pipeline_stages t ON t.id = h.to_stage_id LEFT JOIN users u ON u.id = h.user_id
        WHERE h.placement_id = ${live.id} ORDER BY h.created_at DESC` : [],
      stages: await tx`SELECT id, position, name FROM pipeline_stages ORDER BY position`,
      complaints: await tx`SELECT * FROM complaints WHERE candidate_id = ${id} ORDER BY created_at DESC`,
      messages: await tx`SELECT channel, status, template, left(body, 120) AS body, created_at FROM messages WHERE candidate_id = ${id} ORDER BY created_at DESC LIMIT 8`,
      jobs: await tx`
        SELECT j.id, j.title, j.country, j.quantity, e.company, e.vetted,
          (SELECT count(*) FROM placements p WHERE p.job_order_id = j.id AND p.outcome <> 'closed')::int AS filled
        FROM job_orders j JOIN employers e ON e.id = j.employer_id WHERE j.status = 'open' ORDER BY e.company, j.title`,
    };
  });
  if (!data) notFound();
  const { c, live, docs, closed, history, stages, jobs, complaints, messages } = data;

  const writeC = can(ctx.role, "candidates:write");
  const writeD = can(ctx.role, "documents:write");
  const verify = can(ctx.role, "documents:verify");
  const move = can(ctx.role, "pipeline:move");
  const money = can(ctx.role, "finance:read");
  const writeMoney = can(ctx.role, "finance:write");
  const admin = can(ctx.role, "pipeline:override");

  const guide = live ? await loadGuide(ctx.tenantId, live.id) : null;
  const focus = guide ? guide.items.filter((i) => !i.done && i.anchor).map((i) => i.anchor as string) : [];
  const pos = guide?.cur.position ?? 0;
  const reqItems = live?.title ? await withTenant(ctx.tenantId, async (tx) => [...(await placementFit(tx, live.id)), ...(await placementDocItems(tx, live.id))]) : [];
  const reqMet = reqItems.filter((i) => i.done).length;

  const pending = docs.filter((d) => d.status === "pending").length;
  const verified = docs.filter((d) => d.status === "verified").length;

  return (
    <div className="grid gap-4">
      <OpenOnHash />
      <div className="page-header">
        <div className="flex items-center gap-3">
          <span className="avatar" style={{ width: 48, height: 48, fontSize: 16 }}>{`${c.first_name[0]}${c.last_name[0]}`}</span>
          <div>
            <h1 className="h1">{c.first_name} {c.last_name}</h1>
            <div className="muted flex items-center gap-2 flex-wrap">
              {c.phone}{c.county ? ` · ${c.county}` : ""}
              <span className={`badge ${c.status === "placed" ? "badge-good" : ""}`}>{c.status}</span>
              {c.source === "sample" && <span className="badge badge-info">sample</span>}
            </div>
            {live?.title && (
              <div className="muted mt-0.5">
                {live.title} · {live.company} · {live.country}
              </div>
            )}
          </div>
        </div>
        <Link href="/candidates" className="btn btn-ghost">Back to recruits</Link>
      </div>

      <GuidedPanel candidateId={c.id} guide={guide} canMove={move} jobs={jobs as never} />

      {reqItems.length > 0 && live && (
        <Section id="requirements" title={`What ${live.title} needs`} status={`${reqMet} of ${reqItems.length} met`} tone={reqMet === reqItems.length ? "good" : "warn"} open={reqMet < reqItems.length}>
          <ul>{reqItems.map((i) => <ReqRow key={i.key} item={i} placementId={live.id} canEdit={move} />)}</ul>
        </Section>
      )}

      <Section id="documents" title="Documents" status={docs.length === 0 ? "none yet" : pending ? `${pending} waiting to be checked` : `${verified} verified`} tone={pending ? "warn" : verified ? "good" : undefined} open={focus.includes("#documents") || pos <= 2}>
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
                      <ActionForm confirm="Reject this document? The candidate will be asked to send a new one." action={reviewDocument.bind(null, d.id, c.id, "rejected")} submit="Reject" buttonClass="btn btn-sm btn-danger" className="inline ml-1"><></></ActionForm>
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
      </Section>

      {live && (
        <Operations placementId={live.id} tenantId={ctx.tenantId} canEdit={move} pos={pos} focus={focus} />
      )}

      {live && money && (
        <Money
          p={{ id: live.id, payment_model: live.payment_model, cphone: live.cphone, placement_fee_minor: live.placement_fee_minor, fee_currency: live.fee_currency, employer_currency: live.employer_currency }}
          tenantId={ctx.tenantId}
          canWrite={writeMoney}
          open={focus.includes("#money")}
        />
      )}

      <Section id="messages" title="Messages sent" status={messages.length ? String(messages.length) : "none"}>
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
      </Section>

      <Section id="complaints" title="Complaints" status={complaints.length ? `${complaints.filter((x) => x.status !== "resolved").length} open` : "none"} tone={complaints.some((x) => x.status !== "resolved") ? "bad" : undefined}>
        {complaints.map((x) => (
          <div key={x.id} className="mb-2"><span className={`badge ${x.status === "resolved" ? "badge-good" : "badge-bad"} mr-2`}>{x.status}</span><b>{x.subject}</b><div className="muted text-xs">{x.body}</div></div>
        ))}
        {complaints.length === 0 && <p className="muted">None.</p>}
        {writeC && (
          <ActionForm action={addComplaint.bind(null, c.id)} submit="Record complaint" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
            <div className="h2">Record a complaint on their behalf</div>
            <div><label className="label" htmlFor="subject">Subject</label><input id="subject" name="subject" required className="input" /></div>
            <div><label className="label" htmlFor="body">What happened</label><textarea id="body" name="body" rows={3} required className="textarea" /></div>
          </ActionForm>
        )}
      </Section>

      {live && (
        <Section id="history" title="Stage history" status={`${history.length} change${history.length === 1 ? "" : "s"}`}>
          <table className="table">
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap">{new Date(h.created_at).toLocaleString("en-KE")}</td>
                  <td>{h.from_name ? `${h.from_name} → ` : ""}{h.to_name}{h.override && <span className="badge badge-warn ml-2">override</span>}</td>
                  <td>{h.who}</td>
                  <td className="muted">{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {closed.length > 0 && <div className="mt-3 muted text-xs">Past: {closed.map((p) => `${p.title ?? "no job"} (${p.close_reason})`).join("; ")}</div>}
        </Section>
      )}

      {writeC && (
        <Section id="profile" title="Edit profile">
          <ActionForm action={updateCandidate.bind(null, c.id)} submit="Save changes" resetOnSuccess={false} className="grid gap-3">
            <CandidateFields v={{ ...c, id_number: c.id_number_enc ? decrypt(c.id_number_enc) : "", dob: c.dob ? new Date(c.dob).toISOString().slice(0, 10) : "" }} />
          </ActionForm>
        </Section>
      )}

      {live && move && guide && (
        <Section id="advanced" title="Move to another stage, or close" status="advanced">
          <ActionForm confirm="Move this candidate to the chosen stage? The candidate and the employer may be messaged automatically." action={moveStageAction.bind(null, live.id)} submit="Move" className="grid gap-3 sm:grid-cols-[220px_1fr_auto] items-end">
            <div>
              <label className="label" htmlFor="stage_id">Move to</label>
              <select id="stage_id" name="stage_id" className="select" defaultValue="">
                <option value="" disabled>Choose a stage…</option>
                {stages.filter((s) => s.position !== pos).map((s) => <option key={s.id} value={s.id}>{s.position}. {s.name}</option>)}
              </select>
            </div>
            <div><label className="label" htmlFor="note">Note (required to override)</label><input id="note" name="note" className="input" /></div>
            {admin && <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="override" /> Override gates</label>}
          </ActionForm>
          <ActionForm action={closePlacement.bind(null, live.id)} submit="Close placement" buttonClass="btn btn-danger" className="grid gap-3 mt-5 pt-4 border-t border-[var(--line)] max-w-lg" confirm="Close this placement? Costs stay on the ledger.">
            <div className="h2">Close this placement</div>
            <div><label className="label" htmlFor="reason">Reason</label><select id="reason" name="reason" className="select">{CLOSE_REASONS.map((r) => <option key={r}>{r}</option>)}</select></div>
            <div><label className="label" htmlFor="close_note">Note</label><input id="close_note" name="note" className="input" /></div>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
