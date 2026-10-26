"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { audit } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { normalizePhone } from "@/lib/phone";
import { mockMode, platformConfig, stkQuery } from "@/lib/mpesa";
import { applyMpesaResult } from "@/lib/mpesa-apply";
import { requestSubscriptionStk } from "@/lib/mpesa-start";
import { createCheckout, stripeConfigured } from "@/lib/stripe";
import { isSingleInstall } from "@/lib/plan";

// Billing is deliberately not blocked by an expired subscription: an agency that has lapsed must still be able to pay.
async function billingAdmin() {
  const ctx = await requireCtx();
  if (!can(ctx.role, "users:manage")) throw new Error("Only an agency admin can manage billing.");
  if (ctx.support) throw new Error("Support access is read-only.");
  if (isSingleInstall()) throw new Error("Billing does not apply to a single install.");
  return ctx;
}

async function priceFor(tenantId: string, plan: string, months: number) {
  if (![1, 3, 6, 12].includes(months)) throw new Error("Choose 1, 3, 6 or 12 months.");
  const [p] = await withTenant(tenantId, (tx) => tx`SELECT code, name, price_kes_minor FROM plans WHERE code = ${plan} AND active`);
  if (!p) throw new Error("That plan is not available.");
  return { name: p.name as string, amountMinor: Number(p.price_kes_minor) * months };
}

export async function payWithMpesa(_: FormState, fd: FormData): Promise<FormState> {
  try {
    try {
      const ctx = await billingAdmin();
      const plan = field(fd, "plan") ?? "";
      const months = Number(field(fd, "months") ?? 0);
      const phone = normalizePhone(field(fd, "phone") ?? "");
      if (!phone || !phone.startsWith("+254")) throw new Error("Enter a Safaricom number such as 0712 345 678.");
      const { amountMinor } = await priceFor(ctx.tenantId, plan, months);
      if (amountMinor % 100 !== 0) throw new Error("This amount cannot be paid by M-Pesa. Use another method.");
      await withTenant(ctx.tenantId, async (tx) => {
        await requestSubscriptionStk(tx, { tenantId: ctx.tenantId, plan, months, phone, amountMinor, createdBy: ctx.userId });
        await audit(tx, ctx, "billing.mpesa_request", "tenant", ctx.tenantId, { plan, months, amount_minor: amountMinor });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/billing");
    return { ok: "Check your phone and enter your M-Pesa PIN. Your plan updates as soon as the payment is confirmed.", next: steps.subscriptionPrompt() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function checkSubscriptionStk(requestId: string, _: FormState): Promise<FormState> {
  try {
    let message = "Still waiting for the PIN";
    try {
      const ctx = await billingAdmin();
      await withTenant(ctx.tenantId, async (tx) => {
        const [req] = await tx`SELECT * FROM mpesa_requests WHERE id = ${requestId} AND purpose = 'subscription'`;
        if (!req) throw new Error("Request not found.");
        if (req.status !== "pending") { message = `Already ${req.status}`; return; }
        const cfg = platformConfig();
        if (!cfg) return;
        const q = await stkQuery(cfg, req.checkout_request_id);
        if (q.code === null) return;
        await applyMpesaResult(tx, ctx.tenantId, requestId, { resultCode: q.code, resultDesc: q.desc });
        message = q.code === 0 ? "Payment received" : `Not completed: ${q.desc}`;
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/billing");
    return { ok: message, next: steps.subscriptionChecked() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Demo mode only. */
export async function simulateSubscriptionStk(requestId: string, outcome: "pay" | "cancel", _: FormState): Promise<FormState> {
  try {
    try {
      const ctx = await billingAdmin();
      if (!mockMode()) throw new Error("Simulation is only available when MPESA_MODE=mock.");
      await withTenant(ctx.tenantId, async (tx) => {
        const [req] = await tx`SELECT amount_minor FROM mpesa_requests WHERE id = ${requestId} AND purpose = 'subscription'`;
        if (!req) throw new Error("Request not found.");
        await applyMpesaResult(tx, ctx.tenantId, requestId, outcome === "pay"
          ? { resultCode: 0, resultDesc: "The service request is processed successfully.", amount: Number(req.amount_minor) / 100, receipt: `MOCK${randomToken(5).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 7)}` }
          : { resultCode: 1032, resultDesc: "Request cancelled by user" });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/billing");
    revalidatePath("/", "layout");
    return { ok: outcome === "pay" ? "Payment simulated" : "Cancellation simulated", next: steps.subscriptionChecked() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function payWithCard(_: FormState, fd: FormData): Promise<FormState> {
  try {
    let url: string;
    try {
      const ctx = await billingAdmin();
      if (!stripeConfigured()) throw new Error("Card payment is not available right now.");
      const plan = field(fd, "plan") ?? "";
      const months = Number(field(fd, "months") ?? 0);
      const { name, amountMinor } = await priceFor(ctx.tenantId, plan, months);
      const base = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "");
      const email = await withTenant(ctx.tenantId, async (tx) => (await tx`SELECT email FROM users WHERE id = ${ctx.userId}`)[0]?.email as string | undefined);
      url = await createCheckout({
        amountMinor, name: `${name} plan, ${months} month${months > 1 ? "s" : ""}`, tenantId: ctx.tenantId, plan, months, email,
        successUrl: `${base}/billing?paid=1`, cancelUrl: `${base}/billing`,
      });
    } catch (e) {
      return fail(e);
    }
    redirect(url);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
