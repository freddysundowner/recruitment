"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { sql, withTenant } from "@/lib/db";
import { createSession } from "@/lib/session";
import { fail, field, type FormState } from "@/lib/form";
import { DEFAULT_STAGES } from "@/lib/stages";
import { queueMessage } from "@/lib/notify";
import { signupEnabled, trialDays } from "@/lib/plan";

const hits = new Map<string, { n: number; first: number }>();
function tooMany(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.first > 60 * 60_000) { hits.set(ip, { n: 1, first: now }); return false; }
  h.n += 1;
  return h.n > 5;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);

const Schema = z.object({
  agency: z.string().min(2, "Enter your agency's name"),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "The web address can use letters, numbers and dashes, 3 to 40 characters"),
  name: z.string().min(2, "Enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(10, "Use a password of at least 10 characters"),
  plan: z.string().min(1),
});

const MESSAGES: Record<string, string> = {
  slug_taken: "That web address is already taken. Try another.",
  reserved_slug: "That web address is reserved. Try another.",
  email_taken: "An account with this email already exists. Sign in instead.",
  bad_plan: "Choose one of the plans.",
};

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  try {
    if (!signupEnabled()) return { error: "Sign-up is closed. Contact us to open an account." };
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    if (tooMany(ip)) return { error: "Too many sign-ups from this connection. Try again later." };
    const p = Schema.safeParse({
      agency: field(fd, "agency"), slug: slugify(field(fd, "slug") ?? field(fd, "agency") ?? ""), name: field(fd, "name"),
      email: field(fd, "email"), password: field(fd, "password"), plan: field(fd, "plan"),
    });
    if (!p.success) return { error: p.error.issues[0].message };
    if (fd.get("terms") !== "on") return { error: "Please accept the terms to continue." };

    let tenantId: string, userId: string;
    try {
      const [row] = await sql`
        SELECT platform_create_tenant(${p.data.agency}, ${p.data.slug}, ${p.data.name}, ${p.data.email}, ${await bcrypt.hash(p.data.password, 11)},
          ${p.data.plan}, ${trialDays()}, ${sql.json(DEFAULT_STAGES as never)}) AS id`;
      tenantId = row.id;
      const [u] = await sql`SELECT id FROM auth_lookup_user(${p.data.email})`;
      userId = u.id;
      // A new workspace starts with the two strictest rules relaxed so it is easy to try; Settings turns them on.
      await withTenant(tenantId, (tx) => tx`UPDATE tenants SET settings = settings || ${tx.json({ rules: { contract_check: false, require_vetting: false } })}`);
      await withTenant(tenantId, (tx) => queueMessage(tx, tenantId, {
        channel: "email", to: p.data.email, subject: `Welcome to ${p.data.agency}'s new workspace`, template: "tenant_welcome",
        body: `Hello ${p.data.name},\n\nYour agency workspace is ready, with a ${trialDays()}-day free trial.\n\nStaff sign in: ${process.env.APP_URL ?? ""}/login\nCandidates register and sign in: ${process.env.APP_URL ?? ""}/c/${p.data.slug}\n\nA good first hour: add your team, import your candidates from a spreadsheet, add an employer and a job order.`,
      }));
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (MESSAGES[code]) return { error: MESSAGES[code] };
      return fail(e);
    }
    await createSession(userId, tenantId);
    redirect("/?next=welcome");
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
