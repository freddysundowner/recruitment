import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { sql } from "./db";

// Platform administrators sit above every agency. They have their own sign-in, their own cookie (only sent
// to /platform), and must use two-step sign-in. They reach agency data only through named database functions.
const COOKIE = "psession";
const MFA = "pmfa";
const MAX_AGE = 60 * 60 * 8;
const key = () => new TextEncoder().encode(process.env.SESSION_SECRET);
const secure = () => process.env.NODE_ENV === "production";

export type PlatformAdmin = { id: string; name: string; email: string; totpEnabled: boolean };

export async function createPlatformSession(adminId: string) {
  const token = await new SignJWT({ p: true }).setProtectedHeader({ alg: "HS256" }).setSubject(adminId).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: secure(), maxAge: MAX_AGE, path: "/platform" });
}
export async function destroyPlatformSession() {
  (await cookies()).delete({ name: COOKIE, path: "/platform" });
}
export async function createPlatformPending(adminId: string) {
  const token = await new SignJWT({ pm: true }).setProtectedHeader({ alg: "HS256" }).setSubject(adminId).setExpirationTime("5m").sign(key());
  (await cookies()).set(MFA, token, { httpOnly: true, sameSite: "strict", secure: secure(), maxAge: 300, path: "/platform" });
}
export async function readPlatformPending(): Promise<string | null> {
  const t = (await cookies()).get(MFA)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, key());
    return payload.pm && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
export async function clearPlatformPending() {
  (await cookies()).delete({ name: MFA, path: "/platform" });
}

export const getPlatformAdmin = cache(async (): Promise<PlatformAdmin | null> => {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, key());
    if (!payload.p || !payload.sub) return null;
    const [a] = await sql`SELECT * FROM platform_admin_get(${payload.sub})`;
    return a ? { id: a.id, name: a.name, email: a.email, totpEnabled: a.totp_enabled } : null;
  } catch {
    return null;
  }
});

export async function requirePlatform(): Promise<PlatformAdmin> {
  const a = await getPlatformAdmin();
  if (!a) redirect("/platform/login");
  return a;
}

/** For actions: a signed-in platform admin who has finished setting up two-step sign-in. */
export async function requirePlatformStrict(): Promise<PlatformAdmin> {
  const a = await requirePlatform();
  if (!a.totpEnabled) throw new Error("Set up two-step sign-in first.");
  return a;
}
