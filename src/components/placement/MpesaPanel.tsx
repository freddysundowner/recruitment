import { withTenant } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { balanceDue } from "@/lib/pipeline";
import { configFromSettings, mockMode } from "@/lib/mpesa";
import { ActionForm } from "@/components/ActionForm";
import { checkStk, simulateStk, startStk } from "@/app/actions/mpesa";

export async function MpesaPanel({ placementId, tenantId, canEdit, candidatePhone }: { placementId: string; tenantId: string; canEdit: boolean; candidatePhone: string }) {
  const d = await withTenant(tenantId, async (tx) => ({
    reqs: await tx`SELECT * FROM mpesa_requests WHERE placement_id = ${placementId} ORDER BY created_at DESC LIMIT 6`,
    due: await balanceDue(tx, placementId),
    configured: Boolean(configFromSettings((await tx`SELECT settings FROM tenants WHERE id = ${tenantId}`)[0].settings)),
  }));
  const mock = mockMode();
  const suggested = d.due > 0 ? String(Math.ceil(d.due / 100)) : "";

  return (
    <div id="mpesa" style={{ scrollMarginTop: 80 }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="h2">M-Pesa</div>
        {mock && <span className="badge badge-warn">Demo mode: no money moves</span>}
        {!mock && !d.configured && <span className="badge badge-warn">Not set up: add the paybill or till in Settings</span>}
      </div>
      {d.reqs.length > 0 && (
        <table className="table mb-2">
          <tbody>
            {d.reqs.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{r.phone}</td>
                <td>{formatMoney(r.amount_minor)}</td>
                <td>
                  <span className={`badge ${r.status === "success" ? "badge-good" : r.status === "pending" ? "badge-warn" : "badge-bad"}`}>{r.status}</span>
                  {r.mpesa_receipt && <span className="muted text-xs ml-2">{r.mpesa_receipt}</span>}
                  {r.status !== "pending" && r.status !== "success" && r.result_desc && <div className="muted text-xs">{r.result_desc}</div>}
                </td>
                <td className="text-right whitespace-nowrap">
                  {canEdit && r.status === "pending" && (
                    <span className="inline-flex gap-1">
                      <ActionForm action={checkStk.bind(null, r.id, placementId)} submit="Check status" buttonClass="btn btn-sm" className="inline"><></></ActionForm>
                      {mock && <ActionForm action={simulateStk.bind(null, r.id, placementId, "pay")} submit="Simulate: customer pays" buttonClass="btn btn-sm" className="inline"><></></ActionForm>}
                      {mock && <ActionForm action={simulateStk.bind(null, r.id, placementId, "cancel")} submit="Simulate: cancels" buttonClass="btn btn-sm" className="inline"><></></ActionForm>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <ActionForm confirm="Send an M-Pesa payment request to this phone number now?" action={startStk.bind(null, placementId)} submit="Send M-Pesa request" className="grid gap-3 pt-2 border-t border-[var(--line)]">
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <div><label className="label" htmlFor="mp_phone">Customer&apos;s M-Pesa number</label><input id="mp_phone" name="phone" defaultValue={candidatePhone} className="input" /></div>
            <div><label className="label" htmlFor="mp_amount">Amount (KES){d.due > 0 ? `, due now ${formatMoney(d.due)}` : ""}</label><input id="mp_amount" name="amount" defaultValue={suggested} className="input" /></div>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
