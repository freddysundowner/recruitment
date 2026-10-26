"use server";

import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireCan } from "@/lib/session";
import { audit } from "@/lib/audit";
import { encrypt, randomToken } from "@/lib/crypto";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { toMinor } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import { configFromSettings, mockMode, stkQuery } from "@/lib/mpesa";
import { applyMpesaResult } from "@/lib/mpesa-apply";
import { requestStk } from "@/lib/mpesa-start";
import { assertFeature } from "@/lib/plan";

const refresh = (placementId: string) => {
  revalidatePath(`/placements/${placementId}`);
  revalidatePath("/finance");
};

/** Sends the M-Pesa prompt to the candidate's phone. The payment is recorded when they enter their PIN. */
export async function startStk(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("finance:write");
    const phone = normalizePhone(field(fd, "phone") ?? "");
    if (!phone || !phone.startsWith("+254")) return { error: "Enter a Safaricom number such as 0712 345 678." };
    const minor = toMinor(field(fd, "amount") ?? "");
    if (minor === null || minor < 100) return { error: "Enter an amount of at least KES 1." };
    if (minor % 100 !== 0) return { error: "M-Pesa takes whole shillings. Enter an amount without cents." };
    if (minor > 250_000 * 100) return { error: "M-Pesa limits one payment to KES 250,000." };

    try {
      await assertFeature(ctx.tenantId, "mpesa", "M-Pesa collection");
      await withTenant(ctx.tenantId, async (tx) => {
        const [pl] = await tx`SELECT candidate_id FROM placements WHERE id = ${placementId}`;
        if (!pl) throw new Error("Placement not found.");
        await requestStk(tx, { tenantId: ctx.tenantId, placementId, candidateId: pl.candidate_id, phone, amountMinor: minor, createdBy: ctx.userId, actor: ctx });
      });
    } catch (e) {
      revalidatePath(`/placements/${placementId}`);
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Request sent. Ask the customer to check their phone and enter their M-Pesa PIN.", next: steps.mpesaRequested(placementId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Asks Safaricom about a request whose answer has not arrived. */
export async function checkStk(requestId: string, placementId: string, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("finance:write");
    let message = "Still waiting for the customer";
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [req] = await tx`SELECT * FROM mpesa_requests WHERE id = ${requestId}`;
        if (!req) throw new Error("Request not found.");
        if (req.status !== "pending") { message = `Already ${req.status}`; return; }
        const [t] = await tx`SELECT settings FROM tenants WHERE id = ${ctx.tenantId}`;
        const cfg = configFromSettings(t.settings);
        if (!cfg) throw new Error("M-Pesa is not set up in Settings.");
        const q = await stkQuery(cfg, req.checkout_request_id);
        if (q.code === null) return;
        await applyMpesaResult(tx, ctx.tenantId, requestId, { resultCode: q.code, resultDesc: q.desc });
        message = q.code === 0 ? "Payment received" : `Not completed: ${q.desc}`;
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: message };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Demo and test mode only: behaves as if the customer paid or cancelled on their phone. */
export async function simulateStk(requestId: string, placementId: string, outcome: "pay" | "cancel", _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("finance:write");
    if (!mockMode()) return { error: "Simulation is only available when MPESA_MODE=mock." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [req] = await tx`SELECT amount_minor FROM mpesa_requests WHERE id = ${requestId}`;
        if (!req) throw new Error("Request not found.");
        await applyMpesaResult(tx, ctx.tenantId, requestId, outcome === "pay"
          ? { resultCode: 0, resultDesc: "The service request is processed successfully.", amount: Number(req.amount_minor) / 100, receipt: `MOCK${randomToken(5).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 7)}` }
          : { resultCode: 1032, resultDesc: "Request cancelled by user" });
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: outcome === "pay" ? "Payment simulated" : "Cancellation simulated" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function saveMpesaSettings(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    const shortcode = field(fd, "shortcode");
    if (!shortcode || !/^\d{5,7}$/.test(shortcode)) return { error: "Enter the 5 to 7 digit paybill or till number." };
    const type = field(fd, "type") === "till" ? "till" : "paybill";
    const env = field(fd, "env") === "production" ? "production" : "sandbox";
    try {
      await assertFeature(ctx.tenantId, "mpesa", "M-Pesa collection");
      await withTenant(ctx.tenantId, async (tx) => {
        const [t] = await tx`SELECT settings->'mpesa' AS m FROM tenants WHERE id = ${ctx.tenantId}`;
        const old = (t.m ?? {}) as Record<string, string>;
        // Secrets are kept when the box is left empty, so saving other fields does not wipe them.
        const keep = (name: string, key: string) => (field(fd, name) ? encrypt(field(fd, name)!) : old[key]);
        const next = { env, type, shortcode, consumer_key_enc: keep("consumer_key", "consumer_key_enc"), consumer_secret_enc: keep("consumer_secret", "consumer_secret_enc"), passkey_enc: keep("passkey", "passkey_enc") };
        if (!next.consumer_key_enc || !next.consumer_secret_enc || !next.passkey_enc) throw new Error("Enter the consumer key, consumer secret and passkey from the Daraja portal.");
        await tx`UPDATE tenants SET settings = jsonb_set(settings, '{mpesa}', ${tx.json(next as never)}) WHERE id = ${ctx.tenantId}`;
        await audit(tx, ctx, "settings.mpesa", "tenant", ctx.tenantId, { env, type, shortcode });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/settings", "layout");
    return { ok: "M-Pesa settings saved", next: steps.mpesaSettingsSaved() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
