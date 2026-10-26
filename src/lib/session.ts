import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { withTenant } from "./db";
import { can, type Action, type Role } from "./perms";
import { getAccess, lockedMessage } from "./plan";

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 7;
const key = () => new TextEncoder().encode(process.env.SESSION_SECRET);
const secure = () => process.env.NODE_ENV === "production";

export type Ctx = {
  userId: string;
  tenantId: string;
  role: Role;
  name: string;
  employerId: string | null;
  /** Name of the platform administrator when this is a support session. Support sessions are read-only. */
  support: string | null;
};

export async function createSession(userId: string, tenantId: string, support?: { admin: string; seconds: number }) {
  const age = support?.seconds ?? MAX_AGE;
  const token = await new SignJWT({ tid: tenantId, ...(support ? { sup: support.admin } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${age}s`)
    .sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secure(), maxAge: age, path: "/" });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** Reads the cookie, then re-checks the user in the database so role changes and disabled accounts apply at once. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const userId = payload.sub;
    const tenantId = payload.tid as string | undefined;
    if (!userId || !tenantId) return null;
    const rows = await withTenant(
      tenantId,
      (tx) => tx`
        SELECT u.name, u.role, u.employer_id
        FROM users u JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = ${userId} AND u.status = 'active' AND t.status = 'active'`,
    );
    const u = rows[0];
    if (!u) return null;
    return {
      userId,
      tenantId,
      role: u.role as Role,
      name: u.name as string,
      employerId: (u.employer_id as string | null) ?? null,
      support: (payload.sup as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For server actions: stops with an error when the role may not perform the action. */
export async function requireCan(action: Action): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!can(ctx.role, action)) throw new Error("You do not have permission to do that.");
  if (ctx.support) throw new Error("Support access is read-only.");
  const a = await getAccess(ctx.tenantId);
  if (!a.writable) throw new Error(lockedMessage(a));
  return ctx;
}

/** For pages: sends people without permission back to the dashboard instead of showing an error. */
export async function requirePageCan(action: Action): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!can(ctx.role, action)) redirect("/");
  return ctx;
}
