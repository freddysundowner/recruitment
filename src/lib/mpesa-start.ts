import type { Sql } from "./db";
import { audit } from "./audit";
import type { Actor } from "./actor";
import { randomToken, sha256 } from "./crypto";
import { configFromSettings, mockMode, stkPush, type MpesaConfig } from "./mpesa";
import { getPlatformConfig } from "./platform-config";

/**
 * Creates an M-Pesa request and sends the prompt to the customer's phone.
 * Used by staff (from the placement page) and by candidates paying from the portal.
 */
export async function requestStk(
  tx: Sql,
  a: { tenantId: string; placementId: string; candidateId: string; phone: string; amountMinor: number; createdBy: string | null; actor?: Actor },
): Promise<void> {
  const [t] = await tx`SELECT settings FROM tenants WHERE id = ${a.tenantId}`;
  const cfg: MpesaConfig | null =
    configFromSettings(t.settings) ?? (mockMode() ? { env: "sandbox", type: "paybill", shortcode: "000000", consumerKey: "", consumerSecret: "", passkey: "" } : null);
  if (!cfg) throw new Error("M-Pesa is not set up for this agency yet.");
  const appUrl = process.env.APP_URL;
  if (!appUrl && !mockMode()) throw new Error("APP_URL is not set, so M-Pesa has nowhere to send the result.");

  const [cs] = await tx`SELECT source FROM candidates WHERE id = ${a.candidateId}`;
  if (cs?.source === "sample" && !mockMode()) throw new Error("This is a sample candidate with a made-up phone number, so it cannot be charged.");
  const [pl] = await tx`SELECT outcome FROM placements WHERE id = ${a.placementId}`;
  if (!pl || pl.outcome === "closed") throw new Error("This placement is closed.");
  const [recent] = await tx`SELECT 1 FROM mpesa_requests WHERE placement_id = ${a.placementId} AND status = 'pending' AND created_at > now() - interval '3 minutes'`;
  if (recent) throw new Error("A request was sent a moment ago. Wait for the answer, or check its status.");

  const token = randomToken();
  const [r] = await tx`
    INSERT INTO mpesa_requests (tenant_id, placement_id, candidate_id, phone, amount_minor, account_ref, token_hash, created_by)
    VALUES (${a.tenantId}, ${a.placementId}, ${a.candidateId}, ${a.phone}, ${a.amountMinor}, ${"FEE" + a.placementId.slice(0, 6).toUpperCase()}, ${sha256(token)}, ${a.createdBy})
    RETURNING id, account_ref`;
  try {
    const res = await stkPush(cfg, {
      phone: a.phone, amountKes: a.amountMinor / 100, accountRef: r.account_ref, description: "Agency fee",
      callbackUrl: `${(appUrl ?? "http://localhost").replace(/\/$/, "")}/api/mpesa/callback/${token}`,
    });
    await tx`UPDATE mpesa_requests SET merchant_request_id = ${res.merchantRequestId}, checkout_request_id = ${res.checkoutRequestId} WHERE id = ${r.id}`;
  } catch (e) {
    await tx`UPDATE mpesa_requests SET status = 'failed', result_desc = ${e instanceof Error ? e.message : "failed"}, completed_at = now() WHERE id = ${r.id}`;
    throw e;
  }
  if (a.actor) await audit(tx, a.actor, "mpesa.request", "mpesa_request", r.id, { amount_minor: a.amountMinor });
}

/** Asks an agency admin to pay for a subscription: the money goes to the platform's own M-Pesa account. */
export async function requestSubscriptionStk(
  tx: Sql,
  a: { tenantId: string; plan: string; months: number; phone: string; amountMinor: number; createdBy: string },
): Promise<void> {
  const cfg: MpesaConfig | null = (await getPlatformConfig()).mpesa ?? (mockMode() ? { env: "sandbox", type: "paybill", shortcode: "000000", consumerKey: "", consumerSecret: "", passkey: "" } : null);
  if (!cfg) throw new Error("M-Pesa payment is not available right now. Use the bank transfer details or pay by card.");
  const appUrl = process.env.APP_URL;
  if (!appUrl && !mockMode()) throw new Error("APP_URL is not set.");
  const [recent] = await tx`SELECT 1 FROM mpesa_requests WHERE purpose = 'subscription' AND status = 'pending' AND created_at > now() - interval '3 minutes'`;
  if (recent) throw new Error("A request was sent a moment ago. Wait for the answer, or check its status.");

  const token = randomToken();
  const [r] = await tx`
    INSERT INTO mpesa_requests (tenant_id, purpose, phone, amount_minor, account_ref, token_hash, created_by, meta)
    VALUES (${a.tenantId}, 'subscription', ${a.phone}, ${a.amountMinor}, ${"SUB" + a.tenantId.slice(0, 6).toUpperCase()}, ${sha256(token)}, ${a.createdBy},
            ${tx.json({ plan: a.plan, months: a.months } as never)})
    RETURNING id, account_ref`;
  try {
    const res = await stkPush(cfg, {
      phone: a.phone, amountKes: a.amountMinor / 100, accountRef: r.account_ref, description: "Subscription",
      callbackUrl: `${(appUrl ?? "http://localhost").replace(/\/$/, "")}/api/mpesa/callback/${token}`,
    });
    await tx`UPDATE mpesa_requests SET merchant_request_id = ${res.merchantRequestId}, checkout_request_id = ${res.checkoutRequestId} WHERE id = ${r.id}`;
  } catch (e) {
    await tx`UPDATE mpesa_requests SET status = 'failed', result_desc = ${e instanceof Error ? e.message : "failed"}, completed_at = now() WHERE id = ${r.id}`;
    throw e;
  }
}

/** Asks an agency admin to pay for SMS credits. The money goes to the platform's M-Pesa account, and the credits are added when it is confirmed. */
export async function requestCreditsStk(
  tx: Sql,
  a: { tenantId: string; credits: number; phone: string; amountMinor: number; createdBy: string },
): Promise<void> {
  const cfg: MpesaConfig | null = (await getPlatformConfig()).mpesa ?? (mockMode() ? { env: "sandbox", type: "paybill", shortcode: "000000", consumerKey: "", consumerSecret: "", passkey: "" } : null);
  if (!cfg) throw new Error("M-Pesa payment is not available right now. Contact support to buy credits.");
  const appUrl = process.env.APP_URL;
  if (!appUrl && !mockMode()) throw new Error("APP_URL is not set.");
  const [recent] = await tx`SELECT 1 FROM mpesa_requests WHERE purpose = 'sms_credits' AND status = 'pending' AND created_at > now() - interval '3 minutes'`;
  if (recent) throw new Error("A request was sent a moment ago. Wait for the answer, or check its status.");

  const token = randomToken();
  const [r] = await tx`
    INSERT INTO mpesa_requests (tenant_id, purpose, phone, amount_minor, account_ref, token_hash, created_by, meta)
    VALUES (${a.tenantId}, 'sms_credits', ${a.phone}, ${a.amountMinor}, ${"SMS" + a.tenantId.slice(0, 6).toUpperCase()}, ${sha256(token)}, ${a.createdBy},
            ${tx.json({ credits: a.credits } as never)})
    RETURNING id, account_ref`;
  try {
    const res = await stkPush(cfg, {
      phone: a.phone, amountKes: a.amountMinor / 100, accountRef: r.account_ref, description: "SMS credits",
      callbackUrl: `${(appUrl ?? "http://localhost").replace(/\/$/, "")}/api/mpesa/callback/${token}`,
    });
    await tx`UPDATE mpesa_requests SET merchant_request_id = ${res.merchantRequestId}, checkout_request_id = ${res.checkoutRequestId} WHERE id = ${r.id}`;
  } catch (e) {
    await tx`UPDATE mpesa_requests SET status = 'failed', result_desc = ${e instanceof Error ? e.message : "failed"}, completed_at = now() WHERE id = ${r.id}`;
    throw e;
  }
}
