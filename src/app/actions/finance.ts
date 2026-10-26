"use server";

import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { requireCan } from "@/lib/session";
import { audit, nextNumber } from "@/lib/audit";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { formatMoney, toMinor } from "@/lib/money";
import { notifyCandidate } from "@/lib/notify";

function refresh(placementId: string) {
  revalidatePath(`/placements/${placementId}`);
  revalidatePath("/finance");
  revalidatePath("/");
}

function amount(fd: FormData, name = "amount"): number | { error: string } {
  const m = toMinor(field(fd, name) ?? "");
  if (m === null || m <= 0) return { error: "Enter an amount greater than zero, for example 4500.00." };
  return m;
}

export async function addCost(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("finance:write");
    const a = amount(fd);
    if (typeof a !== "number") return a;
    const category = field(fd, "category");
    if (!category) return { error: "Choose a category." };
    let employerPaid = false;
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [c] = await tx`
          INSERT INTO costs (tenant_id, placement_id, category, amount_minor, currency, payee, incurred_on, receipt_ref, created_by)
          VALUES (${ctx.tenantId}, ${placementId}, ${category}, ${a}, ${field(fd, "currency") ?? "KES"}, ${field(fd, "payee") ?? ""},
                  ${field(fd, "incurred_on") ?? new Date().toISOString().slice(0, 10)}, ${field(fd, "receipt_ref") ?? ""}, ${ctx.userId})
          RETURNING id`;
        await audit(tx, ctx, "cost.add", "cost", c.id, { category, amount_minor: a });
        const [pm] = await tx`SELECT payment_model FROM placements WHERE id = ${placementId}`;
        employerPaid = pm?.payment_model === "employer_paid";
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Cost recorded", next: steps.costAdded(placementId, employerPaid) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Costs are append-only. A mistake is corrected with a reversing entry, never an edit. */
export async function reverseCost(costId: string, placementId: string, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("finance:write");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [c] = await tx`SELECT * FROM costs WHERE id = ${costId}`;
        if (!c) throw new Error("Cost not found.");
        if (c.reverses_id) throw new Error("A reversal cannot be reversed.");
        const done = await tx`SELECT 1 FROM costs WHERE reverses_id = ${costId}`;
        if (done.length) throw new Error("Already reversed.");
        await tx`
          INSERT INTO costs (tenant_id, placement_id, category, amount_minor, currency, payee, incurred_on, receipt_ref, reverses_id, created_by)
          VALUES (${ctx.tenantId}, ${c.placement_id}, ${c.category}, ${-c.amount_minor}, ${c.currency}, ${c.payee},
                  current_date, ${"Reversal"}, ${costId}, ${ctx.userId})`;
        await audit(tx, ctx, "cost.reverse", "cost", costId);
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Reversed" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function addFeeCharge(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("finance:write");
    const a = amount(fd);
    if (typeof a !== "number") return a;
    const feeType = field(fd, "fee_type");
    if (!feeType) return { error: "Choose a fee type." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        // The agency can set a ceiling on what a candidate is charged in total (Settings).
        const [t] = await tx`SELECT settings->>'max_candidate_fee_minor' AS cap FROM tenants`;
        if (t?.cap) {
          const [{ total }] = await tx`SELECT COALESCE(sum(amount_minor), 0) AS total FROM fee_charges WHERE placement_id = ${placementId}`;
          if (Number(total) + a > Number(t.cap)) {
            throw new Error(`This would take the candidate's fees above the agency limit of ${(Number(t.cap) / 100).toLocaleString("en-KE")}.`);
          }
        }
        const [f] = await tx`
          INSERT INTO fee_charges (tenant_id, placement_id, fee_type, amount_minor, due_on, created_by)
          VALUES (${ctx.tenantId}, ${placementId}, ${feeType}, ${a}, ${field(fd, "due_on")}, ${ctx.userId}) RETURNING id`;
        await audit(tx, ctx, "fee.add", "fee_charge", f.id, { feeType, amount_minor: a });
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Fee added", next: steps.feeAdded(placementId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

const PaymentSchema = z.object({
  party: z.enum(["candidate", "employer"]),
  method: z.enum(["mpesa", "cash", "bank"]),
});

export async function recordPayment(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("finance:write");
    const p = PaymentSchema.safeParse({ party: field(fd, "party"), method: field(fd, "method") });
    if (!p.success) return { error: "Choose who paid and how." };
    const a = amount(fd);
    if (typeof a !== "number") return a;
    const reference = field(fd, "reference") ?? "";
    if (p.data.method === "mpesa" && reference.length < 6) return { error: "Enter the M-Pesa transaction code." };

    let receipt = "";
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        let currency = "KES";
        let invoiceId: string | null = null;
        if (p.data.party === "employer") {
          invoiceId = field(fd, "invoice_id");
          if (!invoiceId) throw new Error("Choose the invoice this payment is for.");
          const [inv] = await tx`SELECT * FROM invoices WHERE id = ${invoiceId} AND placement_id = ${placementId}`;
          if (!inv || inv.status !== "open") throw new Error("That invoice is not open.");
          currency = inv.currency;
        }
        receipt = await nextNumber(tx, ctx.tenantId, "receipt", "RCT");
        const [pay] = await tx`
          INSERT INTO payments (tenant_id, receipt_no, party, placement_id, invoice_id, method, amount_minor, currency, reference, paid_on, created_by)
          VALUES (${ctx.tenantId}, ${receipt}, ${p.data.party}, ${placementId}, ${invoiceId}, ${p.data.method}, ${a}, ${currency},
                  ${reference}, ${field(fd, "paid_on") ?? new Date().toISOString().slice(0, 10)}, ${ctx.userId})
          RETURNING id`;
        if (invoiceId) {
          const [s] = await tx`
            SELECT i.amount_minor, COALESCE((SELECT sum(amount_minor) FROM payments WHERE invoice_id = i.id), 0) AS paid
            FROM invoices i WHERE i.id = ${invoiceId}`;
          if (Number(s.paid) >= Number(s.amount_minor)) await tx`UPDATE invoices SET status = 'paid' WHERE id = ${invoiceId}`;
        }
        await audit(tx, ctx, "payment.record", "payment", pay.id, { receipt, party: p.data.party, amount_minor: a });
        if (p.data.party === "candidate") {
          const [c] = await tx`
            SELECT c.id, c.first_name, c.phone, c.email FROM placements p JOIN candidates c ON c.id = p.candidate_id WHERE p.id = ${placementId}`;
          await notifyCandidate(tx, ctx.tenantId, { id: c.id, name: c.first_name, phone: c.phone, email: c.email }, "payment_received",
            { amount: formatMoney(a, currency), receipt });
        }
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: `Recorded. Receipt ${receipt}`, next: steps.paymentRecorded(placementId, receipt) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function raiseInvoice(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("finance:write");
    const a = amount(fd);
    if (typeof a !== "number") return a;
    const currency = field(fd, "currency");
    const rate = Number(field(fd, "fx_rate") ?? "1");
    if (!currency) return { error: "Choose the invoice currency." };
    if (!(rate > 0)) return { error: "Enter the exchange rate to KES (1 for KES invoices)." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [p] = await tx`
          SELECT p.payment_model, j.employer_id FROM placements p LEFT JOIN job_orders j ON j.id = p.job_order_id WHERE p.id = ${placementId}`;
        if (!p?.employer_id) throw new Error("Assign a job order before invoicing.");
        if (p.payment_model !== "employer_paid") throw new Error("Only employer-paid placements are invoiced to the employer.");
        const number = await nextNumber(tx, ctx.tenantId, "invoice", "INV");
        const [inv] = await tx`
          INSERT INTO invoices (tenant_id, number, employer_id, placement_id, amount_minor, currency, fx_rate_to_kes, due_on, created_by)
          VALUES (${ctx.tenantId}, ${number}, ${p.employer_id}, ${placementId}, ${a}, ${currency}, ${rate}, ${field(fd, "due_on")}, ${ctx.userId})
          RETURNING id`;
        await audit(tx, ctx, "invoice.raise", "invoice", inv.id, { number, amount_minor: a, currency });
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Invoice raised", next: steps.invoiceRaised(placementId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
