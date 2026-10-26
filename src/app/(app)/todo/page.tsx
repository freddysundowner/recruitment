import Link from "next/link";
import { Tabs } from "@/components/shell/Tabs";
import { TABS } from "@/components/shell/tabs-data";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

const SHOW = 6;
const STUCK_DAYS = 14;
const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-KE", { day: "numeric", month: "short" });

type Row = { key: string; who: string; what: string; href: string; tone?: "bad" | "warn" };
type Group = { id: string; title: string; hint: string; count: number; rows: Row[]; all: string; allLabel: string };

/**
 * Everything waiting for someone, in one list: documents to check, people who are overdue a call, complaints,
 * applicants and candidates who have been stuck. Each row goes straight to the person it is about.
 */
export default async function Todo() {
  const ctx = await requireCtx();
  const verify = can(ctx.role, "documents:verify");
  const admin = can(ctx.role, "users:manage");

  const d = await withTenant(ctx.tenantId, async (tx) => ({
    docs: verify ? await tx`
      SELECT d.doc_type, d.created_at, c.id AS cid, c.first_name, c.last_name,
             (SELECT count(*) FROM documents WHERE status = 'pending')::int AS total
      FROM documents d JOIN candidates c ON c.id = d.candidate_id WHERE d.status = 'pending' ORDER BY d.created_at LIMIT ${SHOW}` : [],
    checkins: await tx`
      SELECT k.due_on, (current_date - k.due_on) AS late, c.id AS cid, c.first_name, c.last_name,
             (SELECT count(*) FROM checkins x JOIN placements q ON q.id = x.placement_id WHERE x.done_on IS NULL AND x.due_on <= current_date AND q.outcome <> 'closed')::int AS total
      FROM checkins k JOIN placements p ON p.id = k.placement_id JOIN candidates c ON c.id = p.candidate_id
      WHERE k.done_on IS NULL AND k.due_on <= current_date AND p.outcome <> 'closed' ORDER BY k.due_on LIMIT ${SHOW}`,
    appts: await tx`
      SELECT a.kind, a.scheduled_at, c.id AS cid, c.first_name, c.last_name,
             (SELECT count(*) FROM appointments WHERE result = 'pending' AND scheduled_at BETWEEN now() - interval '1 day' AND now() + interval '7 days')::int AS total
      FROM appointments a JOIN placements p ON p.id = a.placement_id JOIN candidates c ON c.id = p.candidate_id
      WHERE a.result = 'pending' AND a.scheduled_at BETWEEN now() - interval '1 day' AND now() + interval '7 days' ORDER BY a.scheduled_at LIMIT ${SHOW}`,
    complaints: await tx`
      SELECT x.subject, x.status, x.created_at, c.id AS cid, c.first_name, c.last_name,
             (SELECT count(*) FROM complaints WHERE status <> 'resolved')::int AS total
      FROM complaints x JOIN candidates c ON c.id = x.candidate_id WHERE x.status <> 'resolved' ORDER BY x.created_at LIMIT ${SHOW}`,
    apps: await tx`
      SELECT j.id AS jid, j.title, c.id AS cid, c.first_name, c.last_name,
             (SELECT count(*) FROM applications WHERE status = 'pending')::int AS total
      FROM applications a JOIN candidates c ON c.id = a.candidate_id JOIN job_orders j ON j.id = a.job_order_id
      WHERE a.status = 'pending' ORDER BY a.created_at LIMIT ${SHOW}`,
    stuck: await tx`
      WITH w AS (
        SELECT p.id, c.id AS cid, c.first_name, c.last_name, s.name AS stage,
               (current_date - COALESCE((SELECT max(h.created_at) FROM stage_history h WHERE h.placement_id = p.id AND h.to_stage_id = p.stage_id), p.created_at)::date) AS days
        FROM placements p JOIN candidates c ON c.id = p.candidate_id JOIN pipeline_stages s ON s.id = p.stage_id
        WHERE p.outcome = 'active' AND s.position < 8)
      SELECT *, (SELECT count(*) FROM w WHERE days >= ${STUCK_DAYS})::int AS total FROM w WHERE days >= ${STUCK_DAYS} ORDER BY days DESC LIMIT ${SHOW}`,
    requests: admin ? await tx`
      SELECT r.kind, c.id AS cid, c.first_name, c.last_name, (SELECT count(*) FROM data_requests WHERE status = 'open')::int AS total
      FROM data_requests r JOIN candidates c ON c.id = r.candidate_id WHERE r.status = 'open' ORDER BY r.created_at LIMIT ${SHOW}` : [],
    failed: ctx.role !== "finance" ? (await tx`SELECT count(*)::int AS n FROM messages WHERE status = 'failed'`)[0].n as number : 0,
  }));

  const name = (r: Record<string, unknown>) => `${r.first_name} ${r.last_name}`;
  const total = (rows: readonly unknown[]) => Number((rows[0] as { total?: number } | undefined)?.total ?? 0);

  const groups = ([
    {
      id: "docs", title: "Documents to check", hint: "Compare each with the candidate, then verify or reject it.", count: total(d.docs), all: "/verify", allLabel: "Check them all",
      rows: d.docs.map((r) => ({ key: r.cid + r.doc_type, who: name(r), what: `${r.doc_type}, sent ${dt(r.created_at)}`, href: `/candidates/${r.cid}#documents` })),
    },
    {
      id: "apps", title: "Applicants to answer", hint: "Candidates who applied for a job on their portal.", count: total(d.apps), all: "/job-orders", allLabel: "See job orders",
      rows: d.apps.map((r) => ({ key: r.cid + r.jid, who: name(r), what: `applied for ${r.title}`, href: `/job-orders/${r.jid}` })),
    },
    {
      id: "checkins", title: "Check-ins due", hint: "Workers abroad who are due a call.", count: total(d.checkins), all: "/follow-up", allLabel: "See follow-up",
      rows: d.checkins.map((r) => ({ key: r.cid + r.due_on, who: name(r), what: Number(r.late) > 0 ? `${r.late} day${Number(r.late) === 1 ? "" : "s"} overdue` : "due today", href: `/candidates/${r.cid}#followup`, tone: Number(r.late) > 7 ? "bad" : "warn" })),
    },
    {
      id: "appts", title: "Appointments this week", hint: "Interviews, medicals and embassy visits coming up.", count: total(d.appts), all: "/follow-up", allLabel: "See follow-up",
      rows: d.appts.map((r) => ({ key: r.cid + r.scheduled_at, who: name(r), what: `${r.kind}, ${dt(r.scheduled_at)}`, href: `/candidates/${r.cid}#appointments` })),
    },
    {
      id: "complaints", title: "Open complaints", hint: "Every complaint needs an answer.", count: total(d.complaints), all: "/complaints", allLabel: "Open complaints",
      rows: d.complaints.map((r) => ({ key: r.cid + r.subject, who: name(r), what: r.subject, href: "/complaints", tone: "bad" })),
    },
    {
      id: "stuck", title: `Waiting ${STUCK_DAYS}+ days`, hint: "Candidates who have not moved for a while.", count: total(d.stuck), all: "/pipeline?view=list&show=stuck", allLabel: "See them all",
      rows: d.stuck.map((r) => ({ key: r.id, who: name(r), what: `${r.days} days in ${r.stage}`, href: `/candidates/${r.cid}`, tone: Number(r.days) >= 30 ? "bad" : "warn" })),
    },
    {
      id: "requests", title: "Privacy requests", hint: "Candidates asking for their data or its deletion.", count: total(d.requests), all: "/complaints", allLabel: "Open requests",
      rows: d.requests.map((r) => ({ key: r.cid + r.kind, who: name(r), what: r.kind === "delete" ? "wants their information deleted" : "wants a copy of their data", href: "/complaints" })),
    },
  ] as Group[]).filter((g) => g.count > 0);

  const sum = groups.reduce((s, g) => s + g.count, 0) + d.failed;

  return (
    <div className="grid gap-4">
      <Tabs items={TABS.todo} />
      <PageHeader title="To do" sub={sum ? `${sum} thing${sum === 1 ? "" : "s"} waiting for you. Start at the top.` : "Nothing is waiting for you."} />

      {sum === 0 && (
        <div className="card">
          <EmptyState icon={<CheckCircle2 size={22} />} title="You are all caught up">
            New documents, due check-ins, complaints and applicants will show up here as they happen.
          </EmptyState>
          <div className="flex justify-center gap-2 flex-wrap pb-4">
            <Link className="btn btn-primary" href="/candidates/new">Register a candidate</Link>
            <Link className="btn" href="/pipeline">Open the pipeline</Link>
          </div>
        </div>
      )}

      {d.failed > 0 && (
        <div className="notice flex items-center justify-between gap-3 flex-wrap">
          <span>{d.failed} message{d.failed === 1 ? "" : "s"} could not be sent.</span>
          <Link className="underline font-semibold" href="/messages">See what failed</Link>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.id} className="card" style={{ padding: 0 }}>
          <div className="flex items-start justify-between gap-3 flex-wrap p-4 pb-2">
            <div>
              <div className="h2 flex items-center gap-2">{g.title} <span className={`badge ${g.id === "complaints" ? "badge-bad" : "badge-warn"}`}>{g.count}</span></div>
              <div className="muted text-xs">{g.hint}</div>
            </div>
            <Link className="btn btn-sm" href={g.all}>{g.allLabel} <ArrowRight size={14} /></Link>
          </div>
          <ul>
            {g.rows.map((r) => (
              <li key={r.key} className="border-t border-[var(--line)]">
                <Link href={r.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--brand-soft)]">
                  <span className="font-semibold">{r.who}</span>
                  <span className={`flex-1 min-w-0 truncate ${r.tone === "bad" ? "text-[var(--bad)]" : "muted"}`}>{r.what}</span>
                  <ArrowRight size={14} className="muted" />
                </Link>
              </li>
            ))}
          </ul>
          {g.count > g.rows.length && <div className="muted text-xs px-4 py-2 border-t border-[var(--line)]">and {g.count - g.rows.length} more</div>}
        </div>
      ))}
    </div>
  );
}
