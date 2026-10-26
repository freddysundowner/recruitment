import type { PlatformConfig } from "../platform-config";

/**
 * SMS through BlessedTexts. Without an API key the message is logged, not delivered, so the whole system can be
 * tried without an account. The sending address is part of the settings in case the provider changes it.
 */
export const smsConfigured = (c: PlatformConfig) => Boolean(c.sms.apiKey);

export async function sendSms(c: PlatformConfig, to: string, message: string, senderId?: string | null): Promise<{ ref: string; delivered: boolean }> {
  if (!c.sms.apiKey) {
    console.log(`[sms:not-configured] to ${to}: ${message}`);
    return { ref: "dev-log", delivered: false };
  }
  const res = await fetch(c.sms.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_key: c.sms.apiKey, sender_id: senderId || c.sms.senderId || undefined, message, phone: to.replace(/^\+/, "") }),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const first = (Array.isArray(json) ? json[0] : json) as { status_code?: string | number; status_desc?: string; message_id?: string | number; message?: string } | null;
  const ok = res.ok && first && (String(first.status_code) === "1000" || /success/i.test(String(first.status_desc ?? "")));
  if (!ok) throw new Error(`SMS failed: ${first?.status_desc ?? first?.message ?? text.slice(0, 120) ?? res.status}`);
  return { ref: String(first.message_id ?? "sent"), delivered: true };
}
