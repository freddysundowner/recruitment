import type { Sql } from "./db";
import { nextNumber } from "./audit";
import { notifyCandidate } from "./notify";
import type { StkCallback } from "./mpesa";

/**
 * Records the outcome of an STK push. Safe to call more than once for the same request
 * (Safaricom can retry, and the worker also checks): only the first result counts.
 * Runs inside a tenant transaction, and is shared by the callback route, the worker and the demo simulator.
 */
export async function applyMpesaResult(tx: Sql, tenantId: string, requestId: string, r: Omit<StkCallback, "checkoutRequestId">): Promise<"applied" | "ignored" | "amount_mismatch"> {
  const [req] = await tx`SELECT * FROM mpesa_requests WHERE id = ${requestId} FOR UPDATE`;
  if (!req || req.status !== "pending") return "ignored";

  if (r.resultCode !== 0) {
    const status = r.resultCode === 1032 ? "cancelled" : "failed";
    await tx`UPDATE mpesa_requests SET status = ${status}, result_code = ${r.resultCode}, result_desc = ${r.resultDesc}, completed_at = now() WHERE id = ${requestId}`;
    return "applied";
  }

  // A success for a different amount than we asked for is not trusted: it is held for a person to look at.
  if (r.amount !== undefined && Math.round(r.amount * 100) !== Number(req.amount_minor)) {
    await tx`UPDATE mpesa_requests SET status = 'failed', result_code = ${r.resultCode}, result_desc = ${`Amount mismatch: expected ${Number(req.amount_minor) / 100}, got ${r.amount}. Receipt ${r.receipt ?? "n/a"}`}, mpesa_receipt = ${r.receipt ?? null}, completed_at = now() WHERE id = ${requestId}`;
    return "amount_mismatch";
  }

  if (req.purpose === "candidate_fee" && req.placement_id) {
    const receiptNo = await nextNumber(tx, tenantId, "receipt", "RCT");
    const [pay] = await tx`
      INSERT INTO payments (tenant_id, receipt_no, party, placement_id, method, amount_minor, currency, reference, created_by)
      VALUES (${tenantId}, ${receiptNo}, 'candidate', ${req.placement_id}, 'mpesa', ${req.amount_minor}, 'KES', ${r.receipt ?? `STK:${req.checkout_request_id}`}, ${req.created_by})
      RETURNING id`;
    await tx`UPDATE mpesa_requests SET status = 'success', result_code = 0, result_desc = ${r.resultDesc}, mpesa_receipt = ${r.receipt ?? null}, payment_id = ${pay.id}, completed_at = now() WHERE id = ${requestId}`;
    if (req.candidate_id) {
      const [c] = await tx`SELECT id, first_name, phone, email FROM candidates WHERE id = ${req.candidate_id}`;
      if (c) {
        await notifyCandidate(tx, tenantId, { id: c.id, name: c.first_name, phone: c.phone, email: c.email }, "payment_received",
          { amount: `KES ${(Number(req.amount_minor) / 100).toLocaleString("en-KE")}`, receipt: receiptNo });
      }
    }
  } else if (req.purpose === "subscription") {
    const meta = req.meta as { plan: string; months: number };
    await tx`SELECT platform_record_payment(${tenantId}, ${req.amount_minor}, 'mpesa', ${r.receipt ?? `STK:${req.checkout_request_id}`}, ${meta.months}, ${meta.plan}, 'mpesa')`;
    await tx`UPDATE mpesa_requests SET status = 'success', result_code = 0, result_desc = ${r.resultDesc}, mpesa_receipt = ${r.receipt ?? null}, completed_at = now() WHERE id = ${requestId}`;
  } else {
    await tx`UPDATE mpesa_requests SET status = 'success', result_code = 0, result_desc = ${r.resultDesc}, mpesa_receipt = ${r.receipt ?? null}, completed_at = now() WHERE id = ${requestId}`;
  }
  await tx`INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, detail)
           VALUES (${tenantId}, ${req.created_by}, 'mpesa.success', 'mpesa_request', ${requestId}, ${tx.json({ receipt: r.receipt ?? null, amount_minor: Number(req.amount_minor) } as never)})`;
  return "applied";
}
