import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { requirePlatform } from "@/lib/platform";
import { formatMoney } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { extendTrial, recordManualPayment, setTenantPlan, setTenantStatus, startSupportAccess } from "@/app/actions/platform";

const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function TenantPage({ params }: PageProps<"/platform/tenants/[id]">) {
  const { id } = await params;
  const admin = await requirePlatform();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = (await sql`SELECT *, (period_end < now()) AS expired FROM platform_tenants()`).find((x) => x.id === id);
  if (!t) notFound();
  const plans = await sql`SELECT code, name, price_kes_minor FROM plans ORDER BY sort`;
  const pays = await sql`SELECT * FROM platform_tenant_payments(${id})`;
  const expired = Boolean(t.expired);
  const can = admin.totpEnabled;

  return (
    <>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="h1">{t.name}</h1>
          <div className="muted">Signs in at <Link className="link" href={`/c/${t.slug}`}>/c/{t.slug}</Link> · joined {fmt(t.created_at)}</div>
        </div>
        <div className="flex gap-2 items-center">
          <span className={`badge ${t.status === "suspended" ? "badge-bad" : "badge-good"}`}>{t.status}</span>
          {can && <ActionForm action={setTenantStatus.bind(null, t.id, t.status === "active" ? "suspended" : "active")} submit={t.status === "active" ? "Suspend" : "Reactivate"} buttonClass={`btn btn-sm ${t.status === "active" ? "btn-danger" : ""}`} className="inline" confirm={t.status === "active" ? "Suspend this agency? Nobody there can sign in until you reactivate it." : undefined}><></></ActionForm>}
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <div className="card"><div className="muted text-xs font-semibold">Plan</div><div className="text-xl font-bold">{t.plan_code}</div></div>
        <div className="card"><div className="muted text-xs font-semibold">Subscription</div><div className={`text-xl font-bold ${expired ? "text-[var(--bad)]" : ""}`}>{expired ? "lapsed" : t.sub_status}</div></div>
        <div className="card"><div className="muted text-xs font-semibold">Paid until</div><div className="text-xl font-bold">{fmt(t.period_end)}</div></div>
        <div className="card"><div className="muted text-xs font-semibold">Using</div><div>{Number(t.users_count)} staff · {Number(t.candidates_count)} candidates · {Number(t.placements_count)} placements</div></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card grid gap-3">
          <div className="h2">Record a payment</div>
          <p className="muted text-xs">Use this for bank transfers or cash. M-Pesa and card payments made on the agency&apos;s Billing page are recorded automatically. The reference stops the same payment being recorded twice.</p>
          {can ? (
            <ActionForm confirm="Record this payment and extend the agency's plan? This is recorded permanently." action={recordManualPayment.bind(null, t.id)} submit="Record and extend" className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label" htmlFor="plan">Plan</label><select id="plan" name="plan" className="select" defaultValue={t.plan_code}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
                <div><label className="label" htmlFor="months">Months</label><input id="months" name="months" type="number" min={1} max={36} defaultValue={1} className="input" /></div>
                <div><label className="label" htmlFor="amount">Amount received (KES)</label><input id="amount" name="amount" className="input" /></div>
                <div><label className="label" htmlFor="method">Method</label><select id="method" name="method" className="select"><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option><option value="complimentary">Complimentary</option></select></div>
                <div className="col-span-2"><label className="label" htmlFor="reference">Reference</label><input id="reference" name="reference" className="input" /></div>
              </div>
            </ActionForm>
          ) : <p className="muted">Set up two-step sign-in to make changes.</p>}
        </div>

        <div className="grid gap-4 content-start">
          {can && (
            <div className="card grid gap-3">
              <div className="h2">Change plan</div>
              <ActionForm confirm="Change this agency's plan now? The new limits apply immediately." action={setTenantPlan.bind(null, t.id)} submit="Change plan" buttonClass="btn" className="flex gap-2 items-end" resetOnSuccess={false}>
                <div className="flex-1"><select name="plan" className="select" defaultValue={t.plan_code}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({formatMoney(p.price_kes_minor)}/mo)</option>)}</select></div>
              </ActionForm>
              <div className="h2 mt-1">Extend the trial</div>
              <ActionForm confirm="Extend this agency's trial?" action={extendTrial.bind(null, t.id)} submit="Extend" buttonClass="btn" className="flex gap-2 items-end">
                <div className="w-32"><input name="days" type="number" min={1} max={90} defaultValue={7} className="input" aria-label="Days to add" /></div><span className="muted self-center">days</span>
              </ActionForm>
            </div>
          )}
          {can && (
            <div className="card grid gap-3">
              <div className="h2">Support access</div>
              <p className="muted text-xs">Opens this agency&apos;s screens as its admin, read-only, for one hour. The reason and your name appear in the agency&apos;s own activity log.</p>
              <ActionForm confirm="Open this agency's workspace as support? The session is read-only and recorded in their activity log." action={startSupportAccess.bind(null, t.id)} submit="Open as support" buttonClass="btn" className="grid gap-2" resetOnSuccess={false}>
                <input name="reason" required placeholder="Ticket number and what you are checking" className="input" />
              </ActionForm>
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="h2 mb-2">Payments</div>
        <table className="table">
          <thead><tr><th>Date</th><th>Plan</th><th>Covers</th><th>Method</th><th>Reference</th><th>By</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {pays.map((p) => <tr key={p.id}><td>{fmt(p.created_at)}</td><td>{p.plan_code}</td><td>{fmt(p.period_start)} to {fmt(p.period_end)}</td><td>{p.method}</td><td>{p.reference}</td><td>{p.recorded_by}</td><td className="text-right">{formatMoney(p.amount_minor)}</td></tr>)}
            {pays.length === 0 && <tr><td colSpan={7} className="muted">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
