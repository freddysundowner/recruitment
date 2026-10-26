import type { Sql } from "./db";
import type { Actor } from "./actor";
import { audit } from "./audit";
import { can } from "./perms";
import { notifyCandidate, notifyEmployer } from "./notify";

export type MoveResult = { ok: true } | { ok: false; error: string };

/** Charges that are due now, minus what the candidate has paid. Future instalments do not block. */
export async function balanceDue(tx: Sql, placementId: string): Promise<number> {
  const [r] = await tx`
    SELECT
      COALESCE((SELECT sum(amount_minor) FROM fee_charges
                WHERE placement_id = ${placementId} AND (due_on IS NULL OR due_on <= current_date)), 0)
      - COALESCE((SELECT sum(amount_minor) FROM payments
                WHERE placement_id = ${placementId} AND party = 'candidate'), 0) AS due`;
  return Number(r.due);
}

type ContractRow = { salary_minor: string | number; currency: string; hours_per_week: number | null; months: number | null };

/** Lists the key terms that differ between the candidate's copy and the employer's copy of a contract. */
export function diffContracts(a: ContractRow, b: ContractRow): string[] {
  const out: string[] = [];
  if (Number(a.salary_minor) !== Number(b.salary_minor)) out.push("salary");
  if (a.currency !== b.currency) out.push("currency");
  if ((a.hours_per_week ?? null) !== (b.hours_per_week ?? null)) out.push("hours per week");
  if ((a.months ?? null) !== (b.months ?? null)) out.push("contract length");
  return out;
}

/** The latest contract copy from each side, and whether their terms agree. A mismatch can mean contract substitution. */
export async function contractStatus(tx: Sql, placementId: string) {
  const rows = await tx`
    SELECT DISTINCT ON (party) * FROM contracts WHERE placement_id = ${placementId} ORDER BY party, created_at DESC`;
  const candidate = rows.find((r) => r.party === "candidate");
  const employer = rows.find((r) => r.party === "employer");
  const differences = candidate && employer ? diffContracts(candidate as never, employer as never) : [];
  return { candidate, employer, differences };
}

/** Documents a placement needs: the destination country's checklist if the agency has one, else the stage default. */
export async function requiredDocs(tx: Sql, placementId: string, stageDefault: string[]): Promise<string[]> {
  const [p] = await tx`
    SELECT j.country, j.category FROM placements p JOIN job_orders j ON j.id = p.job_order_id WHERE p.id = ${placementId}`;
  if (!p) return stageDefault;
  const [c] = await tx`
    SELECT required_doc_types FROM country_checklists
    WHERE lower(country) = lower(${p.country}) AND (lower(job_category) = lower(${p.category}) OR job_category = '')
    ORDER BY (job_category <> '') DESC LIMIT 1`;
  return c ? (c.required_doc_types as string[]) : stageDefault;
}

/**
 * Moves a placement to another stage after checking the gates.
 * Leaving a stage can require: verified documents, fees paid, a signed matching contract, an approved visa,
 * orientation done, and arrival confirmed. Entering a stage can require a job order and a vetted employer.
 * An admin can override gates, but must give a reason, and the override is logged.
 */
export async function moveStage(
  tx: Sql,
  ctx: Actor,
  placementId: string,
  targetStageId: string,
  note: string,
  override: boolean,
): Promise<MoveResult> {
  const [p] = await tx`
    SELECT p.*, s.position AS cur_pos, s.name AS cur_name, s.required_doc_types, s.requires_payment,
           s.requires_contract, s.requires_visa, s.requires_orientation, s.requires_arrival, s.requires_job_order AS cur_needs_job
    FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id
    WHERE p.id = ${placementId} FOR UPDATE OF p`;
  if (!p) return { ok: false, error: "Placement not found." };
  if (p.outcome === "closed") return { ok: false, error: "This placement is closed." };

  const [t] = await tx`SELECT * FROM pipeline_stages WHERE id = ${targetStageId}`;
  if (!t) return { ok: false, error: "Stage not found." };
  if (t.id === p.stage_id) return { ok: false, error: "Already at that stage." };

  const problems: string[] = [];

  // Gates only apply when moving forward.
  if (t.position > p.cur_pos) {
    const required = await requiredDocs(tx, placementId, p.required_doc_types as string[]);
    if (required.length > 0 && (p.required_doc_types as string[]).length > 0) {
      const ok = await tx`
        SELECT DISTINCT doc_type FROM documents
        WHERE candidate_id = ${p.candidate_id} AND status = 'verified'
          AND (expiry_date IS NULL OR expiry_date >= current_date)
          AND doc_type = ANY(${required})`;
      const have = new Set(ok.map((r) => r.doc_type as string));
      const missing = required.filter((d) => !have.has(d));
      if (missing.length) problems.push(`Missing verified documents: ${missing.join(", ")}`);
    }
    if (p.requires_payment) {
      const due = await balanceDue(tx, placementId);
      if (due > 0) problems.push(`Fees due and unpaid: ${(due / 100).toLocaleString("en-KE")}`);
    }
    if (t.requires_job_order && !p.job_order_id) problems.push("Assign a job order first");
    if (t.requires_vetted_employer && p.job_order_id) {
      const [e] = await tx`
        SELECT e.vetted FROM job_orders j JOIN employers e ON e.id = j.employer_id WHERE j.id = ${p.job_order_id}`;
      if (!e?.vetted) problems.push("The employer has not been vetted");
    }
    if (p.requires_contract) {
      const c = await contractStatus(tx, placementId);
      if (!c.candidate || !c.employer) problems.push("Record both the candidate's and the employer's contract copies");
      else if (c.differences.length) problems.push(`The two contract copies differ on: ${c.differences.join(", ")}`);
    }
    if (p.requires_visa || p.requires_orientation || p.requires_arrival) {
      const [tr] = await tx`SELECT * FROM placement_travel WHERE placement_id = ${placementId}`;
      const today = new Date(new Date().toDateString());
      if (p.requires_visa && !(tr?.visa_status === "approved" && (!tr.visa_expiry || new Date(tr.visa_expiry) >= today))) {
        problems.push("The visa must be approved and not expired");
      }
      if (p.requires_orientation && !tr?.orientation_done_on) problems.push("Pre-departure orientation has not been completed");
      if (p.requires_arrival && !tr?.arrival_confirmed_on) problems.push("Arrival has not been confirmed");
    }
  }

  let overridden = false;
  if (problems.length) {
    if (!override) return { ok: false, error: problems.join(". ") + "." };
    if (!can(ctx.role, "pipeline:override")) return { ok: false, error: "Only an admin can override gates." };
    if (note.trim().length < 5) return { ok: false, error: "An override needs a reason of at least 5 characters." };
    overridden = true;
  }

  const outcome = t.marks_deployed ? "deployed" : p.outcome === "deployed" && t.position < p.cur_pos ? "active" : p.outcome;
  await tx`UPDATE placements SET stage_id = ${t.id}, outcome = ${outcome} WHERE id = ${placementId}`;
  if (t.marks_deployed) {
    await tx`UPDATE candidates SET status = 'placed' WHERE id = ${p.candidate_id}`;
    // Follow-up check-ins after deployment, so nobody is forgotten once they are abroad.
    const existing = await tx`SELECT 1 FROM checkins WHERE placement_id = ${placementId}`;
    if (!existing.length) {
      for (const days of [30, 90, 180]) {
        await tx`INSERT INTO checkins (tenant_id, placement_id, due_on) VALUES (${ctx.tenantId}, ${placementId}, current_date + ${days}::int)`;
      }
    }
  }
  await tx`
    INSERT INTO stage_history (tenant_id, placement_id, from_stage_id, to_stage_id, user_id, note, override)
    VALUES (${ctx.tenantId}, ${placementId}, ${p.stage_id}, ${t.id}, ${ctx.userId}, ${note}, ${overridden})`;
  await audit(tx, ctx, overridden ? "stage.override" : "stage.move", "placement", placementId, {
    from: p.cur_name,
    to: t.name,
    note,
    problems: overridden ? problems : undefined,
  });
  // Tell the candidate when they move forward.
  if (t.position > p.cur_pos) {
    const [c] = await tx`SELECT id, first_name, phone, email FROM candidates WHERE id = ${p.candidate_id}`;
    await notifyCandidate(tx, ctx.tenantId, { id: c.id, name: c.first_name, phone: c.phone, email: c.email }, "stage_changed", { stage: t.name });
  }
  // The first stage that needs a job order is the shortlist: that is when the employer gets to see the candidate.
  if (t.position > p.cur_pos && t.requires_job_order && !p.cur_needs_job && p.job_order_id) {
    const [e] = await tx`
      SELECT e.id, e.email, e.company, j.title, j.id AS job_id,
             (SELECT count(*) FROM placements x WHERE x.job_order_id = j.id AND x.stage_id = ${t.id} AND x.outcome <> 'closed') AS n
      FROM job_orders j JOIN employers e ON e.id = j.employer_id WHERE j.id = ${p.job_order_id}`;
    if (e) await notifyEmployer(tx, ctx.tenantId, { id: e.id, email: e.email, company: e.company }, "employer_shortlist",
      { role: e.title, n: Number(e.n) }, { dedupeKey: `shortlist:${e.job_id}:${new Date().toISOString().slice(0, 10)}` });
  }
  return { ok: true };
}
