"use server";

import bcrypt from "bcryptjs";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { decrypt, encrypt, sha256 } from "@/lib/crypto";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { toMinor } from "@/lib/money";
import { newRecoveryCodes, newSecret, verifyCode } from "@/lib/totp";
import { createSession, destroySession } from "@/lib/session";
import {
  clearPlatformPending, createPlatformPending, createPlatformSession, destroyPlatformSession,
  readPlatformPending, requirePlatform, requirePlatformStrict,
} from "@/lib/platform";

const DUMMY = bcrypt.hashSync("not-a-real-password", 10);
const tries = new Map<string, { n: number; first: number }>();
function throttled(key: string, max: number) {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || now - t.first > 15 * 60_000) { tries.set(key, { n: 1, first: now }); return false; }
  t.n += 1;
  return t.n > max;
}

// ---------------------------------------------------------------- sign in
export async function platformLogin(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const email = (field(fd, "email") ?? "").toLowerCase();
    const password = field(fd, "password") ?? "";
    if (throttled(`plogin:${email}`, 6)) return { error: "Too many attempts. Try again in 15 minutes." };
    const [a] = await sql`SELECT * FROM platform_admin_auth(${email})`;
    const ok = await bcrypt.compare(password, a?.password_hash ?? DUMMY);
    if (!a || !ok) return { error: "Incorrect email or password." };
    if (a.totp_enabled) {
      await createPlatformPending(a.id);
      redirect("/platform/login/verify");
    }
    await createPlatformSession(a.id);
    redirect("/platform/security");
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function platformVerify(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const id = await readPlatformPending();
    if (!id) redirect("/platform/login");
    if (throttled(`pmfa:${id}`, 6)) return { error: "Too many attempts. Sign in again in 15 minutes." };
    const code = (field(fd, "code") ?? "").trim();
    const [a] = await sql`SELECT * FROM platform_admin_get(${id})`;
    if (!a?.totp_secret) redirect("/platform/login");
    let ok = verifyCode(decrypt(a.totp_secret), code);
    if (!ok) {
      const [auth] = await sql`SELECT recovery_codes FROM platform_admin_auth(${a.email})`;
      const codes = (auth?.recovery_codes ?? []) as string[];
      const h = sha256(code);
      if (codes.includes(h)) {
        await sql`SELECT platform_admin_use_recovery(${id}, ${sql.json(codes.filter((c) => c !== h) as never)})`;
        ok = true;
      }
    }
    if (!ok) return { error: "That code is not valid." };
    await clearPlatformPending();
    await createPlatformSession(id);
    redirect("/platform");
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function platformLogout() {
  await destroyPlatformSession();
  redirect("/platform/login");
}

// ---------------------------------------------------------------- two-step sign-in and password
export async function platformStartTotp(_: FormState): Promise<FormState> {
  try {
    const a = await requirePlatform();
    await sql`SELECT platform_admin_set_totp(${a.id}, ${encrypt(newSecret())}, false, '[]')`;
    revalidatePath("/platform/security");
    return { ok: "Scan the code below" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function platformConfirmTotp(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const a = await requirePlatform();
    const [row] = await sql`SELECT * FROM platform_admin_get(${a.id})`;
    if (!row.totp_secret || row.totp_enabled) return { error: "Start setup first." };
    if (!verifyCode(decrypt(row.totp_secret), field(fd, "code") ?? "")) return { error: "That code is not valid." };
    const rc = newRecoveryCodes();
    await sql`SELECT platform_admin_set_totp(${a.id}, ${row.totp_secret}, true, ${sql.json(rc.hashed as never)})`;
    revalidatePath("/platform/security");
    return { ok: "Two-step sign-in is on. Save these recovery codes now; each works once and they are not shown again.", data: rc.plain, next: steps.platformSecurity("Two-step sign-in is on. Copy the recovery codes shown on the page first.") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function platformChangePassword(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const a = await requirePlatform();
    const [row] = await sql`SELECT * FROM platform_admin_get(${a.id})`;
    const next = field(fd, "next") ?? "";
    if (next.length < 12) return { error: "Use at least 12 characters." };
    if (!(await bcrypt.compare(field(fd, "current") ?? "", row.password_hash))) return { error: "Your current password is not right." };
    await sql`SELECT platform_admin_set_password(${a.id}, ${await bcrypt.hash(next, 11)})`;
    return { ok: "Password changed", next: steps.platformSecurity("Password changed") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- agencies
const note = (a: { name: string }) => a.name;

export async function setTenantPlan(tenantId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const a = await requirePlatformStrict();
    try {
      await sql`SELECT platform_set_plan(${tenantId}, ${field(fd, "plan") ?? ""}, ${note(a)})`;
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/platform/tenants/${tenantId}`);
    return { ok: "Plan changed", next: steps.tenantUpdated(tenantId, "Plan changed") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function setTenantStatus(tenantId: string, status: "active" | "suspended", _: FormState): Promise<FormState> {
  try {
    const a = await requirePlatformStrict();
    try {
      await sql`SELECT platform_set_status(${tenantId}, ${status}, ${note(a)})`;
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/platform/tenants/${tenantId}`);
    revalidatePath("/platform/tenants");
    return { ok: status === "suspended" ? "Suspended" : "Reactivated", next: steps.tenantUpdated(tenantId, status === "suspended" ? "Agency suspended" : "Agency reactivated") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function extendTrial(tenantId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const a = await requirePlatformStrict();
    const days = Number(field(fd, "days") ?? 0);
    if (!Number.isInteger(days) || days < 1 || days > 90) return { error: "Enter between 1 and 90 days." };
    try {
      await sql`SELECT platform_extend_trial(${tenantId}, ${days}, ${note(a)})`;
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/platform/tenants/${tenantId}`);
    return { ok: `Extended by ${days} days`, next: steps.tenantUpdated(tenantId, `Trial extended by ${days} days`) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function recordManualPayment(tenantId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const a = await requirePlatformStrict();
    const amount = toMinor(field(fd, "amount") ?? "");
    const months = Number(field(fd, "months") ?? 0);
    const method = field(fd, "method");
    if (amount === null || amount < 0) return { error: "Enter the amount received, or 0 for a complimentary period." };
    if (!method || !["bank", "cash", "mpesa", "card", "complimentary"].includes(method)) return { error: "Choose the payment method." };
    if (!Number.isInteger(months) || months < 1 || months > 36) return { error: "Enter between 1 and 36 months." };
    if (method !== "complimentary" && !field(fd, "reference")) return { error: "Enter the transaction reference, so it cannot be recorded twice." };
    try {
      await sql`SELECT platform_record_payment(${tenantId}, ${amount}, ${method}, ${field(fd, "reference") ?? ""}, ${months}, ${field(fd, "plan") ?? ""}, ${note(a)})`;
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/platform/tenants/${tenantId}`);
    return { ok: "Payment recorded and the plan extended", next: steps.tenantUpdated(tenantId, "Payment recorded, plan extended") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Read-only access to an agency's own screens, for support. A reason is required and is shown in the agency's activity log. */
export async function startSupportAccess(tenantId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const a = await requirePlatformStrict();
    const reason = field(fd, "reason") ?? "";
    if (reason.length < 8) return { error: "Write the reason for looking at this agency, for example the ticket number and problem." };
    const [u] = await sql`SELECT platform_support_user(${tenantId}) AS id`;
    if (!u?.id) return { error: "This agency has no active admin to view as." };
    await sql`SELECT platform_note(${tenantId}, ${a.name}, 'platform.support_access', ${sql.json({ reason } as never)})`;
    await createSession(u.id, tenantId, { admin: a.name, seconds: 3600 });
    redirect("/");
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function exitSupport() {
  await destroySession();
  redirect("/platform/tenants");
}

// ---------------------------------------------------------------- plans and administrators
export async function updatePlan(code: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    await requirePlatformStrict();
    const price = toMinor(field(fd, "price") ?? "");
    if (price === null || price < 0) return { error: "Enter the monthly price in KES." };
    const num = (n: string) => (field(fd, n) ? Number(field(fd, n)) : null);
    const features = Object.fromEntries(["candidate_portal", "employer_portal", "mpesa", "whatsapp", "reports", "exports"].map((k) => [k, fd.get(`f_${k}`) === "on"]));
    try {
      await sql`SELECT platform_update_plan(${code}, ${field(fd, "name") ?? code}, ${price}, ${num("max_users")}, ${num("max_candidates")}, ${sql.json(features as never)}, ${fd.get("active") === "on"})`;
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/platform/plans");
    return { ok: "Plan saved", next: steps.planSaved() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function createPlatformAdmin(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await requirePlatformStrict();
    const email = field(fd, "email");
    const name = field(fd, "name");
    const password = field(fd, "password") ?? "";
    if (!email || !name) return { error: "Enter a name and an email." };
    if (password.length < 12) return { error: "Use a temporary password of at least 12 characters." };
    try {
      await sql`SELECT platform_admin_create(${email}, ${name}, ${await bcrypt.hash(password, 11)})`;
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/platform/admins");
    return { ok: "Administrator added. They must set up two-step sign-in when they first sign in.", next: steps.adminChanged("Administrator added") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function setPlatformAdminStatus(id: string, status: "active" | "disabled", _: FormState): Promise<FormState> {
  try {
    const a = await requirePlatformStrict();
    if (a.id === id) return { error: "You cannot disable your own account." };
    await sql`SELECT platform_admin_set_status(${id}, ${status})`;
    revalidatePath("/platform/admins");
    return { ok: "Updated", next: steps.adminChanged(status === "active" ? "Administrator enabled" : "Administrator disabled") };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- platform settings
type FieldKind = "text" | "secret" | "bool" | "int" | "kes";
const SECTIONS: Record<string, { title: string; fields: Record<string, FieldKind> }> = {
  signup: { title: "Sign-up", fields: { enabled: "bool", trial_days: "int" } },
  credits: { title: "SMS credits", fields: { price_minor: "kes", free_on_signup: "int" } },
  sms: { title: "SMS (BlessedTexts)", fields: { api_key: "secret", sender_id: "text", endpoint: "text" } },
  email: { title: "Email (Brevo)", fields: { api_key: "secret", from_email: "text", from_name: "text" } },
  mpesa: { title: "M-Pesa (payments to you)", fields: { env: "text", type: "text", shortcode: "text", consumer_key: "secret", consumer_secret: "secret", passkey: "secret" } },
  stripe: { title: "Card payments (Stripe)", fields: { secret_key: "secret", webhook_secret: "secret" } },
};

/** Saves one block of platform settings. A secret left blank keeps what was saved; everything else is replaced. */
export async function savePlatformSection(section: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const a = await requirePlatformStrict();
    const spec = SECTIONS[section];
    if (!spec) return { error: "Unknown settings section." };
    const current = ((await sql`SELECT key, value FROM platform_settings_all()`) as unknown as { key: string; value: Record<string, unknown> }[]).find((r) => r.key === section)?.value ?? {};
    const next: Record<string, unknown> = {};
    for (const [k, kind] of Object.entries(spec.fields)) {
      const v = field(fd, k);
      if (kind === "secret") {
        if (v) next[`${k}_enc`] = encrypt(v);
        else if (current[`${k}_enc`]) next[`${k}_enc`] = current[`${k}_enc`];
      } else if (kind === "bool") next[k] = fd.get(k) === "on";
      else if (kind === "int") {
        if (v === null) continue;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: `${k.replace(/_/g, " ")} must be a whole number.` };
        next[k] = n;
      } else if (kind === "kes") {
        if (v === null) continue;
        const m = toMinor(v);
        if (m === null || m <= 0) return { error: "Enter the price in shillings, for example 0.40." };
        next[k] = m;
      } else if (v !== null) next[k] = v;
    }
    if (section === "sms" && typeof next.endpoint === "string" && !/^https:\/\//.test(next.endpoint)) return { error: "The sending address must start with https://." };
    await sql`SELECT platform_setting_save(${section}, ${sql.json(next as never)}, ${a.name})`;
    revalidatePath("/platform/settings");
    revalidatePath("/", "layout");
    return { ok: "Saved", next: steps.platformSaved(spec.title) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function reviewSender(id: string, status: "approved" | "rejected", _: FormState, fd: FormData): Promise<FormState> {
  try {
    const a = await requirePlatformStrict();
    await sql`SELECT platform_sender_review(${id}, ${status}, ${field(fd, "note") ?? ""}, ${a.name})`;
    revalidatePath("/platform/senders");
    return { ok: status === "approved" ? "Approved" : "Rejected", next: steps.senderReviewed(status) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function grantCredits(tenantId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const a = await requirePlatformStrict();
    const n = Number(field(fd, "credits") ?? 0);
    if (!Number.isInteger(n) || n < 1 || n > 100000) return { error: "Enter a whole number of credits, from 1 to 100,000." };
    await sql`SELECT platform_credits_grant(${tenantId}, ${n}, ${a.name})`;
    revalidatePath(`/platform/tenants/${tenantId}`);
    return { ok: `Added ${n} credits`, next: steps.tenantUpdated(tenantId, `${n} credits added`) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
