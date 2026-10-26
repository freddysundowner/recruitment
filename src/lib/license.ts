import { createPublicKey, verify } from "node:crypto";
import { sql } from "./db";

/**
 * Activation keys for single-agency installs. A key is a signed statement from the seller:
 *   RAK1.<payload>.<signature>
 * The signature (Ed25519) is checked here with the seller's public key, so a key can be verified on a server
 * with no internet and cannot be forged or edited. The matching private key stays with the seller only.
 *
 * Keys can carry an expiry (for rented installs) or none (for an outright purchase), a staff-account limit,
 * and a date up to which updates are included.
 */
export type LicensePayload = { v: 1; customer: string; issued: string; expires: string | null; users: number | null; updatesUntil: string | null };

export type LicenseState =
  | { ok: true; customer: string; expires: Date | null; users: number | null; updatesUntil: Date | null; daysLeft: number | null; inGrace: boolean; writable: boolean }
  | { ok: false; reason: "none" | "invalid"; message: string };

export const LICENSE_GRACE_DAYS = 30;

/** The seller's public key. Replace this with your own (npm run license:keys) before shipping installs. */
const PUBLIC_KEY_B64 = process.env.LICENSE_PUBLIC_KEY ?? "";

const b64u = (s: string) => Buffer.from(s, "base64url");

export function verifyKey(key: string, publicKeyB64 = PUBLIC_KEY_B64): { ok: true; payload: LicensePayload } | { ok: false; message: string } {
  if (!publicKeyB64) return { ok: false, message: "This build has no licence public key set (LICENSE_PUBLIC_KEY)." };
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "RAK1") return { ok: false, message: "That does not look like an activation key." };
  try {
    const pub = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    if (!verify(null, data, pub, b64u(parts[2]))) return { ok: false, message: "The activation key is not valid." };
    const payload = JSON.parse(b64u(parts[1]).toString("utf8")) as LicensePayload;
    if (payload.v !== 1 || typeof payload.customer !== "string") return { ok: false, message: "The activation key is not valid." };
    return { ok: true, payload };
  } catch {
    return { ok: false, message: "The activation key is not valid." };
  }
}

/** Turns a verified key into what the app needs: whether to allow changes, and how long is left. */
export function stateFor(payload: LicensePayload, nowMs = Date.now()): LicenseState {
  const expires = payload.expires ? new Date(payload.expires) : null;
  const daysLeft = expires ? Math.ceil((expires.getTime() - nowMs) / 864e5) : null;
  const expired = daysLeft !== null && daysLeft <= 0;
  const inGrace = expired && daysLeft! > -LICENSE_GRACE_DAYS;
  return {
    ok: true,
    customer: payload.customer,
    expires,
    users: payload.users,
    updatesUntil: payload.updatesUntil ? new Date(payload.updatesUntil) : null,
    daysLeft,
    inGrace,
    writable: !expired || inGrace,
  };
}

let cache: { at: number; state: LicenseState } | undefined;

/** The installed key's state. Re-read from the database every minute, and verified each time it is loaded. */
export async function getLicense(): Promise<LicenseState> {
  if (cache && Date.now() - cache.at < 60_000) return cache.state;
  const [row] = await sql`SELECT activation_key FROM installation WHERE id = 1`;
  let state: LicenseState;
  if (!row) state = { ok: false, reason: "none", message: "This install has not been activated yet." };
  else {
    const v = verifyKey(row.activation_key);
    state = v.ok ? stateFor(v.payload) : { ok: false, reason: "invalid", message: v.message };
  }
  cache = { at: Date.now(), state };
  return state;
}

export function forgetLicense() {
  cache = undefined;
}
