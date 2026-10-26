"use server";

import bcrypt from "bcryptjs";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { requireCan } from "@/lib/session";
import { audit } from "@/lib/audit";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { toMinor } from "@/lib/money";
import { assertFeature, assertUserSlot, getAccess } from "@/lib/plan";

// ---------------------------------------------------------------- employers
const EmployerSchema = z.object({
  company: z.string().min(1, "Company name is required"),
  country: z.string().min(1, "Country is required"),
  contact_name: z.string().nullable(),
  email: z.email("Enter a valid email").nullable(),
  phone: z.string().nullable(),
  currency: z.string().min(3),
  notes: z.string().nullable(),
});

export async function createEmployer(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("employers:write");
    const p = EmployerSchema.safeParse({
      company: field(fd, "company"),
      country: field(fd, "country"),
      contact_name: field(fd, "contact_name"),
      email: field(fd, "email"),
      phone: field(fd, "phone"),
      currency: field(fd, "currency") ?? "USD",
      notes: field(fd, "notes"),
    });
    if (!p.success) return { error: p.error.issues[0].message };
    const e = p.data;
    let id: string;
    try {
      id = await withTenant(ctx.tenantId, async (tx) => {
        const [r] = await tx`
          INSERT INTO employers (tenant_id, company, country, contact_name, email, phone, currency, notes)
          VALUES (${ctx.tenantId}, ${e.company}, ${e.country}, ${e.contact_name}, ${e.email}, ${e.phone}, ${e.currency}, ${e.notes ?? ""})
          RETURNING id`;
        await audit(tx, ctx, "employer.create", "employer", r.id, { company: e.company });
        return r.id as string;
      });
    } catch (err) {
      return fail(err);
    }
    revalidatePath("/employers");
    redirect(`/employers/${id}?next=employer_created&ref=${id}`);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function setVetted(employerId: string, vetted: boolean, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("employers:write");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        if (vetted) {
          // An employer can only be marked vetted once a registration check has passed and nothing is still of concern.
          const checks = await tx`SELECT kind, result FROM employer_checks WHERE employer_id = ${employerId}`;
          if (!checks.some((c) => c.kind === "registration" && c.result === "ok")) {
            throw new Error("Record a passed registration check before marking this employer as vetted.");
          }
          if (checks.some((c) => c.result === "concern") && !checks.some((c) => c.result === "ok" && c.kind === "references")) {
            throw new Error("There is an open concern on this employer. Record a passed references check to clear it.");
          }
        }
        await tx`UPDATE employers SET vetted = ${vetted} WHERE id = ${employerId}`;
        await audit(tx, ctx, vetted ? "employer.vet" : "employer.unvet", "employer", employerId);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/employers/${employerId}`);
    revalidatePath("/employers");
    return { ok: vetted ? "Marked as vetted" : "Vetting removed", next: vetted ? steps.employerVetted(employerId) : undefined };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- job orders
export async function createJobOrder(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("joborders:write");
    const employerId = field(fd, "employer_id");
    const title = field(fd, "title");
    const country = field(fd, "country");
    const quantity = Number(field(fd, "quantity") ?? 0);
    const model = field(fd, "payment_model");
    if (!employerId || !title || !country) return { error: "Employer, title and country are required." };
    if (!Number.isInteger(quantity) || quantity < 1) return { error: "Quantity must be at least 1." };
    if (model !== "employer_paid" && model !== "candidate_paid") return { error: "Choose who pays the costs." };
    const fee = toMinor(field(fd, "fee") ?? "0") ?? 0;
    let id: string;
    try {
      id = await withTenant(ctx.tenantId, async (tx) => {
        const [r] = await tx`
          INSERT INTO job_orders (tenant_id, employer_id, title, country, category, quantity, salary, terms, deadline, payment_model, placement_fee_minor, fee_currency)
          VALUES (${ctx.tenantId}, ${employerId}, ${title}, ${country}, ${field(fd, "category") ?? ""}, ${quantity}, ${field(fd, "salary") ?? ""}, ${field(fd, "terms") ?? ""},
                  ${field(fd, "deadline")}, ${model}, ${fee}, ${field(fd, "fee_currency") ?? "USD"})
          RETURNING id`;
        await audit(tx, ctx, "joborder.create", "job_order", r.id, { title, quantity });
        return r.id as string;
      });
    } catch (err) {
      return fail(err);
    }
    revalidatePath("/job-orders");
    redirect(`/job-orders/${id}?next=job_order_created&ref=${id}`);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function setJobOrderStatus(id: string, status: "open" | "closed", _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("joborders:write");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`UPDATE job_orders SET status = ${status} WHERE id = ${id}`;
        await audit(tx, ctx, `joborder.${status}`, "job_order", id);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/job-orders/${id}`);
    revalidatePath("/job-orders");
    return { ok: status === "closed" ? "Closed" : "Reopened" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- settings
export async function addUser(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    const p = z
      .object({
        name: z.string().min(1, "Enter a name"),
        email: z.email("Enter a valid email"),
        role: z.enum(["admin", "recruiter", "documentation", "finance"]),
        password: z.string().min(10, "The password needs at least 10 characters"),
      })
      .safeParse({ name: field(fd, "name"), email: field(fd, "email"), role: field(fd, "role"), password: field(fd, "password") });
    if (!p.success) return { error: p.error.issues[0].message };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await assertUserSlot(tx, ctx.tenantId);
        const hash = await bcrypt.hash(p.data.password, 10);
        const [u] = await tx`
          INSERT INTO users (tenant_id, name, email, password_hash, role)
          VALUES (${ctx.tenantId}, ${p.data.name}, ${p.data.email}, ${hash}, ${p.data.role}) RETURNING id`;
        await audit(tx, ctx, "user.create", "user", u.id, { email: p.data.email, role: p.data.role });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/settings", "layout");
    return { ok: "User added", next: steps.userAdded() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function setUserStatus(userId: string, status: "active" | "disabled", _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    if (userId === ctx.userId) return { error: "You cannot disable your own account." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`UPDATE users SET status = ${status} WHERE id = ${userId}`;
        await audit(tx, ctx, `user.${status}`, "user", userId);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/settings", "layout");
    return { ok: "Updated" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function setFeeCap(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    const raw = field(fd, "cap");
    const cap = raw === null ? null : toMinor(raw);
    if (raw !== null && (cap === null || cap <= 0)) return { error: "Enter an amount such as 25000.00, or leave empty for no limit." };
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`
          UPDATE tenants SET settings = CASE WHEN ${cap}::bigint IS NULL THEN settings - 'max_candidate_fee_minor'
            ELSE jsonb_set(settings, '{max_candidate_fee_minor}', to_jsonb(${cap}::bigint)) END`;
        await audit(tx, ctx, "settings.fee_cap", "tenant", ctx.tenantId, { cap });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/settings", "layout");
    return { ok: "Saved" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Merges some settings into the agency's saved settings and records who changed them. */
async function mergeSettings(ctx: Awaited<ReturnType<typeof requireCan>>, patch: Record<string, unknown>, action: string, detail: Record<string, unknown> = {}) {
  await withTenant(ctx.tenantId, async (tx) => {
    await tx`UPDATE tenants SET settings = settings || ${tx.json(patch as never)}`;
    await audit(tx, ctx, action, "tenant", ctx.tenantId, detail);
  });
  revalidatePath("/settings", "layout");
}

export async function saveGeneral(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    const color = field(fd, "brand_color");
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return { error: "The colour must look like #0f6b5c." };
    const portal = fd.get("candidate_portal") === "on";
    if (portal && !(await getAccess(ctx.tenantId)).features.candidate_portal) return { error: "The candidate portal is not part of your plan. Upgrade on the Billing page." };
    await mergeSettings(ctx, { brand_name: field(fd, "brand_name"), brand_color: color, candidate_portal: portal }, "settings.general", { portal });
    return { ok: "Saved" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function saveMessaging(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    const channels = ["sms", "whatsapp", "email"].filter((c) => fd.get(`ch_${c}`) === "on");
    if (channels.length === 0) return { error: "Choose at least one way to message candidates." };
    if (channels.includes("whatsapp") && !(await getAccess(ctx.tenantId)).features.whatsapp) return { error: "WhatsApp messaging is not part of your plan. Upgrade on the Billing page." };
    await mergeSettings(ctx, { notify_channels: channels }, "settings.messaging", { channels });
    return { ok: "Saved" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function saveSecurity(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("users:manage");
    const require2fa = fd.get("require_2fa") === "on";
    await mergeSettings(ctx, { require_2fa: require2fa }, "settings.security", { require2fa });
    return { ok: require2fa ? "Two-step sign-in is now required for everyone" : "Saved" };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

// ---------------------------------------------------------------- employer portal accounts
export async function createEmployerUser(employerId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("employers:write");
    const p = z
      .object({ name: z.string().min(1, "Enter a name"), email: z.email("Enter a valid email"), password: z.string().min(10, "The temporary password needs at least 10 characters") })
      .safeParse({ name: field(fd, "name"), email: field(fd, "email"), password: field(fd, "password") });
    if (!p.success) return { error: p.error.issues[0].message };
    try {
      await assertFeature(ctx.tenantId, "employer_portal", "The employer portal");
      await withTenant(ctx.tenantId, async (tx) => {
        const [u] = await tx`
          INSERT INTO users (tenant_id, name, email, password_hash, role, employer_id)
          VALUES (${ctx.tenantId}, ${p.data.name}, ${p.data.email}, ${await bcrypt.hash(p.data.password, 10)}, 'employer', ${employerId}) RETURNING id`;
        await audit(tx, ctx, "user.create_employer", "user", u.id, { email: p.data.email });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/employers/${employerId}`);
    return { ok: "Portal login created. Share the temporary password privately; they can change it after signing in.", next: steps.employerLogin(employerId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Approves an employer's request for workers, choosing who pays the costs and the placement fee. */
export async function approveJobOrder(id: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("joborders:write");
    const model = field(fd, "payment_model");
    if (model !== "employer_paid" && model !== "candidate_paid") return { error: "Choose who pays the costs." };
    const fee = toMinor(field(fd, "fee") ?? "0") ?? 0;
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`UPDATE job_orders SET status = 'open', payment_model = ${model}, placement_fee_minor = ${fee}, fee_currency = ${field(fd, "fee_currency") ?? "USD"}
                 WHERE id = ${id} AND status = 'pending'`;
        await audit(tx, ctx, "joborder.approve", "job_order", id, { model });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/job-orders/${id}`);
    revalidatePath("/job-orders");
    return { ok: "Approved and open", next: steps.jobOrderApproved(id) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
