"use server";

import bcrypt from "bcryptjs";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { createSession, requireCtx } from "@/lib/session";
import { can } from "@/lib/perms";
import { fail, field, type FormState } from "@/lib/form";
import { DEFAULT_STAGES } from "@/lib/stages";
import { forgetLicense, stateFor, verifyKey } from "@/lib/license";
import { isSingleInstall } from "@/lib/plan";

/** First-run setup of a single-agency install: activate it, then create the agency and its first admin. */
export async function runSetup(_: FormState, fd: FormData): Promise<FormState> {
  try {
    if (!isSingleInstall()) return { error: "Setup is only for single-agency installs." };
    const [{ install_has_tenant: exists }] = await sql`SELECT install_has_tenant()`;
    if (exists) return { error: "This install is already set up. Sign in instead." };

    const v = verifyKey(field(fd, "key") ?? "");
    if (!v.ok) return { error: v.message };
    const lic = stateFor(v.payload);
    if (lic.ok && !lic.writable) return { error: "That activation key has ended. Ask for a renewed key." };

    const agency = field(fd, "agency");
    const name = field(fd, "name");
    const email = field(fd, "email");
    const password = field(fd, "password") ?? "";
    if (!agency || !name || !email) return { error: "Enter the agency name and the admin's name and email." };
    if (password.length < 10) return { error: "Use a password of at least 10 characters." };

    const [row] = await sql`
      SELECT platform_create_tenant(${agency}, 'main', ${name}, ${email}, ${await bcrypt.hash(password, 11)}, 'enterprise', 0, ${sql.json(DEFAULT_STAGES as never)}) AS id`;
    await sql`
      INSERT INTO installation (id, customer, activation_key, expires_at, max_users, updates_until)
      VALUES (1, ${v.payload.customer}, ${field(fd, "key")!}, ${v.payload.expires}, ${v.payload.users}, ${v.payload.updatesUntil})
      ON CONFLICT (id) DO UPDATE SET customer = EXCLUDED.customer, activation_key = EXCLUDED.activation_key, expires_at = EXCLUDED.expires_at,
        max_users = EXCLUDED.max_users, updates_until = EXCLUDED.updates_until, activated_at = now()`;
    forgetLicense();
    const [u] = await sql`SELECT id FROM auth_lookup_user(${email})`;
    await createSession(u.id, row.id);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
  redirect("/?next=welcome");
}

/** Replaces the activation key, for example to renew. Allowed even when the old key has ended. */
export async function activateKey(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCtx();
    if (!can(ctx.role, "users:manage")) return { error: "Only an agency admin can change the activation key." };
    if (ctx.support) return { error: "Support access is read-only." };
    if (!isSingleInstall()) return { error: "This is only for single-agency installs." };
    const key = field(fd, "key") ?? "";
    const v = verifyKey(key);
    if (!v.ok) return { error: v.message };
    await sql`
      INSERT INTO installation (id, customer, activation_key, expires_at, max_users, updates_until)
      VALUES (1, ${v.payload.customer}, ${key}, ${v.payload.expires}, ${v.payload.users}, ${v.payload.updatesUntil})
      ON CONFLICT (id) DO UPDATE SET customer = EXCLUDED.customer, activation_key = EXCLUDED.activation_key, expires_at = EXCLUDED.expires_at,
        max_users = EXCLUDED.max_users, updates_until = EXCLUDED.updates_until, activated_at = now()`;
    forgetLicense();
    revalidatePath("/", "layout");
    return { ok: "Activation key saved" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
