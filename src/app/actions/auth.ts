"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { createSession, destroySession } from "@/lib/session";

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

  await createSession(u.id, u.tenant_id);
  redirect(u.role === "employer" ? "/employer" : "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
