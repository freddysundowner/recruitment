import { withEmployer } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { formatMoney } from "@/lib/money";

const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-KE") : "—");

export default async function EmployerInvoices() {
  const ctx = await requireCtx();
  const d = await withEmployer(ctx.tenantId, ctx.employerId!, async (tx) => ({
    invoices: await tx`
      SELECT i.*, c.first_name, c.last_name, i.amount_minor - COALESCE((SELECT sum(amount_minor) FROM payments WHERE invoice_id = i.id), 0) AS balance
      FROM invoices i JOIN placements p ON p.id = i.placement_id JOIN candidates c ON c.id = p.candidate_id ORDER BY i.issued_on DESC`,
    pays: await tx`SELECT receipt_no, paid_on, method, amount_minor, currency, reference FROM payments ORDER BY paid_on DESC LIMIT 30`,
  }));
  return (
    <>
      <h1 className="h1">Invoices</h1>
      <div className="card p-0 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Number</th><th>Worker</th><th>Issued</th><th>Due</th><th className="text-right">Amount</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
          <tbody>
            {d.invoices.map((i) => (
              <tr key={i.id}><td>{i.number}</td><td>{i.first_name} {i.last_name}</td><td>{fmt(i.issued_on)}</td><td>{fmt(i.due_on)}</td>
                <td className="text-right">{formatMoney(i.amount_minor, i.currency)}</td><td className="text-right">{formatMoney(i.balance, i.currency)}</td>
                <td><span className={`badge ${i.status === "paid" ? "badge-good" : ""}`}>{i.status}</span></td></tr>
            ))}
            {d.invoices.length === 0 && <tr><td colSpan={7} className="muted">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card p-0 overflow-x-auto">
        <div className="p-4 pb-0 h2">Payments you made</div>
        <table className="table mt-2">
          <tbody>
            {d.pays.map((x) => <tr key={x.receipt_no}><td>{x.receipt_no}</td><td>{fmt(x.paid_on)}</td><td>{x.method} {x.reference}</td><td className="text-right">{formatMoney(x.amount_minor, x.currency)}</td></tr>)}
            {d.pays.length === 0 && <tr><td className="muted">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
