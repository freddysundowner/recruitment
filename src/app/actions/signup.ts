"use server";

import bcrypt from "bcryptjs";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { sql, withTenant } from "@/lib/db";
import { createSession } from "@/lib/session";
import { fail, field, type FormState } from "@/lib/form";
import { DEFAULT_STAGES } from "@/lib/stages";
import { queueMessage } from "@/lib/notify";
import { getPlatformConfig } from "@/lib/platform-config";

// Everyone starts the free trial on the full plan, so they can try everything.
const TRIAL_PLAN = "pro";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);

const Schema = z.object({
  agency: z.string().min(2, "Enter your agency's name"),
  name: z.string().min(2, "Enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use a password of at least 8 characters"),
});

const MESSAGES: Record<string, string> = {
  slug_taken: "That web address is already taken. Try another.",
  reserved_slug: "That web address is reserved. Try another.",
  email_taken: "An account with this email already exists. Sign in instead.",
  bad_plan: "Choose one of the plans.",
};

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const cfg = await getPlatformConfig();
    if (!cfg.signup.enabled) return { error: "Sign-up is closed. Contact us to open an account." };
    const p = Schema.safeParse({
      agency: field(fd, "agency"), name: field(fd, "name"), email: field(fd, "email"), password: field(fd, "password"),
    });
    if (!p.success) return { error: p.error.issues[0].message };
    if (fd.get("terms") !== "on") return { error: "Please accept the terms to continue." };

    let tenantId: string, userId: string;
    try {
      // The candidate page address comes from the agency's name; if someone has it already, a short suffix makes it unique.
      const base = slugify(p.data.agency).padEnd(3, "x") || "agency";
      const hash = await bcrypt.hash(p.data.password, 11);
      let id: string | undefined;
      let slugUsed = base;
      for (let attempt = 0; !id; attempt++) {
        const slug = attempt === 0 ? base : `${base.slice(0, 33)}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          const [row] = await sql`
            SELECT platform_create_tenant(${p.data.agency}, ${slug}, ${p.data.name}, ${p.data.email}, ${hash},
              ${TRIAL_PLAN}, ${cfg.signup.trialDays}, ${sql.json(DEFAULT_STAGES as never)}) AS id`;
          id = row.id;
          slugUsed = slug;
        } catch (e) {
          const code = e instanceof Error ? e.message : "";
          if ((code === "slug_taken" || code === "reserved_slug") && attempt < 6) continue;
          throw e;
        }
      }
      tenantId = id;
      const [u] = await sql`SELECT id FROM auth_lookup_user(${p.data.email})`;
      userId = u.id;
      // The starting SMS credits, drawn from the platform account until the agency buys more.
      if (cfg.credits.freeOnSignup > 0) await sql`SELECT sms_credits_add(${tenantId}, ${cfg.credits.freeOnSignup}, 'signup_grant', 'initial')`;
      // A new workspace starts with the two strictest rules relaxed so it is easy to try; Settings turns them on.
      await withTenant(tenantId, (tx) => tx`UPDATE tenants SET settings = settings || ${tx.json({ rules: { contract_check: false, require_vetting: false } })}`);
      await withTenant(tenantId, (tx) => queueMessage(tx, tenantId, {
        channel: "email", to: p.data.email, subject: `Welcome to ${p.data.agency}'s new workspace`, template: "tenant_welcome",
        body: `Hello ${p.data.name},\n\nYour agency workspace is ready, with a ${cfg.signup.trialDays}-day free trial.\n\nStaff sign in: ${process.env.APP_URL ?? ""}/login\nCandidates register and sign in: ${process.env.APP_URL ?? ""}/c/${slugUsed}\n\nA good first hour: add your team, import your candidates from a spreadsheet, add an employer and a job order.`,
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
