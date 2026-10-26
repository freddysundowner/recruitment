// SMS through Africa's Talking. Without credentials the message is logged, not delivered.
export const smsConfigured = () => Boolean(process.env.AT_USERNAME && process.env.AT_API_KEY);

export async function sendSms(to: string, message: string): Promise<{ ref: string; delivered: boolean }> {
  if (!smsConfigured()) {
    console.log(`[sms:not-configured] to ${to}: ${message}`);
    return { ref: "dev-log", delivered: false };
  }
  const sandbox = process.env.AT_SANDBOX === "true";
  const url = sandbox ? "https://api.sandbox.africastalking.com/version1/messaging" : "https://api.africastalking.com/version1/messaging";
  const form = new URLSearchParams({ username: process.env.AT_USERNAME!, to, message });
  if (process.env.AT_SENDER_ID) form.set("from", process.env.AT_SENDER_ID);
  const res = await fetch(url, {
    method: "POST",
    headers: { apiKey: process.env.AT_API_KEY!, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const json = (await res.json().catch(() => ({}))) as { SMSMessageData?: { Recipients?: { statusCode: number; status: string; messageId: string }[]; Message?: string } };
  const r = json.SMSMessageData?.Recipients?.[0];
  if (!res.ok || !r || r.statusCode < 100 || r.statusCode > 102) {
    throw new Error(`SMS failed: ${r?.status ?? json.SMSMessageData?.Message ?? res.status}`);
  }
  return { ref: r.messageId, delivered: true };
}
