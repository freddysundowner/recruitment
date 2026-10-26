import { sql } from "@/lib/db";
import { requirePlatform } from "@/lib/platform";
import { formatMoney } from "@/lib/money";

export default async function Payments() {
  await requirePlatform();
  const rows = await sql`SELECT * FROM platform_recent_payments()`;
  return (
    <>
      <h1 className="h1">Subscription payments</h1>
      <div className="card p-0 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Date</th><th>Agency</th><th>Plan</th><th>Months</th><th>Method</th><th>Reference</th><th>Recorded by</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {rows.map((p) => <tr key={p.id}><td>{new Date(p.created_at).toLocaleDateString("en-KE")}</td><td>{p.tenant_name}</td><td>{p.plan_code}</td><td>{p.months}</td><td>{p.method}</td><td>{p.reference}</td><td>{p.recorded_by}</td><td className="text-right">{formatMoney(p.amount_minor)}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
