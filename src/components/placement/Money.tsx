import { withTenant } from "@/lib/db";
import { formatMoney, CURRENCIES } from "@/lib/money";
import { COST_CATEGORIES, FEE_TYPES } from "@/lib/stages";
import { ActionForm } from "@/components/ActionForm";
import { Section } from "@/components/ui/Section";
import { MpesaPanel } from "@/components/placement/MpesaPanel";
import { addCost, addFeeCharge, raiseInvoice, recordPayment, reverseCost } from "@/app/actions/finance";

const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-KE") : "—");
const today = () => new Date().toISOString().slice(0, 10);

type P = { id: string; payment_model: string | null; cphone: string; placement_fee_minor: string | number | null; fee_currency: string | null; employer_currency: string | null };

/**
 * Everything about money for one placement, arranged by who pays. When the employer pays, the agency records what it
 * spends, sends an invoice and records the repayment. When the candidate pays, it adds fees, asks for them by
 * M-Pesa and records what came in. The other records sit under "More money records" so they are there but not in the way.
 */
export async function Money({ p, tenantId, canWrite, open }: { p: P; tenantId: string; canWrite: boolean; open: boolean }) {
  const fin = await withTenant(tenantId, async (tx) => ({
    costs: await tx`SELECT c.*, EXISTS (SELECT 1 FROM costs r WHERE r.reverses_id = c.id) AS reversed FROM costs c WHERE placement_id = ${p.id} ORDER BY incurred_on DESC, created_at DESC`,
    charges: await tx`SELECT * FROM fee_charges WHERE placement_id = ${p.id} ORDER BY due_on NULLS FIRST, created_at`,
    payments: await tx`SELECT * FROM payments WHERE placement_id = ${p.id} ORDER BY created_at DESC`,
    invoices: await tx`
      SELECT i.*, i.amount_minor - COALESCE((SELECT sum(amount_minor) FROM payments WHERE invoice_id = i.id), 0) AS balance
      FROM invoices i WHERE placement_id = ${p.id} ORDER BY created_at DESC`,
  }));

  const costTotal = fin.costs.filter((c) => c.currency === "KES").reduce((s, c) => s + Number(c.amount_minor), 0);
  const charged = fin.charges.reduce((s, c) => s + Number(c.amount_minor), 0);
  const paidByCandidate = fin.payments.filter((x) => x.party === "candidate").reduce((s, x) => s + Number(x.amount_minor), 0);
  const employerPays = p.payment_model === "employer_paid";
  const candidatePays = p.payment_model === "candidate_paid";
  const owing = charged - paidByCandidate;

  const status = employerPays ? `costs ${formatMoney(costTotal)}` : candidatePays ? (owing > 0 ? `${formatMoney(owing)} owed` : charged > 0 ? "fees paid" : "no fees yet") : "not set up yet";
  const tone = candidatePays && owing > 0 ? "warn" : undefined;

  const costs = (
    <div id="costs" style={{ scrollMarginTop: 80 }}>
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
                  {canWrite && !c.reverses_id && !c.reversed && (
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
      {canWrite && (
        <ActionForm confirm="Record this cost? Costs cannot be edited or deleted later, only reversed." action={addCost.bind(null, p.id)} submit="Add cost" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
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
  );

  const fees = (
    <div id="fees" style={{ scrollMarginTop: 80 }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="h2">Candidate fees</div>
        <div className="font-semibold">Charged {formatMoney(charged)} · paid {formatMoney(paidByCandidate)} · balance {formatMoney(owing)}</div>
      </div>
      <table className="table">
        <thead><tr><th>Fee</th><th>Due</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {fin.charges.map((c) => <tr key={c.id}><td>{c.fee_type}</td><td>{fmt(c.due_on)}</td><td className="text-right">{formatMoney(c.amount_minor, c.currency)}</td></tr>)}
          {fin.charges.length === 0 && <tr><td colSpan={3} className="muted">No fees charged.</td></tr>}
        </tbody>
      </table>
      {canWrite && (
        <ActionForm confirm="Add this fee? The candidate is reminded about it before it is due." action={addFeeCharge.bind(null, p.id)} submit="Add fee" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label className="label" htmlFor="fee_type">Fee type</label><select id="fee_type" name="fee_type" className="select">{FEE_TYPES.map((f) => <option key={f}>{f}</option>)}</select></div>
            <div><label className="label" htmlFor="fee_amount">Amount (KES)</label><input id="fee_amount" name="amount" required className="input" /></div>
            <div><label className="label" htmlFor="fee_due">Due date</label><input id="fee_due" name="due_on" type="date" className="input" /></div>
          </div>
        </ActionForm>
      )}
    </div>
  );

  const mpesa = <MpesaPanel placementId={p.id} tenantId={tenantId} canEdit={canWrite} candidatePhone={p.cphone} />;

  const invoices = (
    <div id="invoices" style={{ scrollMarginTop: 80 }}>
      <div className="h2 mb-2">Invoices to the employer</div>
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
      {canWrite && employerPays && (
        <ActionForm confirm="Raise this invoice to the employer? It cannot be edited afterwards." action={raiseInvoice.bind(null, p.id)} submit="Raise invoice" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
          <p className="muted text-xs">
            Costs so far {formatMoney(costTotal)}
            {Number(p.placement_fee_minor) ? ` · placement fee ${formatMoney(p.placement_fee_minor ?? 0, p.fee_currency ?? "KES")}` : ""}
          </p>
          <div className="grid sm:grid-cols-4 gap-3">
            <div><label className="label" htmlFor="inv_amount">Amount</label><input id="inv_amount" name="amount" required className="input" /></div>
            <div><label className="label" htmlFor="inv_currency">Currency</label><select id="inv_currency" name="currency" className="select" defaultValue={p.employer_currency ?? "USD"}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="fx_rate">KES per 1 unit</label><input id="fx_rate" name="fx_rate" defaultValue="1" className="input" /></div>
            <div><label className="label" htmlFor="inv_due">Due date</label><input id="inv_due" name="due_on" type="date" className="input" /></div>
          </div>
        </ActionForm>
      )}
    </div>
  );

  const payments = (
    <div id="payments" style={{ scrollMarginTop: 80 }}>
      <div className="h2 mb-2">Payments received</div>
      <table className="table">
        <thead><tr><th>Receipt</th><th>Date</th><th>From</th><th>Method</th><th>Reference</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {fin.payments.map((x) => (
            <tr key={x.id}><td>{x.receipt_no}</td><td>{fmt(x.paid_on)}</td><td>{x.party}</td><td>{x.method}</td><td>{x.reference}</td><td className="text-right">{formatMoney(x.amount_minor, x.currency)}</td></tr>
          ))}
          {fin.payments.length === 0 && <tr><td colSpan={6} className="muted">No payments yet.</td></tr>}
        </tbody>
      </table>
      {canWrite && (
        <ActionForm confirm="Record this payment and issue a receipt? The candidate may be messaged." action={recordPayment.bind(null, p.id)} submit="Record payment" className="grid gap-3 mt-3 pt-3 border-t border-[var(--line)]">
          <div className="h2">Record a payment</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label className="label" htmlFor="party">Paid by</label><select id="party" name="party" className="select" defaultValue={employerPays ? "employer" : "candidate"}><option value="candidate">Candidate</option><option value="employer">Employer</option></select></div>
            <div><label className="label" htmlFor="method">Method</label><select id="method" name="method" className="select"><option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="bank">Bank</option></select></div>
            <div><label className="label" htmlFor="pay_amount">Amount</label><input id="pay_amount" name="amount" required className="input" /></div>
            <div><label className="label" htmlFor="reference">M-Pesa code / reference</label><input id="reference" name="reference" className="input" /></div>
            <div><label className="label" htmlFor="paid_on">Date</label><input id="paid_on" name="paid_on" type="date" defaultValue={today()} className="input" /></div>
            {employerPays && (
              <div>
                <label className="label" htmlFor="invoice_id">Against invoice</label>
                <select id="invoice_id" name="invoice_id" className="select" defaultValue={fin.invoices.find((i) => i.status === "open")?.id ?? ""} key={fin.invoices.map((i) => i.id + i.status).join()}>
                  <option value="">—</option>
                  {fin.invoices.filter((i) => i.status === "open").map((i) => <option key={i.id} value={i.id}>{i.number}</option>)}
                </select>
              </div>
            )}
          </div>
        </ActionForm>
      )}
    </div>
  );

  const more = (label: string, children: React.ReactNode) => (
    <details className="mt-5 pt-4 border-t border-[var(--line)]">
      <summary className="cursor-pointer muted">{label}</summary>
      <div className="grid gap-6 mt-4">{children}</div>
    </details>
  );

  return (
    <Section id="money" title="Money" status={status} tone={tone} open={open}>
      {!employerPays && !candidatePays && (
        <p className="muted">Money options appear once the candidate is matched to a job, because the job order says who pays the costs. You can still record costs and payments below.</p>
      )}
      <div className="grid gap-6">
        {employerPays && <>{costs}{invoices}{payments}</>}
        {candidatePays && <>{fees}{mpesa}{payments}</>}
        {!employerPays && !candidatePays && <>{costs}{payments}</>}
      </div>
      {employerPays && more("More money records", <>{fees}{mpesa}</>)}
      {candidatePays && more("More money records", <>{costs}{invoices}</>)}
    </Section>
  );
}
