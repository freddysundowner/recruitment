import { createHmac, timingSafeEqual } from "node:crypto";

// Card payments through Stripe Checkout, using Stripe's HTTP API directly (no SDK to install or keep updated).
export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);

export async function createCheckout(a: {
  amountMinor: number; name: string; tenantId: string; plan: string; months: number; email?: string; successUrl: string; cancelUrl: string;
}): Promise<string> {
  const body = new URLSearchParams({
    mode: "payment",
    success_url: a.successUrl,
    cancel_url: a.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "kes",
    "line_items[0][price_data][unit_amount]": String(a.amountMinor),
    "line_items[0][price_data][product_data][name]": a.name,
    "metadata[tenant_id]": a.tenantId,
    "metadata[plan]": a.plan,
    "metadata[months]": String(a.months),
  });
  if (a.email) body.set("customer_email", a.email);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: { message: string } };
  if (!res.ok || !j.url) throw new Error(j.error?.message ?? "Could not start the card payment.");
  return j.url;
}

/** Checks the Stripe-Signature header: HMAC-SHA256 of "timestamp.body" with the webhook secret, within 5 minutes. */
export function verifyStripeSignature(raw: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
