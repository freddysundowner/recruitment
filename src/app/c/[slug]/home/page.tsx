import Link from "next/link";
import { withCandidate } from "@/lib/db";
import { requireCandidate } from "@/lib/portal-session";
import { balanceDue } from "@/lib/pipeline";
import { formatMoney } from "@/lib/money";

export default async function Home({ params }: PageProps<"/c/[slug]/home">) {
  const { slug } = await params;
  const { agency, me } = await requireCandidate(slug);
  const d = await withCandidate(agency.id, me.candidateId, async (tx) => {
    const [p] = await tx`
      SELECT p.id, p.outcome, p.close_reason, s.position, s.name AS stage, s.description, s.required_doc_types, j.title, j.country
      FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id LEFT JOIN job_orders j ON j.id = p.job_order_id
      ORDER BY (p.outcome <> 'closed') DESC, p.created_at DESC LIMIT 1`;
    return {
      p,
      stages: await tx`SELECT position, name FROM pipeline_stages ORDER BY position`,
      docs: await tx`SELECT doc_type, status FROM documents`,
      due: p && p.outcome !== "closed" ? await balanceDue(tx, p.id) : 0,
      appts: await tx`SELECT kind, scheduled_at, location FROM appointments WHERE result = 'pending' AND scheduled_at >= now() ORDER BY scheduled_at LIMIT 3`,
      apps: await tx`SELECT count(*) AS n FROM applications WHERE status = 'pending'`,
      msgs: await tx`SELECT body, created_at FROM messages WHERE template <> 'otp' AND status = 'sent' ORDER BY created_at DESC LIMIT 3`,
      notes: await tx`SELECT subject, status FROM complaints WHERE status <> 'resolved'`,
    };
  });
  const { p } = d;
  const todo: { text: string; href?: string }[] = [];
  if (p && p.outcome !== "closed") {
    const have = new Set(d.docs.map((x) => x.doc_type as string));
    const missing = (p.required_doc_types as string[]).filter((t) => !have.has(t));
    if (missing.length) todo.push({ text: `Upload: ${missing.join(", ")}`, href: `/c/${slug}/documents` });
    const pending = d.docs.filter((x) => x.status === "pending").length;
    if (pending) todo.push({ text: `${pending} document${pending > 1 ? "s are" : " is"} waiting for the agency to check` });
    if (d.due > 0) todo.push({ text: `Pay ${formatMoney(d.due)} that is due`, href: `/c/${slug}/payments` });
    if (!p.title) todo.push({ text: "Look at the open jobs and apply for the ones you want", href: `/c/${slug}/jobs` });
  }

  return (
    <>
      <div className="card">
        <h1 className="h1">Hello, {me.name.split(" ")[0]}</h1>
        {!p && <p className="muted mt-1">You have no application yet. Visit the agency or look at the jobs.</p>}
        {p && (
          <div className="mt-2 grid gap-3">
            <div>
              <div className="muted text-xs font-semibold">Your application</div>
              <div className="text-lg font-semibold">{p.outcome === "closed" ? `Closed: ${p.close_reason}` : p.stage}</div>
              <div className="muted">{p.title ? `${p.title}, ${p.country}` : "No job chosen yet"}</div>
              {p.outcome !== "closed" && <p className="mt-1">{p.description}</p>}
            </div>
            {p.outcome !== "closed" && (
              <ol className="flex flex-wrap gap-1.5">
                {d.stages.map((s) => (
                  <li key={s.position} className={`badge ${s.position < p.position ? "badge-good" : s.position === p.position ? "!bg-[var(--brand)] !text-white" : ""}`}>{s.position}. {s.name}</li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>

      {todo.length > 0 && (
        <div className="card">
          <div className="h2 mb-2">What you need to do</div>
          <ul className="grid gap-2">
            {todo.map((t, i) => <li key={i} className="flex items-start gap-2"><span className="badge badge-warn mt-0.5">to do</span>{t.href ? <Link className="link" href={t.href}>{t.text}</Link> : <span>{t.text}</span>}</li>)}
          </ul>
        </div>
      )}

      {d.appts.length > 0 && (
        <div className="card">
          <div className="h2 mb-2">Your appointments</div>
          {d.appts.map((a, i) => (
            <div key={i} className="mb-1"><b>{a.kind}</b> on {new Date(a.scheduled_at).toLocaleString("en-KE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}{a.location ? ` at ${a.location}` : ""}</div>
          ))}
        </div>
      )}

      {d.notes.length > 0 && (
        <div className="card"><div className="h2">Your complaint is being handled</div><Link className="link" href={`/c/${slug}/help`}>See progress</Link></div>
      )}

      {d.msgs.length > 0 && (
        <div className="card">
          <div className="h2 mb-2">Latest messages from the agency</div>
          {d.msgs.map((m, i) => <p key={i} className="mb-2"><span className="muted text-xs">{new Date(m.created_at).toLocaleDateString("en-KE")}</span><br />{m.body}</p>)}
        </div>
      )}
    </>
  );
}
