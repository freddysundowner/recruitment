import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { getAccess, isSingleInstall } from "@/lib/plan";
import { formatMoney } from "@/lib/money";
import { mockMode } from "@/lib/mpesa";
import { creditsFor, getPlatformConfig } from "@/lib/platform-config";
import { ActionForm } from "@/components/ActionForm";
import { buyCredits, checkSubscriptionStk, payWithCard, payWithMpesa, simulateSubscriptionStk } from "@/app/actions/billing";

const fmt = (d: unknown) => new Date(d as string).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
const FEATURES: [string, string][] = [
  ["candidate_portal", "Candidate portal"], ["employer_portal", "Employer portal"], ["mpesa", "M-Pesa collection"], ["whatsapp", "WhatsApp messages"], ["reports", "Reports"], ["exports", "CSV exports"],
];

export default async function Billing({ searchParams }: PageProps<"/billing">) {
  const ctx = await requireCtx();
  if (!can(ctx.role, "users:manage") || isSingleInstall()) redirect("/");
  const sp = await searchParams;
  const a = await getAccess(ctx.tenantId);
  const d = await withTenant(ctx.tenantId, async (tx) => ({
    plans: await tx`SELECT * FROM plans WHERE active ORDER BY sort`,
    pays: await tx`SELECT * FROM subscription_payments ORDER BY created_at DESC LIMIT 20`,
    reqs: await tx`SELECT * FROM mpesa_requests WHERE purpose IN ('subscription', 'sms_credits') ORDER BY created_at DESC LIMIT 4`,
    credits: (await tx`SELECT sms_credits FROM tenants WHERE id = ${ctx.tenantId}`)[0].sms_credits as number,
    ledger: await tx`SELECT * FROM sms_credit_ledger ORDER BY created_at DESC LIMIT 8`,
    usage: (await tx`SELECT (SELECT count(*) FROM users WHERE role <> 'employer' AND status = 'active') AS users, (SELECT count(*) FROM candidates WHERE status <> 'inactive') AS candidates`)[0],
  }));
  const cfg = await getPlatformConfig();
  const canMpesa = Boolean(cfg.mpesa) || mockMode();
  const stripeOn = Boolean(cfg.stripe);
  const packs = [100, 250, 500, 1000, 2000];
  const status = a.writable ? (a.daysLeft > 0 ? (a.status === "trialing" ? `Free trial, ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} left` : `Active until ${fmt(a.periodEnd)}`) : `Ended ${fmt(a.periodEnd)}, read-only in ${Math.max(0, 7 + a.daysLeft)} days`) : "Read-only until you pay";
  const selected = typeof sp.plan === "string" ? sp.plan : a.planCode;

  return (
    <div className="grid gap-4">
      <PageHeader title="Billing" sub="Your plan, what it includes, and how to pay for it." />
      {sp.paid && <div className="badge badge-good w-fit">Thank you. Your card payment will show here in a moment.</div>}
      <div className="card grid sm:grid-cols-3 gap-3">
        <div><div className="muted text-xs font-semibold">Plan</div><div className="text-xl font-bold">{a.planName}</div></div>
        <div><div className="muted text-xs font-semibold">Status</div><div className={`font-semibold ${a.writable ? "" : "text-[var(--bad)]"}`}>{status}</div></div>
        <div><div className="muted text-xs font-semibold">Using</div>
          <div>{Number(d.usage.users)}{a.maxUsers ? ` of ${a.maxUsers}` : ""} staff · {Number(d.usage.candidates)}{a.maxCandidates ? ` of ${a.maxCandidates}` : ""} candidates</div></div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {d.plans.map((p) => (
          <div key={p.code} className={`card ${p.code === a.planCode ? "!border-[var(--brand)] !border-2" : ""}`}>
            <div className="flex items-baseline justify-between"><div className="h2">{p.name}</div>{p.code === a.planCode && <span className="badge badge-good">current</span>}</div>
            <div className="text-2xl font-bold mt-1">{formatMoney(p.price_kes_minor)}<span className="muted text-xs font-normal"> / month</span></div>
            <ul className="mt-2 text-sm grid gap-1">
              <li>{p.max_users ?? "Unlimited"} staff accounts</li>
              <li>{p.max_candidates ? `${Number(p.max_candidates).toLocaleString("en-KE")} candidates` : "Unlimited candidates"}</li>
              {FEATURES.map(([k, l]) => <li key={k} className={p.features[k] ? "" : "muted line-through"}>{l}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <div className="card grid gap-3">
        <div className="h2">Pay for your plan</div>
        <p className="muted text-sm">Paying extends your plan from the day your current period ends, so nothing is lost by paying early. Changing plan takes effect straight away.</p>
        <div className="grid lg:grid-cols-2 gap-4">
          {canMpesa && (
            <ActionForm confirm="Send an M-Pesa payment request to this phone number now?" action={payWithMpesa} submit="Pay with M-Pesa" className="grid gap-3" resetOnSuccess={false}>
              <div className="h2">M-Pesa {mockMode() && <span className="badge badge-warn">demo</span>}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label" htmlFor="m_plan">Plan</label><select id="m_plan" name="plan" className="select" defaultValue={selected}>{d.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
                <div><label className="label" htmlFor="m_months">Months</label><select id="m_months" name="months" className="select" defaultValue="1">{[1, 3, 6, 12].map((m) => <option key={m}>{m}</option>)}</select></div>
                <div className="col-span-2"><label className="label" htmlFor="m_phone">M-Pesa number</label><input id="m_phone" name="phone" type="tel" className="input" placeholder="0712 345 678" /></div>
              </div>
            </ActionForm>
          )}
          {stripeOn && (
            <ActionForm action={payWithCard} submit="Pay by card" buttonClass="btn" className="grid gap-3" resetOnSuccess={false}>
              <div className="h2">Card</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label" htmlFor="c_plan">Plan</label><select id="c_plan" name="plan" className="select" defaultValue={selected}>{d.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
                <div><label className="label" htmlFor="c_months">Months</label><select id="c_months" name="months" className="select" defaultValue="1">{[1, 3, 6, 12].map((m) => <option key={m}>{m}</option>)}</select></div>
              </div>
            </ActionForm>
          )}
        </div>
        {process.env.BANK_DETAILS && <div><div className="h2">Bank transfer</div><p className="whitespace-pre-wrap text-sm">{process.env.BANK_DETAILS}</p><p className="muted text-xs">Send the transfer reference to support so your plan can be extended.</p></div>}
        {!canMpesa && !stripeOn && !process.env.BANK_DETAILS && <p className="muted">Online payment is not set up yet. Contact support to pay.</p>}
        {d.reqs.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`badge ${r.status === "success" ? "badge-good" : r.status === "pending" ? "badge-warn" : "badge-bad"}`}>{r.purpose === "sms_credits" ? "Credits" : "Plan"} · M-Pesa {r.status}</span>
            {formatMoney(r.amount_minor)} · {fmt(r.created_at)} {r.mpesa_receipt && <span className="muted">{r.mpesa_receipt}</span>}
            {r.status === "pending" && (
              <span className="inline-flex gap-1">
                <ActionForm action={checkSubscriptionStk.bind(null, r.id)} submit="Check status" buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                {mockMode() && <ActionForm action={simulateSubscriptionStk.bind(null, r.id, "pay")} submit="Simulate: pays" buttonClass="btn btn-sm" className="inline"><></></ActionForm>}
              </span>
            )}
          </div>
        ))}
      </div>

      <div id="credits" className="card grid gap-3" style={{ scrollMarginTop: 80 }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="h2">SMS credits</div>
            <p className="muted text-sm">Each text uses one credit (a long text uses more). Credits cost KES {(cfg.credits.priceMinor / 100).toFixed(2)} each and are added as soon as your M-Pesa payment is confirmed.</p>
          </div>
          <div className="text-right"><div className="text-[28px] font-bold leading-none">{Number(d.credits).toLocaleString("en-KE")}</div><div className="muted text-xs mt-1">credits left</div></div>
        </div>
        {canMpesa ? (
          <ActionForm confirm="Send an M-Pesa payment request to this phone number now?" action={buyCredits} submit="Buy credits with M-Pesa" className="grid gap-3" resetOnSuccess={false}>
            <div className="flex flex-wrap gap-2">
              {packs.map((k, i) => (
                <label key={k} className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 cursor-pointer has-[:checked]:border-[var(--brand)] has-[:checked]:bg-[var(--brand-soft)]">
                  <input type="radio" name="pack" value={k} defaultChecked={i === 0} />
                  <span><b>KES {k.toLocaleString("en-KE")}</b><span className="muted text-xs block">{creditsFor(k * 100, cfg.credits.priceMinor).toLocaleString("en-KE")} credits</span></span>
                </label>
              ))}
              <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 has-[:checked]:border-[var(--brand)] has-[:checked]:bg-[var(--brand-soft)]">
                <input type="radio" name="pack" value="other" />
                <span><b>Other</b><input name="other" type="number" min={40} max={50000} placeholder="KES" className="input mt-1" style={{ width: 110 }} /></span>
              </label>
            </div>
            <div className="max-w-xs"><label className="label" htmlFor="cr_phone">M-Pesa number</label><input id="cr_phone" name="phone" type="tel" className="input" placeholder="0712 345 678" /></div>
          </ActionForm>
        ) : <p className="muted">Buying credits online is not set up yet. Contact support.</p>}
        {d.ledger.length > 0 && (
          <details>
            <summary className="cursor-pointer muted text-sm">Recent credit activity</summary>
            <table className="table mt-2"><tbody>
              {d.ledger.map((l) => (
                <tr key={l.id}><td>{fmt(l.created_at)}</td><td>{{ signup_grant: "Welcome credits", purchase: "Bought", sms_sent: "Text sent", refund: "Refunded", admin: "Added by support" }[l.reason as string]}</td><td className={`text-right font-semibold ${l.delta > 0 ? "text-[var(--good)]" : ""}`}>{l.delta > 0 ? "+" : ""}{l.delta}</td><td className="text-right muted">{l.balance_after}</td></tr>
              ))}
            </tbody></table>
          </details>
        )}
      </div>

      <div className="card overflow-x-auto">
        <div className="h2 mb-2">Payments</div>
        <table className="table">
          <thead><tr><th>Date</th><th>Plan</th><th>Covers</th><th>Method</th><th>Reference</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {d.pays.map((p) => (
              <tr key={p.id}><td>{fmt(p.created_at)}</td><td>{p.plan_code}</td><td>{fmt(p.period_start)} to {fmt(p.period_end)}</td><td>{p.method}</td><td>{p.reference}</td><td className="text-right">{formatMoney(p.amount_minor)}</td></tr>
            ))}
            {d.pays.length === 0 && <tr><td colSpan={6} className="muted">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
