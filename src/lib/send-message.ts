import type postgres from "postgres";
import { sendSms } from "./providers/sms";
import { sendWhatsapp } from "./providers/whatsapp";
import { sendEmail } from "./providers/email";
import { smsSegments, type PlatformConfig } from "./platform-config";

/** Thrown when an agency has no SMS credits left. The message is marked failed straight away, not retried. */
export class OutOfCredits extends Error {}

/**
 * Sends one queued message. Texts on the shared service are paid for with the agency's credits (taken before
 * sending, handed back if the provider refuses); an agency running its own copy pays its provider directly.
 * An agency's own sender name or address is used once the platform owner has approved it.
 * Runs as the worker, which works across agencies, so every query names the agency.
 */
export async function deliverMessage(sql: postgres.Sql, messageId: string, cfg: PlatformConfig, single = process.env.TENANT_MODE === "single") {
  const [m] = await sql`SELECT * FROM messages WHERE id = ${messageId}`;
  if (!m || m.status === "sent") return;
  const [own] = await sql`SELECT value, display_name FROM tenant_senders WHERE tenant_id = ${m.tenant_id} AND kind = ${m.channel} AND status = 'approved'`;

  let r: { ref: string; delivered: boolean };
  let credits = 0;
  if (m.channel === "sms") {
    // Without an API key nothing is delivered, so nothing is charged either.
    if (!single && cfg.sms.apiKey) {
      credits = smsSegments(m.body);
      const [ok] = await sql`SELECT sms_credits_spend(${m.tenant_id}, ${credits}, ${m.id}) AS ok`;
      if (!ok.ok) throw new OutOfCredits("Out of SMS credits. Buy more in Billing.");
    }
    try {
      r = await sendSms(cfg, m.to_addr, m.body, own?.value);
    } catch (e) {
      if (credits) await sql`SELECT sms_credits_add(${m.tenant_id}, ${credits}, 'refund', ${m.id})`; // a text that was not sent costs nothing
      throw e;
    }
  } else if (m.channel === "whatsapp") {
    r = await sendWhatsapp(m.to_addr, m.body);
  } else {
    r = await sendEmail(cfg, m.to_addr, m.subject ?? "Message", m.body, own ? { email: own.value, name: own.display_name } : null);
  }
  await sql`UPDATE messages SET status = 'sent', provider_ref = ${r.delivered ? r.ref : `not-delivered:${r.ref}`}, sent_at = now(), error = NULL, credits = ${r.delivered ? credits : 0},
            body = CASE WHEN template = 'otp' THEN 'Sign-in code sent' ELSE body END WHERE id = ${messageId}`;
}
