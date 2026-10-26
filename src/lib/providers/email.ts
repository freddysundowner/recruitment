import nodemailer, { type Transporter } from "nodemailer";

// Email over SMTP (any provider, or your own server). Without SMTP_URL the message is logged only.
export const emailConfigured = () => Boolean(process.env.SMTP_URL);

let transport: Transporter | undefined;

export async function sendEmail(to: string, subject: string, text: string): Promise<{ ref: string; delivered: boolean }> {
  if (!emailConfigured()) {
    console.log(`[email:not-configured] to ${to} | ${subject}\n${text}`);
    return { ref: "dev-log", delivered: false };
  }
  transport ??= nodemailer.createTransport(process.env.SMTP_URL!);
  const info = await transport.sendMail({ from: process.env.EMAIL_FROM ?? "no-reply@localhost", to, subject, text });
  return { ref: info.messageId, delivered: true };
}
