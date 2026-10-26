import type { PlatformConfig } from "../platform-config";

/** Email through Brevo's transactional API. Without an API key the message is logged only. */
export const emailConfigured = (c: PlatformConfig) => Boolean(c.email.apiKey && c.email.fromEmail);

export async function sendEmail(
  c: PlatformConfig,
  to: string,
  subject: string,
  text: string,
  from?: { email: string; name?: string | null } | null,
): Promise<{ ref: string; delivered: boolean }> {
  const sender = from ?? (c.email.fromEmail ? { email: c.email.fromEmail, name: c.email.fromName } : null);
  if (!c.email.apiKey || !sender) {
    console.log(`[email:not-configured] to ${to} | ${subject}\n${text}`);
    return { ref: "dev-log", delivered: false };
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": c.email.apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { email: sender.email, ...(sender.name ? { name: sender.name } : {}) }, to: [{ email: to }], subject, textContent: text }),
  });
  const j = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
  if (!res.ok) throw new Error(`Email failed: ${j.message ?? res.status}`);
  return { ref: j.messageId ?? "sent", delivered: true };
}
