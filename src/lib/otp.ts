import { randomInt } from "node:crypto";
import type { Sql } from "./db";
import { safeEqual, sha256 } from "./crypto";
import { queueMessage } from "./notify";
import { renderTemplate } from "./templates";

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_PER_WINDOW = 3;

const hash = (tenantId: string, phone: string, code: string) => sha256(`${tenantId}:${phone}:${code}`);

/**
 * Sends a one-time code by SMS. At most 3 codes per number in 10 minutes, so the form cannot be used
 * to run up an agency's SMS bill or to spam someone's phone.
 */
export async function issueOtp(
  tx: Sql, tenantId: string, brand: string, phone: string, purpose: "login" | "register", payload: Record<string, unknown> = {},
): Promise<{ ok: true; devCode?: string } | { ok: false; error: string }> {
  const [{ n }] = await tx`SELECT count(*) AS n FROM otp_codes WHERE phone = ${phone} AND created_at > now() - interval '10 minutes'`;
  if (Number(n) >= MAX_PER_WINDOW) return { ok: false, error: "Too many codes requested. Wait 10 minutes and try again." };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await tx`
    INSERT INTO otp_codes (tenant_id, phone, purpose, code_hash, payload, expires_at)
    VALUES (${tenantId}, ${phone}, ${purpose}, ${hash(tenantId, phone, code)}, ${tx.json(payload as never)}, now() + ${TTL_MINUTES} * interval '1 minute')`;
  const { subject, body } = renderTemplate("otp", { code }, brand);
  await queueMessage(tx, tenantId, { channel: "sms", to: phone, subject, body, template: "otp" });
  // Only in development, so the flow can be tried without an SMS provider.
  return { ok: true, devCode: process.env.PORTAL_DEV_OTP === "true" && process.env.NODE_ENV !== "production" ? code : undefined };
}

/** Checks a code. A code works once, expires, and locks after 5 wrong tries. */
export async function checkOtp(
  tx: Sql, tenantId: string, phone: string, purpose: "login" | "register", code: string,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string }> {
  const [row] = await tx`
    SELECT id, code_hash, payload, attempts FROM otp_codes
    WHERE phone = ${phone} AND purpose = ${purpose} AND used_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
  if (!row) return { ok: false, error: "That code has expired. Ask for a new one." };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many wrong tries. Ask for a new code." };
  if (!safeEqual(row.code_hash, hash(tenantId, phone, code.trim()))) {
    await tx`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${row.id}`;
    return { ok: false, error: "That code is not right." };
  }
  await tx`UPDATE otp_codes SET used_at = now() WHERE id = ${row.id}`;
  return { ok: true, payload: row.payload as Record<string, unknown> };
}
