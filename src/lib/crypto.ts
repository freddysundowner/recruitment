import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Field-level encryption for sensitive values (ID and passport numbers, TOTP secrets, per-agency API secrets).
 * AES-256-GCM, with a random nonce per value. The key comes from FIELD_ENCRYPTION_KEY (64 hex characters).
 * In development it is derived from SESSION_SECRET so nothing extra is needed to start; production must set its own.
 */
function key(): Buffer {
  const k = process.env.FIELD_ENCRYPTION_KEY;
  if (k) {
    if (!/^[0-9a-f]{64}$/i.test(k)) throw new Error("FIELD_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)");
    return Buffer.from(k, "hex");
  }
  if (process.env.NODE_ENV === "production") throw new Error("FIELD_ENCRYPTION_KEY is required in production");
  return createHash("sha256").update(`dev-field-key:${process.env.SESSION_SECRET ?? "dev"}`).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised encrypted value");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/**
 * A keyed hash for exact-match lookups of encrypted values (duplicate detection, search by ID number).
 * Equal inputs give equal hashes, but the hash cannot be reversed without the key.
 */
export function blindIndex(value: string): string {
  const normal = value.trim().toLowerCase().replace(/\s+/g, "");
  return createHmac("sha256", key()).update(`idx:${normal}`).digest("hex");
}

/** Shows only the last characters of a sensitive number, for lists and screens. */
export function mask(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length <= 4 ? "••••" : `••••${value.slice(-3)}`;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
