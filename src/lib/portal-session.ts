import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { sql, withCandidate } from "./db";

const COOKIE = "csession";
const MAX_AGE = 60 * 60 * 24 * 14;
const key = () => new TextEncoder().encode(process.env.SESSION_SECRET);

export type Agency = { id: string; name: string; brand_name: string | null; brand_color: string | null; portal_open: boolean };
export type CandidateCtx = { candidateId: string; tenantId: string; name: string; phone: string; email: string | null };

/** Looks an agency up by the address in the URL. Returns only what a public page may show. */
export const getAgency = cache(async (slug: string): Promise<Agency | null> => {
  if (!/^[a-z0-9-]{1,40}$/i.test(slug)) return null;
  const [a] = await sql`SELECT * FROM tenant_public(${slug})`;
  return (a as Agency | undefined) ?? null;
});

export async function requireAgency(slug: string): Promise<Agency> {
  const a = await getAgency(slug);
  if (!a) notFound();
  return a;
}

export async function createCandidateSession(candidateId: string, tenantId: string) {
  const token = await new SignJWT({ tid: tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(candidateId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: MAX_AGE, path: "/c" });
}

export async function destroyCandidateSession() {
  (await cookies()).delete({ name: COOKIE, path: "/c" });
}

/** The signed-in candidate for this agency, re-checked against the database on every request. */
export const getCandidateCtx = cache(async (tenantId: string): Promise<CandidateCtx | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (payload.tid !== tenantId || !payload.sub) return null; // a session for another agency is no session here
    const [c] = await withCandidate(tenantId, payload.sub, (tx) => tx`SELECT first_name, last_name, phone, email, status FROM candidates WHERE id = ${payload.sub!}`);
    if (!c || c.status === "inactive") return null;
    return { candidateId: payload.sub, tenantId, name: `${c.first_name} ${c.last_name}`, phone: c.phone, email: c.email };
  } catch {
    return null;
  }
});

export async function requireCandidate(slug: string): Promise<{ agency: Agency; me: CandidateCtx }> {
  const agency = await requireAgency(slug);
  const me = await getCandidateCtx(agency.id);
  if (!me) redirect(`/c/${slug}/login`);
  return { agency, me };
}
