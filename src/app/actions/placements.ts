"use server";

import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireCan } from "@/lib/session";
import { audit } from "@/lib/audit";
import { steps } from "@/lib/next-steps";
import { fail, field, type FormState } from "@/lib/form";
import { moveStage } from "@/lib/pipeline";
import { assignJob } from "@/lib/assign";
import { CLOSE_REASONS } from "@/lib/stages";

function refresh(placementId: string, candidateId?: string) {
  revalidatePath("/candidates/[id]", "page");
  revalidatePath("/pipeline");
  revalidatePath("/candidates");
  if (candidateId) revalidatePath(`/candidates/${candidateId}`);
}

/** Shortlist: attach a job order to the candidate's placement. Payment model comes from the job order. */
export async function assignJobOrder(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    const jobId = field(fd, "job_order_id");
    if (!jobId) return { error: "Choose a job order." };
    try {
      await withTenant(ctx.tenantId, (tx) => assignJob(tx, ctx, placementId, jobId));
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Job order assigned", next: steps.jobAssigned(placementId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function moveStageAction(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    const target = field(fd, "stage_id");
    if (!target) return { error: "Choose a stage." };
    const note = field(fd, "note") ?? "";
    const override = fd.get("override") === "on";
    let moved: ReturnType<typeof steps.stageMoved> | undefined;
    try {
      const res = await withTenant(ctx.tenantId, async (tx) => {
        const r = await moveStage(tx, ctx, placementId, target, note, override);
        if (!r.ok) return r;
        const [s] = await tx`SELECT s.position, s.name, p.candidate_id FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id WHERE p.id = ${placementId}`;
        return { ...r, position: s.position as number, stage: s.name as string, candidateId: s.candidate_id as string };
      });
      if (!res.ok) return { error: res.error };
      moved = steps.stageMoved(placementId, res.position, res.stage, res.candidateId);
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Stage updated", next: moved };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

export async function closePlacement(placementId: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    const reason = field(fd, "reason");
    if (!reason || !CLOSE_REASONS.includes(reason)) return { error: "Choose a reason." };
    const note = field(fd, "note");
    let cid = "";
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const [p] = await tx`
          UPDATE placements SET outcome = 'closed', close_reason = ${note ? `${reason}: ${note}` : reason}, closed_at = now()
          WHERE id = ${placementId} AND outcome <> 'closed' RETURNING candidate_id`;
        if (!p) throw new Error("Placement not found or already closed.");
        cid = p.candidate_id;
        // Completed workers stay marked as placed; everyone else returns to the pool.
        await tx`UPDATE candidates SET status = ${reason === "Completed" ? "placed" : "active"} WHERE id = ${p.candidate_id}`;
        await audit(tx, ctx, "placement.close", "placement", placementId, { reason, note });
      });
    } catch (e) {
      return fail(e);
    }
    refresh(placementId);
    return { ok: "Placement closed", next: steps.placementClosed(cid) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}

/** Puts a returning candidate back in the pipeline at the first stage after a closed placement. */
export async function reopenCandidate(candidateId: string, _: FormState): Promise<FormState> {
  try {
    const ctx = await requireCan("pipeline:move");
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        const live = await tx`SELECT 1 FROM placements WHERE candidate_id = ${candidateId} AND outcome <> 'closed'`;
        if (live.length) throw new Error("This candidate is already in the pipeline.");
        const [stage] = await tx`SELECT id FROM pipeline_stages ORDER BY position LIMIT 1`;
        const [pl] = await tx`
          INSERT INTO placements (tenant_id, candidate_id, stage_id) VALUES (${ctx.tenantId}, ${candidateId}, ${stage.id}) RETURNING id`;
        await tx`INSERT INTO stage_history (tenant_id, placement_id, to_stage_id, user_id, note)
                 VALUES (${ctx.tenantId}, ${pl.id}, ${stage.id}, ${ctx.userId}, 'Re-entered the pipeline')`;
        await tx`UPDATE candidates SET status = 'active' WHERE id = ${candidateId}`;
        await audit(tx, ctx, "placement.reopen", "candidate", candidateId);
      });
    } catch (e) {
      return fail(e);
    }
    revalidatePath(`/candidates/${candidateId}`);
    revalidatePath("/pipeline");
    return { ok: "Back in the pipeline", next: steps.candidateReopened(candidateId) };
  } catch (e) {
    unstable_rethrow(e);
    return fail(e);
  }
}
