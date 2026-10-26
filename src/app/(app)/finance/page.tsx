import Link from "next/link";
import { withTenant } from "@/lib/db";
import { requirePageCan } from "@/lib/session";
import { formatMoney } from "@/lib/money";

const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-KE") : "—");

export default async function Finance() {
  const ctx = await requirePageCan("finance:read");
  const d = await withTenant(ctx.tenantId, async (tx) => ({
    exposure: await tx`
      SELECT p.id AS placement_id, c.first_name, c.last_name, e.company, sum(x.amount_minor) AS cost,
             EXISTS (SELECT 1 FROM invoices i WHERE i.placement_id = p.id AND i.status = 'open') AS invoiced
      FROM costs x JOIN placements p ON p.id = x.placement_id JOIN candidates c ON c.id = p.candidate_id
      LEFT JOIN job_orders j ON j.id = p.job_order_id LEFT JOIN employers e ON e.id = j.employer_id
      WHERE p.payment_model = 'employer_paid' AND x.currency = 'KES'
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.placement_id = p.id AND i.status = 'paid')
      GROUP BY p.id, c.id, e.company HAVING sum(x.amount_minor) <> 0 ORDER BY cost DESC`,
    invoices: await tx`
      SELECT i.*, e.company, i.amount_minor - COALESCE((SELECT sum(amount_minor) FROM payments WHERE invoice_id = i.id), 0) AS balance,
             (current_date - i.due_on) AS overdue_days
      FROM invoices i JOIN employers e ON e.id = i.employer_id ORDER BY (i.status = 'open') DESC, i.due_on NULLS LAST, i.created_at DESC LIMIT 100`,
    payments: await tx`
      SELECT x.*, c.first_name, c.last_name FROM payments x JOIN placements p ON p.id = x.placement_id
      JOIN candidates c ON c.id = p.candidate_id ORDER BY x.created_at DESC LIMIT 20`,
  }));
  const total = d.exposure.reduce((s, r) => s + Number(r.cost), 0);

  return (
    <div className="grid gap-4">
      <h1 className="h1">Finance</h1>

      <div className="card p-0 overflow-x-auto">
        <div className="p-4 pb-0 flex items-baseline justify-between flex-wrap gap-2">
          <div className="h2">Cash exposure by placement</div>
          <div className="font-bold">{formatMoney(total)}</div>
        </div>
        <p className="muted text-xs px-4">Costs paid for employer-paid placements where the employer has not paid yet.</p>
        <table className="table mt-2">
          <thead><tr><th>Candidate</th><th>Employer</th><th>Invoice</th><th className="text-right">Costs paid</th></tr></thead>
          <tbody>
            {d.exposure.map((r) => (
              <tr key={r.placement_id}>
                <td><Link className="link" href={`/placements/${r.placement_id}`}>{r.first_name} {r.last_name}</Link></td>
                <td>{r.company ?? "—"}</td>
                <td>{r.invoiced ? <span className="badge">invoiced</span> : <span className="badge badge-warn">not invoiced</span>}</td>
                <td className="text-right">{formatMoney(r.cost)}</td>
              </tr>
            ))}
            {d.exposure.length === 0 && <tr><td colSpan={4} className="muted">No money is out in the field.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card p-0 overflow-x-auto">
        <div className="p-4 pb-0 h2">Employer invoices</div>
        <table className="table mt-2">
          <thead><tr><th>Number</th><th>Employer</th><th>Due</th><th className="text-right">Amount</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
          <tbody>
            {d.invoices.map((i) => (
              <tr key={i.id}>
                <td><Link className="link" href={`/placements/${i.placement_id}`}>{i.number}</Link></td>
                <td>{i.company}</td>
                <td>{fmt(i.due_on)}{i.status === "open" && i.overdue_days !== null && Number(i.overdue_days) > 0 && <span className="badge badge-bad ml-2">{i.overdue_days}d overdue</span>}</td>
                <td className="text-right">{formatMoney(i.amount_minor, i.currency)}</td>
                <td className="text-right">{formatMoney(i.balance, i.currency)}</td>
                <td><span className={`badge ${i.status === "paid" ? "badge-good" : ""}`}>{i.status}</span></td>
              </tr>
            ))}
            {d.invoices.length === 0 && <tr><td colSpan={6} className="muted">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card p-0 overflow-x-auto">
        <div className="p-4 pb-0 h2">Recent payments received</div>
        <table className="table mt-2">
          <thead><tr><th>Receipt</th><th>Date</th><th>From</th><th>Candidate</th><th>Method</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {d.payments.map((x) => (
              <tr key={x.id}>
                <td>{x.receipt_no}</td><td>{fmt(x.paid_on)}</td><td>{x.party}</td><td>{x.first_name} {x.last_name}</td><td>{x.method}</td>
                <td className="text-right">{formatMoney(x.amount_minor, x.currency)}</td>
              </tr>
            ))}
            {d.payments.length === 0 && <tr><td colSpan={6} className="muted">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
