"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql, withTenant } from "@/lib/db";
import { clearPendingMfa, createPendingMfa, createSession, destroySession, readPendingMfa } from "@/lib/session";
import { decrypt, sha256 } from "@/lib/crypto";
import { verifyCode } from "@/lib/totp";

const Schema = z.object({ email: z.email().trim(), password: z.string().min(1) });

// Compared against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY = bcrypt.hashSync("not-a-real-password", 10);

// Small in-memory throttle. Replace with Redis when running several app instances.
const attempts = new Map<string, { n: number; first: number }>();
function throttled(key: string, max = 8) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > 15 * 60_000) {
    attempts.set(key, { n: 1, first: now });
    return false;
  }
  a.n += 1;
  return a.n > max;
}

export type LoginState = { error?: string } | undefined;

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = Schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and your password." };
  const { email, password } = parsed.data;
  if (throttled(`login:${email.toLowerCase()}`)) return { error: "Too many attempts. Try again in 15 minutes." };

  const [u] = await sql`SELECT * FROM auth_lookup_user(${email})`;
  const ok = await bcrypt.compare(password, u?.password_hash ?? DUMMY);
  if (!u || !ok) return { error: "Incorrect email or password." };
  if (u.tenant_status !== "active") return { error: "This agency account is suspended." };

  if (u.totp_enabled) {
    await createPendingMfa(u.id, u.tenant_id);
    redirect("/login/verify");
  }
  await createSession(u.id, u.tenant_id);
  redirect(u.role === "employer" ? "/employer" : "/");
}

/** Second step: a code from the authenticator app, or one of the one-time recovery codes. */
export async function verifyMfa(_: LoginState, formData: FormData): Promise<LoginState> {
  const pending = await readPendingMfa();
  if (!pending) redirect("/login");
  if (throttled(`mfa:${pending.userId}`, 6)) return { error: "Too many attempts. Sign in again in 15 minutes." };
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Enter the 6-digit code." };

  const role = await withTenant(pending.tenantId, async (tx) => {
    const [u] = await tx`SELECT role, totp_secret, recovery_codes FROM users WHERE id = ${pending.userId} AND status = 'active'`;
    if (!u?.totp_secret) return null;
    if (verifyCode(decrypt(u.totp_secret), code)) return u.role as string;
    // Recovery codes work once each.
    const hashed = sha256(code);
    const codes = u.recovery_codes as string[];
    if (codes.includes(hashed)) {
      await tx`UPDATE users SET recovery_codes = ${tx.json(codes.filter((c) => c !== hashed) as never)} WHERE id = ${pending.userId}`;
      return u.role as string;
    }
    return null;
  });
  if (!role) return { error: "That code is not valid." };

  await clearPendingMfa();
  await createSession(pending.userId, pending.tenantId);
  redirect(role === "employer" ? "/employer" : "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
