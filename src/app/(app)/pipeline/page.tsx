import Link from "next/link";
import { Tabs } from "@/components/shell/Tabs";
import { TABS } from "@/components/shell/tabs-data";
import { ArrowRight, Clock, KanbanSquare, LayoutList, Plus, Search, X } from "lucide-react";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { PageHeader } from "@/components/ui/PageHeader";

// How many people each column shows, and how many rows a page of the list shows. Everyone is reachable through
// the list, filtered to one stage, so a column never has to be an endless scroll.
const PER_COLUMN = 6;
const PER_PAGE = 25;
// A candidate who has sat in one stage this many days is flagged as stuck.
const STALE_DAYS = 14;

type Params = { view?: string; q?: string; job?: string; show?: string; stage?: string; sort?: string; page?: string };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function Pipeline({ searchParams }: PageProps<"/pipeline">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const p: Params = { view: one(sp.view), q: one(sp.q)?.trim(), job: one(sp.job), show: one(sp.show), stage: one(sp.stage), sort: one(sp.sort), page: one(sp.page) };
  const list = p.view === "list" || Boolean(p.stage);
  const jobId = p.job && /^[0-9a-f-]{36}$/.test(p.job) ? p.job : null;
  const stageId = p.stage && /^[0-9a-f-]{36}$/.test(p.stage) ? p.stage : null;
  const page = Math.max(1, Number(p.page) || 1);
  const like = `%${p.q ?? ""}%`;

  const d = await withTenant(ctx.tenantId, async (tx) => {
    const stages = await tx`SELECT id, position, name FROM pipeline_stages ORDER BY position`;
    const jobs = await tx`SELECT j.id, j.title, e.company FROM job_orders j JOIN employers e ON e.id = j.employer_id WHERE j.status IN ('open', 'filled') ORDER BY e.company, j.title`;
    // One row per person still in the pipeline, with how long they have been in their current stage.
    const base = tx`
      SELECT * FROM (
        SELECT p.id, p.stage_id, p.payment_model, c.first_name, c.last_name, c.source, j.id AS job_id, j.title, e.country,
          (SELECT count(*) FROM documents d WHERE d.candidate_id = c.id AND d.status = 'pending') AS pending_docs,
          GREATEST(0, floor(extract(epoch FROM now() - COALESCE(
            (SELECT max(h.created_at) FROM stage_history h WHERE h.placement_id = p.id AND h.to_stage_id = p.stage_id), p.created_at)) / 86400))::int AS days
        FROM placements p JOIN candidates c ON c.id = p.candidate_id
        LEFT JOIN job_orders j ON j.id = p.job_order_id LEFT JOIN employers e ON e.id = j.employer_id
        WHERE p.outcome <> 'closed'
          ${p.q ? tx`AND (c.first_name || ' ' || c.last_name ILIKE ${like} OR c.phone ILIKE ${like})` : tx``}
          ${jobId ? tx`AND p.job_order_id = ${jobId}` : tx``}
      ) b
      WHERE true
        ${p.show === "attention" ? tx`AND (b.pending_docs > 0 OR b.days >= ${STALE_DAYS})` : tx``}
        ${p.show === "stuck" ? tx`AND b.days >= ${STALE_DAYS}` : tx``}`;

    if (list) {
      const order = p.sort === "name" ? tx`b.first_name, b.last_name` : p.sort === "recent" ? tx`b.days ASC, b.first_name` : tx`b.days DESC, b.first_name`;
      const rows = await tx`
        SELECT b.*, s.name AS stage, s.position, count(*) OVER () AS total
        FROM (${base}) b JOIN pipeline_stages s ON s.id = b.stage_id
        ${stageId ? tx`WHERE b.stage_id = ${stageId}` : tx``}
        ORDER BY ${order} LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`;
      const [t] = await tx`SELECT count(*) AS n FROM (${base}) b ${stageId ? tx`WHERE b.stage_id = ${stageId}` : tx``}`;
      return { stages, jobs, rows, cards: [] as unknown as typeof rows, total: Number(t.n), counts: [] as { stage_id: string; n: number; stuck: number }[] };
    }

    // Board: the longest-waiting few in each column, and the true count for every column.
    const cards = await tx`
      SELECT * FROM (SELECT b.*, row_number() OVER (PARTITION BY b.stage_id ORDER BY b.days DESC, b.first_name) AS rn FROM (${base}) b) r WHERE r.rn <= ${PER_COLUMN}`;
    const counts = await tx`
      SELECT b.stage_id, count(*)::int AS n, count(*) FILTER (WHERE b.days >= ${STALE_DAYS})::int AS stuck FROM (${base}) b GROUP BY b.stage_id`;
    return { stages, jobs, rows: [] as unknown as typeof cards, cards, total: counts.reduce((s, c) => s + Number(c.n), 0), counts: counts as unknown as { stage_id: string; n: number; stuck: number }[] };
  });

  // Keep the current filters when switching view or page.
  const href = (over: Partial<Params>) => {
    const next = { ...p, ...over };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v && !(k === "page" && v === "1")) qs.set(k, v);
    const s = qs.toString();
    return `/pipeline${s ? `?${s}` : ""}`;
  };
  const filtered = Boolean(p.q || jobId || p.show);
  const stageName = stageId ? d.stages.find((s) => s.id === stageId)?.name : null;
  const pages = Math.max(1, Math.ceil(d.total / PER_PAGE));

  return (
    <>
      <Tabs items={TABS.candidates} />
      <PageHeader title="Pipeline" sub={`${d.total} ${d.total === 1 ? "candidate" : "candidates"}${filtered ? " match your filters" : " in progress"}${stageName ? `, in ${stageName}` : ""}.`}>
        <div className="seg" role="group" aria-label="View">
          <Link href={href({ view: undefined, stage: undefined, page: undefined })} className="seg-item" aria-current={!list ? "true" : undefined}><KanbanSquare size={15} /> Board</Link>
          <Link href={href({ view: "list", page: undefined })} className="seg-item" aria-current={list ? "true" : undefined}><LayoutList size={15} /> List</Link>
        </div>
        {can(ctx.role, "candidates:write") && <Link href="/candidates/new" className="btn btn-primary"><Plus size={16} /> Add candidate</Link>}
      </PageHeader>

      <form className="card flex flex-wrap items-end gap-3" style={{ padding: 14 }}>
        {list && <input type="hidden" name="view" value="list" />}
        {stageId && <input type="hidden" name="stage" value={stageId} />}
        <div className="search" style={{ maxWidth: 280, flex: "1 1 220px" }}>
          <Search size={16} />
          <input name="q" defaultValue={p.q ?? ""} placeholder="Name or phone" className="input" aria-label="Search by name or phone" />
        </div>
        <div style={{ flex: "1 1 200px", maxWidth: 280 }}>
          <select name="job" className="select" defaultValue={jobId ?? ""} aria-label="Job order">
            <option value="">All job orders</option>
            {d.jobs.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.company}</option>)}
          </select>
        </div>
        <div style={{ flex: "0 1 190px" }}>
          <select name="show" className="select" defaultValue={p.show ?? ""} aria-label="Show">
            <option value="">Everyone</option>
            <option value="attention">Needs attention</option>
            <option value="stuck">Stuck over {STALE_DAYS} days</option>
          </select>
        </div>
        <button className="btn">Apply</button>
        {(filtered || stageId) && <Link href={list && !stageId ? "/pipeline?view=list" : "/pipeline"} className="btn btn-ghost"><X size={15} /> Clear</Link>}
      </form>

      {list ? (
        <section className="card p-0 overflow-x-auto">
          {stageName && (
            <div className="flex items-center gap-2 px-4 pt-3.5">
              <span className="badge badge-brand">{stageName}</span>
              <Link href={href({ stage: undefined, page: undefined })} className="link text-sm">Show all stages</Link>
            </div>
          )}
          {d.rows.length === 0 ? (
            <div className="empty"><div className="empty-icon"><KanbanSquare size={22} /></div><div className="h2">No one matches</div><p className="muted mt-1">Try clearing the filters.</p></div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Candidate</th><th>Stage</th><th>Job</th>
                  <th><Link href={href({ sort: p.sort === "recent" || !p.sort ? "waiting" : "recent", page: undefined })} className="link inline-flex items-center gap-1"><Clock size={13} /> In stage</Link></th>
                  <th>Alerts</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/placements/${c.id}`} className="flex items-center gap-3">
                        <span className="avatar">{`${c.first_name[0]}${c.last_name[0]}`}</span>
                        <span className="font-semibold text-[var(--ink)]">{c.first_name} {c.last_name}{c.source === "sample" && <span className="badge badge-info ml-2">sample</span>}</span>
                      </Link>
                    </td>
                    <td><Link href={href({ stage: c.stage_id, view: "list", page: undefined })} className="badge badge-brand">{c.position}. {c.stage}</Link></td>
                    <td>{c.title ?? <span className="muted">Not matched yet</span>}{c.country && <div className="muted text-xs">{c.country}</div>}</td>
                    <td><span className={`badge ${c.days >= 30 ? "badge-bad" : c.days >= STALE_DAYS ? "badge-warn" : ""}`}>{c.days === 0 ? "today" : `${c.days} day${c.days === 1 ? "" : "s"}`}</span></td>
                    <td>{Number(c.pending_docs) > 0 && <span className="badge badge-warn">{c.pending_docs} doc{Number(c.pending_docs) > 1 ? "s" : ""} to verify</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--line-2)]">
              <span className="muted text-sm">Page {page} of {pages}</span>
              <div className="flex gap-2">
                {page > 1 && <Link className="btn btn-sm" href={href({ page: String(page - 1) })}>Previous</Link>}
                {page < pages && <Link className="btn btn-sm" href={href({ page: String(page + 1) })}>Next</Link>}
              </div>
            </div>
          )}
        </section>
      ) : (
        <>
          {d.total === 0 && !filtered && (
            <div className="card empty">
              <div className="empty-icon"><KanbanSquare size={22} /></div>
              <div className="h2">Your pipeline is empty</div>
              <p className="muted mt-1">Everyone you register appears here at the first stage.</p>
              <Link href="/getting-started" className="btn mt-3">Explore with sample data</Link>
            </div>
          )}
          <p className="muted text-xs -mb-2">Each column shows the people who have waited longest. Use &ldquo;View all&rdquo; to see everyone in a stage.</p>
          <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1" style={{ alignItems: "flex-start" }}>
            {d.stages.map((s) => {
              const c = d.counts.find((x) => x.stage_id === s.id);
              const n = Number(c?.n ?? 0);
              const here = d.cards.filter((x) => x.stage_id === s.id);
              return (
                <section key={s.id} className="w-64 shrink-0 rounded-xl bg-[#eceef2] p-2.5">
                  <div className="flex items-center justify-between px-1.5 pb-2 gap-2">
                    <h2 className="text-[13px] font-bold text-[var(--ink-2)] leading-tight">{s.position}. {s.name}</h2>
                    <span className="flex items-center gap-1">
                      {Number(c?.stuck ?? 0) > 0 && <span className="badge badge-warn" title={`${c?.stuck} stuck over ${STALE_DAYS} days`}><Clock size={11} /> {c?.stuck}</span>}
                      <span className="badge" style={{ background: "#fff" }}>{n}</span>
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {here.map((x) => (
                      <Link key={x.id} href={`/placements/${x.id}`} className="card block hover:border-[var(--brand-line)] transition-colors" style={{ padding: 11 }}>
                        <div className="flex items-center gap-2">
                          <span className="avatar" style={{ width: 26, height: 26, fontSize: 10.5 }}>{`${x.first_name[0]}${x.last_name[0]}`}</span>
                          <span className="font-semibold leading-tight truncate">{x.first_name} {x.last_name}</span>
                        </div>
                        <div className="text-xs muted mt-1.5 truncate">{x.title ? `${x.title}${x.country ? ` · ${x.country}` : ""}` : "Not matched to a job yet"}</div>
                        <div className="flex gap-1 flex-wrap mt-1.5">
                          <span className={`badge ${x.days >= 30 ? "badge-bad" : x.days >= STALE_DAYS ? "badge-warn" : ""}`}>{x.days === 0 ? "today" : `${x.days}d`}</span>
                          {Number(x.pending_docs) > 0 && <span className="badge badge-warn">{x.pending_docs} doc{Number(x.pending_docs) > 1 ? "s" : ""}</span>}
                          {x.source === "sample" && <span className="badge badge-info">sample</span>}
                        </div>
                      </Link>
                    ))}
                    {n === 0 && <div className="text-xs muted px-2 py-4 text-center">No one here</div>}
                    {n > here.length && (
                      <Link href={href({ stage: s.id, view: "list", page: undefined })} className="btn btn-sm w-full" style={{ background: "#fff" }}>View all {n} <ArrowRight size={13} /></Link>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
