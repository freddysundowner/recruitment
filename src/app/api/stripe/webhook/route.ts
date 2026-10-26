import { sql } from "@/lib/db";
import { verifyStripeSignature } from "@/lib/stripe";

// Stripe tells us a card payment succeeded. The signature proves the message really came from Stripe, and the
// payment function ignores a payment it has already recorded, so a repeated message cannot extend a plan twice.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 404 });
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) return new Response("Bad signature", { status: 400 });

  const event = JSON.parse(raw) as { type: string; data: { object: { id: string; payment_status?: string; amount_total?: number; metadata?: Record<string, string> } } };
  if (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid") {
    const o = event.data.object;
    const m = o.metadata ?? {};
    if (m.tenant_id && m.plan && m.months && o.amount_total) {
      try {
        await sql`SELECT platform_record_payment(${m.tenant_id}, ${o.amount_total}, 'card', ${o.id}, ${Number(m.months)}, ${m.plan}, 'stripe')`;
      } catch (e) {
        // A repeat of a payment we already recorded violates the unique reference, which is exactly what we want to ignore.
        if ((e as { code?: string }).code !== "23505") throw e;
      }
    }
  }
  return Response.json({ received: true });
}
