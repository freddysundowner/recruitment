import { withCandidate } from "@/lib/db";
import { requireCandidate } from "@/lib/portal-session";
import { balanceDue } from "@/lib/pipeline";
import { formatMoney } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { portalPay } from "@/app/actions/portal";

const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-KE") : "—");

export default async function Payments({ params }: PageProps<"/c/[slug]/payments">) {
  const { slug } = await params;
  const { agency, me } = await requireCandidate(slug);
  const d = await withCandidate(agency.id, me.candidateId, async (tx) => {
    const [p] = await tx`SELECT id FROM placements WHERE outcome <> 'closed' ORDER BY created_at DESC LIMIT 1`;
    return {
      p,
      charges: await tx`SELECT fee_type, amount_minor, due_on FROM fee_charges ORDER BY due_on NULLS FIRST, created_at`,
      pays: await tx`SELECT receipt_no, paid_on, method, amount_minor, reference FROM payments ORDER BY created_at DESC`,
      reqs: await tx`SELECT status, amount_minor, created_at, result_desc FROM mpesa_requests ORDER BY created_at DESC LIMIT 3`,
      due: p ? await balanceDue(tx, p.id) : 0,
    };
  });
  const charged = d.charges.reduce((s, c) => s + Number(c.amount_minor), 0);
  const paid = d.pays.reduce((s, c) => s + Number(c.amount_minor), 0);
  const pending = d.reqs.find((r) => r.status === "pending");
  return (
    <>
      <h1 className="h1">My payments</h1>
      <div className="card grid grid-cols-3 gap-3 text-center">
        <div><div className="muted text-xs">Charged</div><div className="font-bold">{formatMoney(charged)}</div></div>
        <div><div className="muted text-xs">Paid</div><div className="font-bold text-[var(--good)]">{formatMoney(paid)}</div></div>
        <div><div className="muted text-xs">Still to pay</div><div className="font-bold">{formatMoney(Math.max(charged - paid, 0))}</div></div>
      </div>
      {d.p && d.due > 0 && (
        <div className="card grid gap-2">
          <div className="h2">Pay with M-Pesa</div>
          <p className="muted text-sm">{formatMoney(d.due)} is due now. You will get a prompt on your phone to enter your M-Pesa PIN.</p>
          {pending && <div className="badge badge-warn w-fit">A payment of {formatMoney(pending.amount_minor)} is waiting for your PIN</div>}
          <ActionForm confirm="Send an M-Pesa payment request to your phone now?" action={portalPay.bind(null, slug, d.p.id)} submit="Pay now" resetOnSuccess={false}>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="phone">M-Pesa number</label><input id="phone" name="phone" type="tel" defaultValue={me.phone} className="input !py-3" /></div>
              <div><label className="label" htmlFor="amount">Amount (KES)</label><input id="amount" name="amount" defaultValue={Math.ceil(d.due / 100)} className="input !py-3" /></div>
            </div>
          </ActionForm>
        </div>
      )}
      <div className="card">
        <div className="h2 mb-2">Fees</div>
        {d.charges.map((c, i) => <div key={i} className="flex justify-between border-b border-[var(--line)] py-1.5 last:border-0"><span>{c.fee_type}<span className="muted text-xs"> · due {fmt(c.due_on)}</span></span><b>{formatMoney(c.amount_minor)}</b></div>)}
        {d.charges.length === 0 && <p className="muted">Nothing has been charged.</p>}
      </div>
      <div className="card">
        <div className="h2 mb-2">Receipts</div>
        {d.pays.map((x) => <div key={x.receipt_no} className="flex justify-between border-b border-[var(--line)] py-1.5 last:border-0"><span><b>{x.receipt_no}</b><span className="muted text-xs"> · {fmt(x.paid_on)} · {x.method} {x.reference}</span></span><b>{formatMoney(x.amount_minor)}</b></div>)}
        {d.pays.length === 0 && <p className="muted">No payments yet. Always ask for a receipt number when you pay.</p>}
      </div>
    </>
  );
}
