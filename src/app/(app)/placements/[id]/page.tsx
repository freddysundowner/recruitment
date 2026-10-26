import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { formatMoney, CURRENCIES } from "@/lib/money";
import { CLOSE_REASONS, COST_CATEGORIES, FEE_TYPES } from "@/lib/stages";
import { ActionForm } from "@/components/ActionForm";
import { Operations } from "@/components/placement/Operations";
import { MpesaPanel } from "@/components/placement/MpesaPanel";
import { closePlacement, moveStageAction } from "@/app/actions/placements";
import { addCost, addFeeCharge, raiseInvoice, recordPayment, reverseCost } from "@/app/actions/finance";

const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-KE") : "—");
const today = () => new Date().toISOString().slice(0, 10);

export default async function Placement({ params }: PageProps<"/placements/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const money = can(ctx.role, "finance:read");

  const d = await withTenant(ctx.tenantId, async (tx) => {
    const [p] = await tx`
      SELECT p.*, c.first_name, c.last_name, c.phone AS cphone, c.id AS cid, s.name AS stage, s.position, s.description, s.required_doc_types,
             j.title, j.country, j.placement_fee_minor, j.fee_currency, e.company, e.currency AS employer_currency, e.vetted
      FROM placements p JOIN candidates c ON c.id = p.candidate_id JOIN pipeline_stages s ON s.id = p.stage_id
      LEFT JOIN job_orders j ON j.id = p.job_order_id LEFT JOIN employers e ON e.id = j.employer_id
      WHERE p.id = ${id}`;
    if (!p) return null;
    const stages = await tx`SELECT id, position, name FROM pipeline_stages ORDER BY position`;
    const history = await tx`
      SELECT h.*, f.name AS from_name, t.name AS to_name, u.name AS who
      FROM stage_history h LEFT JOIN pipeline_stages f ON f.id = h.from_stage_id
      LEFT JOIN pipeline_stages t ON t.id = h.to_stage_id LEFT JOIN users u ON u.id = h.user_id
      WHERE h.placement_id = ${id} ORDER BY h.created_at DESC`;
    let fin = null;
    if (money) {
      fin = {
        costs: await tx`SELECT c.*, EXISTS (SELECT 1 FROM costs r WHERE r.reverses_id = c.id) AS reversed FROM costs c WHERE placement_id = ${id} ORDER BY incurred_on DESC, created_at DESC`,
        charges: await tx`SELECT * FROM fee_charges WHERE placement_id = ${id} ORDER BY due_on NULLS FIRST, created_at`,
        payments: await tx`SELECT * FROM payments WHERE placement_id = ${id} ORDER BY created_at DESC`,
        invoices: await tx`
          SELECT i.*, i.amount_minor - COALESCE((SELECT sum(amount_minor) FROM payments WHERE invoice_id = i.id), 0) AS balance
          FROM invoices i WHERE placement_id = ${id} ORDER BY created_at DESC`,
      };
    }
    return { p, stages, history, fin };
  });
  if (!d) notFound();
  const { p, stages, history, fin } = d;
  const closed = p.outcome === "closed";
  const move = can(ctx.role, "pipeline:move") && !closed;
  const write = can(ctx.role, "finance:write") && !closed;
  const admin = can(ctx.role, "pipeline:override");

  const costTotal = fin ? fin.costs.filter((c) => c.currency === "KES").reduce((s, c) => s + Number(c.amount_minor), 0) : 0;
  const charged = fin ? fin.charges.reduce((s, c) => s + Number(c.amount_minor), 0) : 0;
  const paidByCandidate = fin ? fin.payments.filter((x) => x.party === "candidate").reduce((s, x) => s + Number(x.amount_minor), 0) : 0;

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="h1"><Link className="link" href={`/candidates/${p.cid}`}>{p.first_name} {p.last_name}</Link></h1>
          <div className="muted">
            {p.title ? `${p.title} · ${p.company} · ${p.country}` : "No job order assigned yet"}
            {p.payment_model && <span className="badge ml-2">{p.payment_model === "employer_paid" ? "Employer pays costs" : "Candidate pays costs"}</span>}
            {p.company && !p.vetted && <span className="badge badge-warn ml-2">employer not vetted</span>}
          </div>
        </div>
        <span className={`badge ${closed ? "badge-bad" : p.outcome === "deployed" ? "badge-good" : ""}`}>{closed ? `Closed: ${p.close_reason}` : p.outcome}</span>
      </div>

      <div id="stage" style={{ scrollMarginTop: 80 }} className="card">
        <div className="h2 mb-3">Stage</div>
        <ol className="flex flex-wrap gap-2 mb-3">
          {stages.map((s) => (
            <li key={s.id} className={`badge ${s.position < p.position ? "badge-good" : s.position === p.position ? "!bg-[var(--brand)] !text-white" : ""}`}>
              {s.position} {s.name}
            </li>
          ))}
        </ol>
        <p className="muted mb-3">{p.description}</p>
        {move && (
          <ActionForm action={moveStageAction.bind(null, p.id)} submit="Move" className="grid gap-3 sm:grid-cols-[220px_1fr_auto] items-end">
            <div>
              <label className="label" htmlFor="stage_id">Move to</label>
              <select id="stage_id" name="stage_id" className="select" defaultValue={stages.find((s) => s.position === p.position + 1)?.id ?? ""}>
                {stages.filter((s) => s.position !== p.position).map((s) => <option key={s.id} value={s.id}>{s.position}. {s.name}</option>)}
              </select>
            </div>
            <div><label className="label" htmlFor="note">Note (required to override)</label><input id="note" name="note" className="input" /></div>
            {admin && <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="override" /> Override gates</label>}
          </ActionForm>
        )}
        <details className="mt-4">
          <summary className="cursor-pointer muted">History ({history.length})</summary>
          <table className="table mt-2">
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap">{new Date(h.created_at).toLocaleString("en-KE")}</td>
                  <td>{h.from_name ? `${h.from_name} → ` : ""}{h.to_name}{h.override && <span className="badge badge-warn ml-2">override</span>}</td>
                  <td>{h.who}</td>
                  <td className="muted">{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>

      <Operations placementId={p.id} tenantId={ctx.tenantId} canEdit={move} stageRequiredDocs={(p.required_doc_types as string[]) ?? []} candidateId={p.cid} />

      {fin && (
        <>
          <div id="costs" style={{ scrollMarginTop: 80 }} className="card">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
              <div className="h2">Costs paid out</div>
              <div className="font-semibold">Total {formatMoney(costTotal)}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Date</th><th>Category</th><th>Payee</th><th>Receipt</th><th className="text-right">Amount</th><th></th></tr></thead>
                <tbody>
                  {fin.costs.map((c) => (
                    <tr key={c.id} className={c.reverses_id || c.reversed ? "muted" : ""}>
                      <td>{fmt(c.incurred_on)}</td><td>{c.category}</td><td>{c.payee}</td><td>{c.receipt_ref}</td>
                      <td className="text-right">{formatMoney(c.amount_minor, c.currency)}</td>
                      <td className="text-right">
                        {write && !c.reverses_id && !c.reversed && (
                          <ActionForm action={reverseCost.bind(null, c.id, p.id)} submit="Reverse" buttonClass="btn btn-sm btn-danger" className="inline" confirm="Reverse this cost? A negative entry is added; nothing is deleted."><></></ActionForm>
                        )}
                        {c.reversed && <span className="badge">reversed</span>}
                      </td>
                    </tr>
                  ))}
                  {fin.costs.length === 0 && <tr><td colSpan={6} className="muted">No costs recorded.</td></tr>}
                </tbody>
              </table>
            </div>
            {write && (
              <ActionForm action={addCost.bind(null, p.id)} submit="Add cost" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
                <div className="grid sm:grid-cols-5 gap-3">
                  <div><label className="label" htmlFor="category">Category</label><select id="category" name="category" className="select">{COST_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                  <div><label className="label" htmlFor="amount">Amount</label><input id="amount" name="amount" required placeholder="4500.00" className="input" /></div>
                  <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="select" defaultValue="KES">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                  <div><label className="label" htmlFor="payee">Paid to</label><input id="payee" name="payee" className="input" /></div>
                  <div><label className="label" htmlFor="receipt_ref">Receipt ref</label><input id="receipt_ref" name="receipt_ref" className="input" /></div>
                </div>
              </ActionForm>
            )}
          </div>

          {(p.payment_model === "candidate_paid" || fin.charges.length > 0) && (
            <div id="fees" style={{ scrollMarginTop: 80 }} className="card">
              <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
                <div className="h2">Candidate fees</div>
                <div className="font-semibold">Charged {formatMoney(charged)} · paid {formatMoney(paidByCandidate)} · balance {formatMoney(charged - paidByCandidate)}</div>
              </div>
              <table className="table">
                <thead><tr><th>Fee</th><th>Due</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {fin.charges.map((c) => <tr key={c.id}><td>{c.fee_type}</td><td>{fmt(c.due_on)}</td><td className="text-right">{formatMoney(c.amount_minor, c.currency)}</td></tr>)}
                  {fin.charges.length === 0 && <tr><td colSpan={3} className="muted">No fees charged.</td></tr>}
                </tbody>
              </table>
              {write && (
                <ActionForm action={addFeeCharge.bind(null, p.id)} submit="Add fee" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div><label className="label" htmlFor="fee_type">Fee type</label><select id="fee_type" name="fee_type" className="select">{FEE_TYPES.map((f) => <option key={f}>{f}</option>)}</select></div>
                    <div><label className="label" htmlFor="fee_amount">Amount (KES)</label><input id="fee_amount" name="amount" required className="input" /></div>
                    <div><label className="label" htmlFor="fee_due">Due date</label><input id="fee_due" name="due_on" type="date" className="input" /></div>
                  </div>
                </ActionForm>
              )}
            </div>
          )}

          {!closed && <MpesaPanel placementId={p.id} tenantId={ctx.tenantId} canEdit={write} candidatePhone={p.cphone} />}

          <div id="invoices" style={{ scrollMarginTop: 80 }} className="card">
            <div className="h2 mb-2">Invoices and payments</div>
            <table className="table">
              <thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th className="text-right">Amount</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
              <tbody>
                {fin.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{i.number}</td><td>{fmt(i.issued_on)}</td><td>{fmt(i.due_on)}</td>
                    <td className="text-right">{formatMoney(i.amount_minor, i.currency)}</td>
                    <td className="text-right">{formatMoney(i.balance, i.currency)}</td>
                    <td><span className={`badge ${i.status === "paid" ? "badge-good" : ""}`}>{i.status}</span></td>
                  </tr>
                ))}
                {fin.invoices.length === 0 && <tr><td colSpan={6} className="muted">No invoices.</td></tr>}
              </tbody>
            </table>
            <div className="h2 mt-4 mb-2">Payments received</div>
            <table className="table">
              <thead><tr><th>Receipt</th><th>Date</th><th>From</th><th>Method</th><th>Reference</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {fin.payments.map((x) => (
                  <tr key={x.id}><td>{x.receipt_no}</td><td>{fmt(x.paid_on)}</td><td>{x.party}</td><td>{x.method}</td><td>{x.reference}</td><td className="text-right">{formatMoney(x.amount_minor, x.currency)}</td></tr>
                ))}
                {fin.payments.length === 0 && <tr><td colSpan={6} className="muted">No payments yet.</td></tr>}
              </tbody>
            </table>
            {write && (
              <div className="grid lg:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--line)]">
                <ActionForm action={recordPayment.bind(null, p.id)} submit="Record payment" className="grid gap-3">
                  <div className="h2">Record a payment</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="label" htmlFor="party">Paid by</label><select id="party" name="party" className="select"><option value="candidate">Candidate</option><option value="employer">Employer</option></select></div>
                    <div><label className="label" htmlFor="method">Method</label><select id="method" name="method" className="select"><option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="bank">Bank</option></select></div>
                    <div><label className="label" htmlFor="pay_amount">Amount</label><input id="pay_amount" name="amount" required className="input" /></div>
                    <div><label className="label" htmlFor="reference">M-Pesa code / reference</label><input id="reference" name="reference" className="input" /></div>
                    <div><label className="label" htmlFor="paid_on">Date</label><input id="paid_on" name="paid_on" type="date" defaultValue={today()} className="input" /></div>
                    <div>
                      <label className="label" htmlFor="invoice_id">Invoice (employer)</label>
                      <select id="invoice_id" name="invoice_id" className="select" defaultValue="">
                        <option value="">—</option>
                        {fin.invoices.filter((i) => i.status === "open").map((i) => <option key={i.id} value={i.id}>{i.number}</option>)}
                      </select>
                    </div>
                  </div>
                </ActionForm>
                {p.payment_model === "employer_paid" && (
                  <ActionForm action={raiseInvoice.bind(null, p.id)} submit="Raise invoice" className="grid gap-3">
                    <div className="h2">Raise an invoice to the employer</div>
                    <p className="muted text-xs">
                      Costs so far {formatMoney(costTotal)}
                      {Number(p.placement_fee_minor) ? ` · placement fee ${formatMoney(p.placement_fee_minor, p.fee_currency)}` : ""}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="label" htmlFor="inv_amount">Amount</label><input id="inv_amount" name="amount" required className="input" /></div>
                      <div><label className="label" htmlFor="inv_currency">Currency</label><select id="inv_currency" name="currency" className="select" defaultValue={p.employer_currency ?? "USD"}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                      <div><label className="label" htmlFor="fx_rate">KES per 1 unit</label><input id="fx_rate" name="fx_rate" defaultValue="1" className="input" /></div>
                      <div><label className="label" htmlFor="inv_due">Due date</label><input id="inv_due" name="due_on" type="date" className="input" /></div>
                    </div>
                  </ActionForm>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {move && (
        <details className="card">
          <summary className="h2 cursor-pointer">Close this placement</summary>
          <ActionForm action={closePlacement.bind(null, p.id)} submit="Close placement" buttonClass="btn btn-danger" className="grid gap-3 mt-3 max-w-lg" confirm="Close this placement? Costs stay on the ledger.">
            <div><label className="label" htmlFor="reason">Reason</label><select id="reason" name="reason" className="select">{CLOSE_REASONS.map((r) => <option key={r}>{r}</option>)}</select></div>
            <div><label className="label" htmlFor="close_note">Note</label><input id="close_note" name="note" className="input" /></div>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
