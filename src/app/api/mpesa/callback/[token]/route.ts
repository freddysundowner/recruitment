import { sql, withTenant } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { parseCallback } from "@/lib/mpesa";
import { applyMpesaResult } from "@/lib/mpesa-apply";

// Safaricom reports the result of an STK push here. There is no session, so the secret token in the
// URL identifies the request, and the checkout id in the body must match the one we stored.
export async function POST(req: Request, { params }: RouteContext<"/api/mpesa/callback/[token]">) {
  const { token } = await params;
  const raw = await req.text();
  if (raw.length > 20_000) return new Response("Too large", { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const cb = parseCallback(body);
  if (!cb) return new Response("Bad request", { status: 400 });

  const [found] = await sql`SELECT * FROM mpesa_lookup(${sha256(token)})`;
  if (!found) return new Response("Not found", { status: 404 });

  await withTenant(found.tenant_id, async (tx) => {
    const [r] = await tx`SELECT checkout_request_id FROM mpesa_requests WHERE id = ${found.id}`;
    if (!r || r.checkout_request_id !== cb.checkoutRequestId) return;
    await applyMpesaResult(tx, found.tenant_id, found.id, cb);
  });
  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
