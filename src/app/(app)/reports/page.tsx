import Link from "next/link";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { formatMoney } from "@/lib/money";
import { PrintButton } from "@/components/PrintButton";
import { getAccess } from "@/lib/plan";

const valid = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function Bar({ value, max, tone = "var(--brand)" }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return <div className="h-2 rounded bg-[#eef0f4] w-full"><div className="h-2 rounded" style={{ width: `${value > 0 ? pct : 0}%`, background: tone }} /></div>;
}

export default async function Reports({ searchParams }: PageProps<"/reports">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [{ today, yearAgo }] = await withTenant(ctx.tenantId, (tx) => tx`SELECT current_date::text AS today, (current_date - 365)::text AS "yearAgo"`);
  const to = valid(sp.to) ?? (today as string);
  const from = valid(sp.from) ?? (yearAgo as string);
  const money = can(ctx.role, "finance:read");
  const access = await getAccess(ctx.tenantId);
  if (!access.features.reports) return <div className="card"><h1 className="h1">Reports</h1><p className="mt-2">Reports are not part of the {access.planName} plan. <Link className="link" href="/billing">Upgrade</Link> to use them.</p></div>;

  const d = await withTenant(ctx.tenantId, async (tx) => {
    const funnel = await tx`
      SELECT s.position, s.name, count(DISTINCT h.placement_id) AS reached
      FROM pipeline_stages s
      LEFT JOIN stage_history h ON h.to_stage_id = s.id AND h.created_at::date BETWEEN ${from} AND ${to}
      GROUP BY s.id ORDER BY s.position`;
    const byCountry = await tx`
      SELECT j.country, COALESCE(NULLIF(j.category, ''), 'Unspecified') AS category,
             count(DISTINCT p.id) AS placements,
             count(DISTINCT p.id) FILTER (WHERE EXISTS (
               SELECT 1 FROM stage_history h JOIN pipeline_stages s ON s.id = h.to_stage_id WHERE h.placement_id = p.id AND s.marks_deployed)) AS deployed,
             count(DISTINCT p.id) FILTER (WHERE p.outcome = 'closed' AND p.close_reason <> 'Completed' AND NOT EXISTS (
               SELECT 1 FROM stage_history h JOIN pipeline_stages s ON s.id = h.to_stage_id WHERE h.placement_id = p.id AND s.marks_deployed)) AS dropped
      FROM placements p JOIN job_orders j ON j.id = p.job_order_id
      WHERE p.created_at::date BETWEEN ${from} AND ${to}
      GROUP BY j.country, 2 ORDER BY deployed DESC, placements DESC`;
    const dropReasons = await tx`
      SELECT split_part(close_reason, ':', 1) AS reason, count(*) AS n FROM placements
      WHERE outcome = 'closed' AND closed_at::date BETWEEN ${from} AND ${to} GROUP BY 1 ORDER BY n DESC`;
    const monthly = money ? await tx`
      WITH m AS (SELECT generate_series(date_trunc('month', ${from}::date), date_trunc('month', ${to}::date), interval '1 month') AS month)
      SELECT to_char(m.month, 'Mon YYYY') AS label,
        COALESCE((SELECT sum(x.amount_minor * COALESCE(i.fx_rate_to_kes, 1)) FROM payments x LEFT JOIN invoices i ON i.id = x.invoice_id
                  WHERE date_trunc('month', x.paid_on) = m.month), 0)::bigint AS received,
        COALESCE((SELECT sum(amount_minor) FROM costs WHERE currency = 'KES' AND date_trunc('month', incurred_on) = m.month), 0)::bigint AS spent
      FROM m ORDER BY m.month` : [];
    const profit = money ? await tx`
      SELECT * FROM (
        SELECT p.id, c.first_name, c.last_name, j.title, e.company,
          COALESCE((SELECT sum(x.amount_minor * COALESCE(i.fx_rate_to_kes, 1)) FROM payments x LEFT JOIN invoices i ON i.id = x.invoice_id WHERE x.placement_id = p.id), 0)::bigint AS revenue,
          COALESCE((SELECT sum(amount_minor) FROM costs WHERE placement_id = p.id AND currency = 'KES'), 0)::bigint AS cost
        FROM placements p JOIN candidates c ON c.id = p.candidate_id JOIN job_orders j ON j.id = p.job_order_id JOIN employers e ON e.id = j.employer_id
        WHERE EXISTS (SELECT 1 FROM stage_history h JOIN pipeline_stages s ON s.id = h.to_stage_id
                      WHERE h.placement_id = p.id AND s.marks_deployed AND h.created_at::date BETWEEN ${from} AND ${to})
      ) t ORDER BY revenue - cost DESC LIMIT 25` : [];
    const byEmployer = money ? await tx`
      SELECT e.company, count(DISTINCT p.id) AS placements,
        COALESCE(sum(DISTINCT i.amount_minor * i.fx_rate_to_kes), 0)::bigint AS invoiced
      FROM employers e JOIN job_orders j ON j.employer_id = e.id JOIN placements p ON p.job_order_id = j.id
      LEFT JOIN invoices i ON i.placement_id = p.id AND i.status <> 'void' AND i.issued_on BETWEEN ${from} AND ${to}
      GROUP BY e.id ORDER BY invoiced DESC LIMIT 10` : [];
    return { funnel, byCountry, dropReasons, monthly, profit, byEmployer };
  });

  const top = Math.max(1, ...d.funnel.map((f) => Number(f.reached)));
  const maxMoney = Math.max(1, ...d.monthly.flatMap((m) => [Number(m.received), Number(m.spent)]));
  const qs = `from=${from}&to=${to}`;
  const totalProfit = d.profit.reduce((s, r) => s + Number(r.revenue) - Number(r.cost), 0);

  return (
    <div className="grid gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h1 className="h1">Reports</h1>
        <form className="flex items-end gap-2 flex-wrap">
          <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>
          <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
          <button className="btn">Apply</button>
          <PrintButton />
        </form>
      </div>

      <div className="card">
        <div className="h2 mb-1">How far candidates got</div>
        <p className="muted text-xs mb-3">Placements that reached each stage between {from} and {to}.</p>
        <div className="grid gap-2">
          {d.funnel.map((f, i) => {
            const prev = i > 0 ? Number(d.funnel[i - 1].reached) : null;
            const keep = prev ? Math.round((Number(f.reached) / prev) * 100) : null;
            return (
              <div key={f.position} className="grid grid-cols-[170px_1fr_90px] items-center gap-3">
                <div>{f.position}. {f.name}</div>
                <Bar value={Number(f.reached)} max={top} />
                <div className="text-right"><b>{Number(f.reached)}</b>{keep !== null && <span className="muted text-xs"> · {keep}%</span>}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="h2 mb-2">Placements by destination and job</div>
        <table className="table">
          <thead><tr><th>Country</th><th>Job</th><th className="text-right">Placements</th><th className="text-right">Deployed</th><th className="text-right">Dropped before deployment</th></tr></thead>
          <tbody>
            {d.byCountry.map((r, i) => (
              <tr key={i}><td>{r.country}</td><td>{r.category}</td><td className="text-right">{Number(r.placements)}</td><td className="text-right font-semibold">{Number(r.deployed)}</td><td className="text-right">{Number(r.dropped)}</td></tr>
            ))}
            {d.byCountry.length === 0 && <tr><td colSpan={5} className="muted">No placements in this period.</td></tr>}
          </tbody>
        </table>
      </div>

      {d.dropReasons.length > 0 && (
        <div className="card">
          <div className="h2 mb-2">Why placements closed</div>
          <table className="table"><tbody>{d.dropReasons.map((r) => <tr key={r.reason}><td>{r.reason}</td><td className="text-right font-semibold">{Number(r.n)}</td></tr>)}</tbody></table>
        </div>
      )}

      {money && (
        <>
          <div className="card">
            <div className="h2 mb-1">Money in and out, by month</div>
            <p className="muted text-xs mb-3">Received includes employer payments converted at the invoice rate. Spent is costs paid in KES.</p>
            <div className="grid gap-3">
              {d.monthly.map((m) => (
                <div key={m.label} className="grid grid-cols-[90px_1fr_150px] items-center gap-3">
                  <div>{m.label}</div>
                  <div className="grid gap-1"><Bar value={Number(m.received)} max={maxMoney} tone="var(--good)" /><Bar value={Number(m.spent)} max={maxMoney} tone="var(--warn)" /></div>
                  <div className="text-right text-xs"><div className="text-[var(--good)]">+ {formatMoney(m.received)}</div><div className="text-[var(--warn)]">− {formatMoney(m.spent)}</div></div>
                </div>
              ))}
            </div>
          </div>

          <div className="card overflow-x-auto">
            <div className="flex items-baseline justify-between"><div className="h2">Profit per deployed worker</div><div className="font-bold">{formatMoney(totalProfit)} total</div></div>
            <table className="table mt-2">
              <thead><tr><th>Worker</th><th>Employer</th><th className="text-right">Received</th><th className="text-right">Costs</th><th className="text-right">Profit</th></tr></thead>
              <tbody>
                {d.profit.map((r) => {
                  const p = Number(r.revenue) - Number(r.cost);
                  return (
                    <tr key={r.id}>
                      <td><Link className="link" href={`/placements/${r.id}`}>{r.first_name} {r.last_name}</Link><div className="muted text-xs">{r.title}</div></td>
                      <td>{r.company}</td><td className="text-right">{formatMoney(r.revenue)}</td><td className="text-right">{formatMoney(r.cost)}</td>
                      <td className={`text-right font-semibold ${p < 0 ? "text-[var(--bad)]" : ""}`}>{formatMoney(p)}</td>
                    </tr>
                  );
                })}
                {d.profit.length === 0 && <tr><td colSpan={5} className="muted">No deployments in this period.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card overflow-x-auto">
            <div className="h2 mb-2">Invoiced by employer (KES equivalent)</div>
            <table className="table"><tbody>
              {d.byEmployer.map((r) => <tr key={r.company}><td>{r.company}</td><td className="text-right">{Number(r.placements)} placements</td><td className="text-right font-semibold">{formatMoney(r.invoiced)}</td></tr>)}
            </tbody></table>
          </div>
        </>
      )}

      <div className="card print:hidden">
        <div className="h2 mb-2">Download as spreadsheet (CSV) for {from} to {to}</div>
        <div className="flex flex-wrap gap-2">
          {[["candidates", "Candidates"], ["placements", "Placements"], ["deployments", "Deployment register"]].map(([k, l]) => <a key={k} className="btn" href={`/export/${k}?${qs}`}>{l}</a>)}
          {money && [["costs", "Costs"], ["payments", "Payments"], ["invoices", "Invoices"]].map(([k, l]) => <a key={k} className="btn" href={`/export/${k}?${qs}`}>{l}</a>)}
          {can(ctx.role, "users:manage") && <a className="btn" href={`/export/audit?${qs}`}>Audit trail</a>}
        </div>
      </div>
    </div>
  );
}
