import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Briefcase, CalendarClock, CheckCircle2, ChevronRight, CircleDashed, FileClock, Globe2, MessageSquareWarning,
  PlaneTakeoff, Plus, UserPlus, Users, Wallet,
} from "lucide-react";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { formatMoney } from "@/lib/money";
import { getAccess } from "@/lib/plan";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";

const ACTIONS: Record<string, string> = {
  "candidate.create": "registered a candidate", "candidate.import": "imported candidates", "candidate.self_register": "A candidate registered online",
  "stage.move": "moved a candidate forward", "stage.override": "overrode a pipeline gate", "placement.assign_job": "matched a candidate to a job",
  "placement.close": "closed a placement", "document.upload": "uploaded a document", "document.portal_upload": "A candidate sent a document",
  "document.verified": "verified a document", "document.rejected": "rejected a document", "cost.add": "recorded a cost", "cost.reverse": "reversed a cost",
  "payment.record": "recorded a payment", "invoice.raise": "raised an invoice", "employer.create": "added an employer", "employer.vet": "marked an employer as vetted",
  "joborder.create": "created a job order", "joborder.approve": "approved a job order", "user.create": "added a team member", "mpesa.request": "sent an M-Pesa request",
  "mpesa.success": "M-Pesa payment received", "complaint.add": "recorded a complaint", "complaint.portal": "A candidate raised a complaint", "export": "exported data",
  "application.create": "A candidate applied for a job", "appointment.add": "booked an appointment", "contract.record": "recorded a contract copy", "travel.save": "updated visa and travel",
  "checkin.done": "recorded a check-in", "employer.select": "An employer selected a candidate", "employer.interview": "An employer requested an interview",
  "employer.reject": "An employer declined a candidate", "tenant.signup": "Workspace created",
};
const phrase = (action: string, who: string | null) => {
  const base = ACTIONS[action] ?? action.replace(/[._]/g, " ");
  return /^[A-Z]/.test(base) ? base : `${who ?? "Someone"} ${base}`;
};
const ago = (d: Date, now: number) => {
  const m = Math.round((now - new Date(d).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default async function Dashboard() {
  const ctx = await requireCtx();
  const showMoney = can(ctx.role, "finance:read");
  const admin = can(ctx.role, "users:manage");
  const access = await getAccess(ctx.tenantId);

  const d = await withTenant(ctx.tenantId, async (tx) => {
    const [c] = await tx`
      SELECT
        (SELECT count(*) FROM candidates WHERE status <> 'inactive') AS candidates,
        (SELECT count(*) FROM placements WHERE outcome = 'active') AS active,
        (SELECT count(*) FROM placements WHERE outcome = 'deployed') AS deployed,
        (SELECT count(*) FROM job_orders WHERE status = 'open') AS open_jobs,
        (SELECT count(*) FROM job_orders WHERE status = 'pending') AS pending_jobs,
        (SELECT count(*) FROM documents WHERE status = 'pending') AS docs_pending,
        (SELECT count(*) FROM documents WHERE status <> 'rejected' AND expiry_date IS NOT NULL AND expiry_date <= current_date + 60) AS docs_expiring,
        (SELECT count(*) FROM checkins WHERE done_on IS NULL AND due_on < current_date) AS checkins_overdue,
        (SELECT count(*) FROM complaints WHERE status <> 'resolved') AS complaints,
        (SELECT count(*) FROM applications WHERE status = 'pending') AS applications,
        (SELECT count(*) FROM messages WHERE status = 'failed') AS failed_messages,
        (SELECT count(*) FROM appointments WHERE result = 'pending' AND scheduled_at BETWEEN now() AND now() + interval '7 days') AS appts_week,
        (SELECT count(*) FROM (
           SELECT p.id FROM placements p WHERE p.outcome <> 'closed'
             AND (SELECT COALESCE(sum(amount_minor), 0) FROM fee_charges f WHERE f.placement_id = p.id AND f.due_on <= current_date)
               > (SELECT COALESCE(sum(amount_minor), 0) FROM payments x WHERE x.placement_id = p.id AND x.party = 'candidate')) q) AS fees_overdue`;
    const [setup] = await tx`
      SELECT
        (SELECT count(*) FROM users WHERE role <> 'employer' AND status = 'active') AS staff,
        (SELECT count(*) FROM employers) AS employers,
        (SELECT count(*) FROM employers WHERE vetted) AS vetted,
        (SELECT count(*) FROM job_orders) AS jobs,
        (SELECT count(*) FROM candidates) AS candidates,
        (SELECT count(*) FROM placements WHERE job_order_id IS NOT NULL) AS matched,
        (SELECT count(*) FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id WHERE s.position >= 3) AS advanced,
        (SELECT count(*) FROM candidates WHERE source = 'portal') AS portal_signups,
        (SELECT (settings ? 'mpesa')::int FROM tenants WHERE id = ${ctx.tenantId}) AS mpesa,
        (SELECT count(*) FROM candidates WHERE source = 'sample') AS sample`;
    const stages = await tx`
      SELECT s.name, s.position, count(p.id) AS n
      FROM pipeline_stages s LEFT JOIN placements p ON p.stage_id = s.id AND p.outcome <> 'closed'
      GROUP BY s.id ORDER BY s.position`;
    const activity = await tx`
      SELECT a.action, a.created_at, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action NOT LIKE 'document.view' AND a.action <> 'export' ORDER BY a.created_at DESC LIMIT 8`;
    const [now] = await tx`SELECT extract(epoch from now()) * 1000 AS ms`;
    let money = { exposure: 0, receivables: [] as { currency: string; due: string }[], collected: 0 };
    if (showMoney) {
      const [e] = await tx`
        SELECT COALESCE(sum(c.amount_minor), 0) AS total FROM costs c JOIN placements p ON p.id = c.placement_id
        WHERE p.payment_model = 'employer_paid' AND c.currency = 'KES'
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.placement_id = p.id AND i.status = 'paid')`;
      const rec = await tx`
        SELECT i.currency, sum(i.amount_minor - COALESCE((SELECT sum(amount_minor) FROM payments WHERE invoice_id = i.id), 0)) AS due
        FROM invoices i WHERE i.status = 'open' GROUP BY i.currency`;
      const [col] = await tx`SELECT COALESCE(sum(amount_minor), 0) AS total FROM payments WHERE currency = 'KES' AND paid_on > current_date - 30`;
      money = { exposure: Number(e.total), receivables: rec as never, collected: Number(col.total) };
    }
    return { c, setup, stages, activity, money, now: Number(now.ms) };
  });
  const { c, setup } = d;
  const n = (v: unknown) => Number(v);

  const checklist = [
    { done: n(setup.staff) > 1, label: "Add your team", sub: "Recruiters, documentation and finance staff", href: "/settings/team", show: admin },
    { done: n(setup.employers) > 0, label: "Add an employer", sub: "The company that will hire your workers", href: "/employers/new", show: true },
    { done: n(setup.vetted) > 0, label: "Vet an employer", sub: "Record a registration check, then mark them vetted", href: "/employers", show: true },
    { done: n(setup.jobs) > 0, label: "Create a job order", sub: "Roles, how many workers, who pays the costs", href: "/job-orders/new", show: true },
    { done: n(setup.candidates) > 0, label: "Add or import candidates", sub: "One at a time, or a whole spreadsheet at once", href: "/candidates/import", show: true },
    { done: n(setup.matched) > 0, label: "Match a candidate to a job", sub: "Open a candidate and choose a job order", href: "/candidates", show: true },
    { done: n(setup.advanced) > 0, label: "Take a candidate through the pipeline", sub: "Match them to a job, record the contract, then get them ready to travel", href: "/pipeline", show: true },
    { done: n(setup.mpesa) > 0, label: "Set up M-Pesa collections", sub: "So candidates can pay fees from their phone", href: "/settings/payments", show: admin && access.features.mpesa },
    { done: n(setup.portal_signups) > 0, label: "Share your candidate page", sub: "Candidates register and apply from their phones", href: "/settings/general", show: admin && access.features.candidate_portal },
  ].filter((i) => i.show);
  const doneCount = checklist.filter((i) => i.done).length;

  const attention = [
    { n: n(c.docs_pending), label: "documents waiting to be verified", href: "/verify", Icon: FileClock, show: can(ctx.role, "documents:verify") },
    { n: n(c.applications), label: "online applications to review", href: "/job-orders", Icon: UserPlus, show: true },
    { n: n(c.pending_jobs), label: "employer requests to approve", href: "/job-orders", Icon: Briefcase, show: can(ctx.role, "joborders:write") },
    { n: n(c.docs_expiring), label: "documents expiring within 60 days", href: "/candidates", Icon: AlertTriangle, show: true },
    { n: n(c.fees_overdue), label: "candidates with fees overdue", href: "/finance", Icon: Wallet, show: showMoney },
    { n: n(c.checkins_overdue), label: "overdue follow-up check-ins", href: "/follow-up", Icon: CalendarClock, show: true },
    { n: n(c.complaints), label: "open complaints", href: "/complaints", Icon: MessageSquareWarning, show: true },
    { n: n(c.failed_messages), label: "messages that failed to send", href: "/messages", Icon: AlertTriangle, show: ctx.role !== "finance" },
    { n: n(c.appts_week), label: "appointments this week", href: "/follow-up", Icon: CalendarClock, show: true },
  ].filter((a) => a.show && a.n > 0).slice(0, 5);

  const top = Math.max(1, ...d.stages.map((s) => n(s.n)));

  return (
    <>
      <PageHeader title={`Welcome back, ${ctx.name.split(" ")[0]}`} sub={n(setup.sample) > 0 ? "You are looking at sample data. Remove it any time." : "Here is where your agency stands today."}>
        {n(setup.sample) > 0 && admin && <Link href="/getting-started" className="btn btn-ghost">Manage sample data</Link>}
        {can(ctx.role, "candidates:write") && <Link href="/candidates/new" className="btn btn-primary"><Plus size={16} /> Add candidate</Link>}
        {can(ctx.role, "joborders:write") && <Link href="/job-orders/new" className="btn"><Briefcase size={16} /> New job order</Link>}
      </PageHeader>

      {checklist.length > 0 && doneCount < checklist.length && (
        <section className="card">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="h2">Get set up</div>
              <p className="muted">{doneCount} of {checklist.length} steps done.</p>
            </div>
            <div className="progress w-40"><span style={{ width: `${Math.round((doneCount / checklist.length) * 100)}%` }} /></div>
          </div>
          <ul className="mt-2">
            {checklist.filter((i) => !i.done).slice(0, 3).map((i, k) => (
              <li key={i.label} className="border-t border-[var(--line-2)] first:border-0">
                <Link href={i.href} className="flex items-center gap-3 py-2.5 hover:bg-[#f9fafb] rounded-lg -mx-2 px-2">
                  <CircleDashed size={19} className="muted flex-none" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{i.label}</span>
                    <span className="block text-xs muted">{i.sub}</span>
                  </span>
                  {k === 0 ? <span className="btn btn-sm btn-primary">Start <ArrowRight size={14} /></span> : <ChevronRight size={16} className="muted flex-none" />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Users size={20} />} label="Candidates" value={n(c.candidates)} href="/candidates" />
        <StatCard icon={<Globe2 size={20} />} label="In the pipeline" value={n(c.active)} href="/pipeline" />
        <StatCard icon={<PlaneTakeoff size={20} />} label="Deployed" value={n(c.deployed)} href="/pipeline" />
        <StatCard icon={<Briefcase size={20} />} label="Open job orders" value={n(c.open_jobs)} href="/job-orders" />
      </section>

      <div className="grid lg:grid-cols-5 gap-4">
        <section className="card lg:col-span-3">
          <div className="flex items-center justify-between mb-3"><div className="h2">Needs your attention</div><Link href="/todo" className="link text-sm">See everything</Link></div>
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 py-6 justify-center muted"><CheckCircle2 className="text-[var(--good)]" /> Nothing is waiting on you right now.</div>
          ) : (
            <ul className="grid">
              {attention.map((a) => (
                <li key={a.label}>
                  <Link href={a.href} className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-[#f9fafb] border-b border-[var(--line-2)] last:border-0">
                    <span className="stat-icon" style={{ width: 34, height: 34, background: "var(--warn-soft)", color: "var(--warn)" }}><a.Icon size={17} /></span>
                    <span className="flex-1"><b className="text-[15px]">{a.n}</b> <span className="text-[var(--ink-2)]">{a.label}</span></span>
                    <ChevronRight size={16} className="muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card lg:col-span-2">
          <div className="h2 mb-3">Candidates by stage</div>
          <div className="grid gap-2.5">
            {d.stages.map((s) => (
              <div key={s.position}>
                <div className="flex justify-between text-[13px] mb-1"><span className="text-[var(--ink-2)]">{s.position}. {s.name}</span><b>{n(s.n)}</b></div>
                <div className="progress" style={{ height: 6 }}><span style={{ width: `${(n(s.n) / top) * 100}%`, opacity: n(s.n) ? 1 : 0.25 }} /></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {showMoney && (
        <section className="grid md:grid-cols-3 gap-3">
          <div className="card">
            <div className="eyebrow">Cash exposure</div>
            <div className="text-[26px] font-bold tracking-tight mt-1">{formatMoney(d.money.exposure)}</div>
            <p className="muted text-xs mt-1">Costs paid out for employer-paid workers that employers have not yet repaid.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Owed by employers</div>
            {d.money.receivables.length === 0 ? <div className="text-[26px] font-bold mt-1">Nothing</div> : d.money.receivables.map((r) => <div key={r.currency} className="text-[26px] font-bold tracking-tight mt-1">{formatMoney(r.due, r.currency)}</div>)}
            <p className="muted text-xs mt-1">Open invoices less payments received.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Collected, last 30 days</div>
            <div className="text-[26px] font-bold tracking-tight mt-1">{formatMoney(d.money.collected)}</div>
            <Link href="/finance" className="link text-sm inline-flex items-center gap-1 mt-1">Open finance <ArrowRight size={14} /></Link>
          </div>
        </section>
      )}

      <section className="card">
        <div className="h2 mb-2">Recent activity</div>
        {d.activity.length === 0 ? <p className="muted">Nothing has happened yet. Add your first candidate to get started.</p> : (
          <ul>
            {d.activity.slice(0, 6).map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 border-b border-[var(--line-2)] last:border-0">
                <span className="text-[var(--ink-2)]">{phrase(a.action, a.who)}</span>
                <span className="muted text-xs whitespace-nowrap">{ago(a.created_at, d.now)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
