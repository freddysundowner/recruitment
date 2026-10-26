import { cache } from "react";
import { decrypt } from "./crypto";
import type { MpesaConfig } from "./mpesa";

/**
 * Settings that belong to whoever runs the service: the SMS and email accounts, what credits cost, the M-Pesa
 * account that receives payments, card keys and whether people can sign up. They are edited in the platform console
 * and stored in the database (secrets encrypted). Anything left blank there falls back to the server's environment,
 * which is also how a single-agency install is configured.
 */
export type SettingRow = { key: string; value: Record<string, unknown> };

export type PlatformConfig = {
  signup: { enabled: boolean; trialDays: number };
  credits: { priceMinor: number; freeOnSignup: number };
  sms: { apiKey: string | null; senderId: string | null; endpoint: string };
  email: { apiKey: string | null; fromEmail: string | null; fromName: string | null };
  mpesa: MpesaConfig | null;
  stripe: { secretKey: string; webhookSecret: string } | null;
};

/** The documented sending address of BlessedTexts. It can be overridden in the console if they ever change it. */
export const BLESSEDTEXTS_URL = "https://sms.blessedtexts.com/api/sms/v1/sendsms";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const secret = (o: Record<string, unknown> | undefined, k: string) => (o && typeof o[`${k}_enc`] === "string" ? decrypt(o[`${k}_enc`] as string) : null);

export function buildConfig(rows: SettingRow[], env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const by = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, Record<string, unknown> | undefined>;
  const single = env.TENANT_MODE === "single";
  const sg = by.signup ?? {};
  const cr = by.credits ?? {};
  const sms = by.sms ?? {};
  const em = by.email ?? {};
  const mp = by.mpesa ?? {};
  const st = by.stripe ?? {};

  const mpesaKey = secret(mp, "consumer_key") ?? env.MPESA_CONSUMER_KEY;
  const mpesaSecret = secret(mp, "consumer_secret") ?? env.MPESA_CONSUMER_SECRET;
  const mpesaPass = secret(mp, "passkey") ?? env.MPESA_PASSKEY;
  const shortcode = str(mp.shortcode) ?? env.MPESA_SHORTCODE;
  const stripeKey = secret(st, "secret_key") ?? env.STRIPE_SECRET_KEY;
  const stripeHook = secret(st, "webhook_secret") ?? env.STRIPE_WEBHOOK_SECRET;

  return {
    signup: {
      enabled: !single && (typeof sg.enabled === "boolean" ? sg.enabled : env.SIGNUP_ENABLED !== "false"),
      trialDays: Number.isInteger(sg.trial_days) && (sg.trial_days as number) > 0 ? (sg.trial_days as number) : Number(env.TRIAL_DAYS ?? 7),
    },
    credits: {
      priceMinor: Number.isInteger(cr.price_minor) && (cr.price_minor as number) > 0 ? (cr.price_minor as number) : 40, // KES 0.40
      freeOnSignup: Number.isInteger(cr.free_on_signup) && (cr.free_on_signup as number) >= 0 ? (cr.free_on_signup as number) : 20,
    },
    sms: {
      apiKey: secret(sms, "api_key") ?? str(env.BLESSEDTEXTS_API_KEY),
      senderId: str(sms.sender_id) ?? str(env.BLESSEDTEXTS_SENDER_ID),
      endpoint: str(sms.endpoint) ?? str(env.BLESSEDTEXTS_URL) ?? BLESSEDTEXTS_URL,
    },
    email: {
      apiKey: secret(em, "api_key") ?? str(env.BREVO_API_KEY),
      fromEmail: str(em.from_email) ?? str(env.EMAIL_FROM),
      fromName: str(em.from_name) ?? str(env.EMAIL_FROM_NAME),
    },
    mpesa: shortcode && mpesaKey && mpesaSecret && mpesaPass
      ? { env: (str(mp.env) ?? env.MPESA_ENV) === "production" ? "production" : "sandbox", type: (str(mp.type) ?? env.MPESA_TYPE) === "till" ? "till" : "paybill", shortcode, consumerKey: mpesaKey, consumerSecret: mpesaSecret, passkey: mpesaPass }
      : null,
    stripe: stripeKey && stripeHook ? { secretKey: stripeKey, webhookSecret: stripeHook } : null,
  };
}

/** For the website: read once per request through the one function the agencies' database role may call. */
export const getPlatformConfig = cache(async (): Promise<PlatformConfig> => {
  const { sql } = await import("./db"); // loaded on use, so the worker and the tests can use buildConfig without a connection
  const rows = (await sql`SELECT key, value FROM platform_settings_all()`) as unknown as SettingRow[];
  return buildConfig(rows);
});

/** What the console shows for a section, with secrets reduced to "is it set". */
export async function getRawSettings(): Promise<Record<string, Record<string, unknown>>> {
  const { sql } = await import("./db");
  const rows = (await sql`SELECT key, value FROM platform_settings_all()`) as unknown as SettingRow[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export const smsSegments = (text: string) => {
  const unicode = /[^\u0000-\u007f£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]/.test(text);
  const one = unicode ? 70 : 160;
  const many = unicode ? 67 : 153;
  return text.length <= one ? 1 : Math.ceil(text.length / many);
};

/** How many whole credits an amount buys, and the amount that buys exactly that many. */
export const creditsFor = (amountMinor: number, priceMinor: number) => Math.floor(amountMinor / priceMinor);
