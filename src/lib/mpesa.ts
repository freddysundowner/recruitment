import { decrypt } from "./crypto";

/**
 * Safaricom Daraja: STK push (the prompt that appears on the customer's phone) and status query.
 * Set MPESA_MODE=mock to run without Safaricom: requests are accepted locally and results are
 * simulated from the screen, which is how you demonstrate or test the flow.
 */
export type MpesaConfig = {
  env: "sandbox" | "production";
  type: "paybill" | "till";
  shortcode: string;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
};

export const mockMode = () => process.env.MPESA_MODE === "mock";

const base = (env: MpesaConfig["env"]) => (env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");

/** Reads an agency's saved M-Pesa settings (secrets are stored encrypted). */
export function configFromSettings(settings: Record<string, unknown> | null | undefined): MpesaConfig | null {
  const m = (settings?.mpesa ?? null) as null | Record<string, string>;
  if (!m?.shortcode || !m.consumer_key_enc || !m.consumer_secret_enc || !m.passkey_enc) return null;
  return {
    env: m.env === "production" ? "production" : "sandbox",
    type: m.type === "till" ? "till" : "paybill",
    shortcode: m.shortcode,
    consumerKey: decrypt(m.consumer_key_enc),
    consumerSecret: decrypt(m.consumer_secret_enc),
    passkey: decrypt(m.passkey_enc),
  };
}

const timestamp = () => new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

async function token(c: MpesaConfig): Promise<string> {
  const res = await fetch(`${base(c.env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64")}` },
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !j.access_token) throw new Error("Could not sign in to M-Pesa. Check the consumer key and secret in Settings.");
  return j.access_token;
}

export type StkResult = { merchantRequestId: string; checkoutRequestId: string };

export async function stkPush(c: MpesaConfig, a: { phone: string; amountKes: number; accountRef: string; description: string; callbackUrl: string }): Promise<StkResult> {
  if (mockMode()) {
    const id = Math.random().toString(36).slice(2, 12);
    return { merchantRequestId: `mock-mr-${id}`, checkoutRequestId: `ws_CO_mock_${id}` };
  }
  const ts = timestamp();
  const res = await fetch(`${base(c.env)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token(c)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: c.shortcode,
      Password: Buffer.from(`${c.shortcode}${c.passkey}${ts}`).toString("base64"),
      Timestamp: ts,
      TransactionType: c.type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: a.amountKes,
      PartyA: a.phone.replace(/^\+/, ""),
      PartyB: c.shortcode,
      PhoneNumber: a.phone.replace(/^\+/, ""),
      CallBackURL: a.callbackUrl,
      AccountReference: a.accountRef.slice(0, 12),
      TransactionDesc: a.description.slice(0, 13),
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { ResponseCode?: string; CustomerMessage?: string; errorMessage?: string; MerchantRequestID?: string; CheckoutRequestID?: string };
  if (!res.ok || j.ResponseCode !== "0" || !j.CheckoutRequestID) throw new Error(j.errorMessage ?? j.CustomerMessage ?? "M-Pesa did not accept the request.");
  return { merchantRequestId: j.MerchantRequestID!, checkoutRequestId: j.CheckoutRequestID };
}

/** Asks Safaricom what happened to a request whose callback never arrived. */
export async function stkQuery(c: MpesaConfig, checkoutRequestId: string): Promise<{ code: number | null; desc: string }> {
  if (mockMode()) return { code: null, desc: "pending" };
  const ts = timestamp();
  const res = await fetch(`${base(c.env)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token(c)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: c.shortcode,
      Password: Buffer.from(`${c.shortcode}${c.passkey}${ts}`).toString("base64"),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { ResultCode?: string; ResultDesc?: string; errorMessage?: string };
  // While the customer is still deciding, Daraja answers with an error body, which means "not finished yet".
  if (j.ResultCode === undefined) return { code: null, desc: j.errorMessage ?? "pending" };
  return { code: Number(j.ResultCode), desc: j.ResultDesc ?? "" };
}

/** What the callback body from Safaricom looks like once we have picked it apart. */
export type StkCallback = {
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amount?: number;
  receipt?: string;
  phone?: string;
};

export function parseCallback(body: unknown): StkCallback | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string" || typeof cb.ResultCode !== "number") return null;
  const items = ((cb.CallbackMetadata as { Item?: { Name: string; Value?: string | number }[] } | undefined)?.Item ?? []);
  const get = (n: string) => items.find((i) => i.Name === n)?.Value;
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: cb.ResultCode,
    resultDesc: String(cb.ResultDesc ?? ""),
    amount: typeof get("Amount") === "number" ? (get("Amount") as number) : undefined,
    receipt: get("MpesaReceiptNumber") ? String(get("MpesaReceiptNumber")) : undefined,
    phone: get("PhoneNumber") ? String(get("PhoneNumber")) : undefined,
  };
}
