"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { withEmployer, withTenant } from "@/lib/db";
import { getCtx, type Ctx } from "@/lib/session";
import { audit } from "@/lib/audit";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { moveStage } from "@/lib/pipeline";
import { notifyCandidate } from "@/lib/notify";
import { toMinor } from "@/lib/money";
import { fmtDateTime } from "@/lib/templates";
import { getAccess, lockedMessage } from "@/lib/plan";

async function requireEmployer(): Promise<Ctx & { employerId: string }> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  if (ctx.role !== "employer" || !ctx.employerId) throw new Error("This is only for employers.");
  const a = await getAccess(ctx.tenantId);
  if (!a.features.employer_portal) throw new Error("The employer portal is not available for this agency.");
  if (!a.writable) throw new Error(lockedMessage(a));
  return ctx as Ctx & { employerId: string };
}

/**
 * Employers act on candidates in two steps. First, under the employer's own database session, we confirm the
 * placement really is one of theirs and is at a stage where they may decide. Only then does the change run
 * as a normal agency transaction, so gates, history, audit and candidate messages all apply as usual.
 */
async function ownPlacement(ctx: Ctx & { employerId: string }, placementId: string) {
  const row = await withEmployer(ctx.tenantId, ctx.employerId, async (tx) => {
    const [p] = await tx`
      SELECT p.id, p.candidate_id, p.outcome, p.job_order_id, s.position, j.title
      FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id JOIN job_orders j ON j.id = p.job_order_id
      WHERE p.id = ${placementId}`;
    return p;
  });
  if (!row) throw new Error("That candidate is not on one of your job orders.");
  if (row.outcome === "closed") throw new Error("This application is closed.");
  return row as { id: string; candidate_id: string; job_order_id: string; position: number; title: string };
}

const actor = (ctx: Ctx) => ({ userId: ctx.userId, tenantId: ctx.tenantId, role: ctx.role });

async function stageAt(tx: Parameters<Parameters<typeof withTenant>[1]>[0], position: number) {
  const [s] = await tx`SELECT id FROM pipeline_stages WHERE position = ${position}`;
  return s.id as string;
}

export async function employerInterview(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    try {
      const ctx = await requireEmployer();
      const p = await ownPlacement(ctx, placementId);
      if (p.position !== 2) throw new Error("You can only ask for an interview while the candidate is put forward to you.");
      const when = field(fd, "scheduled_at");
      const at = when ? new Date(when) : null;
      if (!at || Number.isNaN(at.getTime()) || at.getTime() < Date.now()) throw new Error("Choose a date and time in the future.");
      await withTenant(ctx.tenantId, async (tx) => {
        const [a] = await tx`
          INSERT INTO appointments (tenant_id, placement_id, kind, scheduled_at, location, notes)
          VALUES (${ctx.tenantId}, ${placementId}, 'interview', ${at}, ${field(fd, "location") ?? "Online"}, ${field(fd, "notes") ?? ""}) RETURNING id`;
        await tx`INSERT INTO employer_decisions (tenant_id, placement_id, employer_id, decision, note, proposed_at, decided_by)
                 VALUES (${ctx.tenantId}, ${placementId}, ${ctx.employerId}, 'interview', ${field(fd, "notes") ?? ""}, ${at}, ${ctx.userId})`;
        await audit(tx, actor(ctx), "employer.interview", "appointment", a.id);
        const [c] = await tx`SELECT id, first_name, phone, email FROM candidates WHERE id = ${p.candidate_id}`;
        await notifyCandidate(tx, ctx.tenantId, { id: c.id, name: c.first_name, phone: c.phone, email: c.email }, "appointment",
          { kind: "interview", when: fmtDateTime(at), where: field(fd, "location") ?? "Online" });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/employer", "layout");
    return { ok: "Interview requested. The candidate has been told.", next: steps.employerInterview() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function employerSelect(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    let jobId = "";
    try {
      const ctx = await requireEmployer();
      const p = await ownPlacement(ctx, placementId);
      jobId = p.job_order_id;
      if (p.position !== 2) throw new Error("This candidate is not waiting for your decision.");
      await withTenant(ctx.tenantId, async (tx) => {
        const r = await moveStage(tx, actor(ctx), placementId, await stageAt(tx, 3), "Selected by the employer", false);
        if (!r.ok) throw new Error(r.error);
        await tx`INSERT INTO employer_decisions (tenant_id, placement_id, employer_id, decision, note, decided_by)
                 VALUES (${ctx.tenantId}, ${placementId}, ${ctx.employerId}, 'select', ${field(fd, "notes") ?? ""}, ${ctx.userId})`;
        await audit(tx, actor(ctx), "employer.select", "placement", placementId);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/employer", "layout");
    return { ok: "Selected. The agency will prepare the contract.", next: steps.employerSelected(jobId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function employerReject(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    try {
      const ctx = await requireEmployer();
      const p = await ownPlacement(ctx, placementId);
      if (p.position !== 2) throw new Error("This candidate is not waiting for your decision.");
      const reason = field(fd, "notes");
      if (!reason || reason.length < 3) throw new Error("Give a short reason, so the agency can find a better match.");
      await withTenant(ctx.tenantId, async (tx) => {
        await tx`UPDATE placements SET outcome = 'closed', close_reason = ${"Rejected by employer: " + reason}, closed_at = now() WHERE id = ${placementId}`;
        await tx`UPDATE candidates SET status = 'active' WHERE id = ${p.candidate_id}`;
        await tx`INSERT INTO employer_decisions (tenant_id, placement_id, employer_id, decision, note, decided_by)
                 VALUES (${ctx.tenantId}, ${placementId}, ${ctx.employerId}, 'reject', ${reason}, ${ctx.userId})`;
        await audit(tx, actor(ctx), "employer.reject", "placement", placementId, { reason });
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/employer", "layout");
    return { ok: "Candidate declined", next: steps.employerDeclined() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** The employer's own signed terms. The agency compares them with the candidate's copy to catch substitution. */
export async function employerContract(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    try {
      const ctx = await requireEmployer();
      const p = await ownPlacement(ctx, placementId);
      if (p.position < 3) throw new Error("You can record the contract once you have selected the candidate.");
      const salary = toMinor(field(fd, "salary") ?? "");
      if (salary === null || salary < 0) throw new Error("Enter the monthly salary, for example 1300.00.");
      const hours = field(fd, "hours") ? Number(field(fd, "hours")) : null;
      const months = field(fd, "months") ? Number(field(fd, "months")) : null;
      if ((hours !== null && !(hours > 0 && hours <= 100)) || (months !== null && !(months > 0 && months <= 120))) throw new Error("Check the hours per week and contract length.");
      await withTenant(ctx.tenantId, async (tx) => {
        const [c] = await tx`
          INSERT INTO contracts (tenant_id, placement_id, party, salary_minor, currency, hours_per_week, months, other_terms, recorded_by)
          VALUES (${ctx.tenantId}, ${placementId}, 'employer', ${salary}, ${field(fd, "currency") ?? "USD"}, ${hours}, ${months}, ${field(fd, "other_terms") ?? ""}, ${ctx.userId}) RETURNING id`;
        await audit(tx, actor(ctx), "employer.contract", "contract", c.id);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/employer", "layout");
    return { ok: "Contract terms recorded", next: steps.employerContract() };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function requestWorkers(_: FormState, fd: FormData): Promise<FormState> {
  try {
    let id: string;
    try {
      const ctx = await requireEmployer();
      const title = field(fd, "title");
      const country = field(fd, "country");
      const quantity = Number(field(fd, "quantity") ?? 0);
      if (!title || !country) throw new Error("Enter the role and the country the workers will work in.");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw new Error("Enter how many workers you need.");
      id = await withEmployer(ctx.tenantId, ctx.employerId, async (tx) => {
        const [j] = await tx`
          INSERT INTO job_orders (tenant_id, employer_id, title, country, category, quantity, salary, terms, deadline, payment_model, status, requested_by)
          VALUES (${ctx.tenantId}, ${ctx.employerId}, ${title}, ${country}, ${field(fd, "category") ?? ""}, ${quantity}, ${field(fd, "salary") ?? ""},
                  ${field(fd, "terms") ?? ""}, ${field(fd, "deadline")}, 'employer_paid', 'pending', ${ctx.userId}) RETURNING id`;
        await tx`INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id) VALUES (${ctx.tenantId}, ${ctx.userId}, 'employer.request_workers', 'job_order', ${j.id})`;
        return j.id as string;
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath("/employer", "layout");
    redirect(`/employer/jobs/${id}?next=request_sent`);
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
