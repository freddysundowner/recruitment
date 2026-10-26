import type { Sql } from "./db";
import type { Actor } from "./actor";
import { audit } from "./audit";
import { can } from "./perms";
import { notifyCandidate, notifyEmployer } from "./notify";
import { placementFit, requiredDocs } from "./requirements";

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

export { requiredDocs } from "./requirements";

export type GateItem = {
  key: string;
  label: string;
  done: boolean;
  /** One short line about where things stand, such as "awaiting verification". */
  detail?: string;
  /** Where on the candidate's page the missing piece is dealt with, such as "#documents". */
  anchor?: string;
  /** Or a page elsewhere in the app. */
  href?: string;
  /** Something only a person can judge, ticked by hand for this recruit. */
  manual?: { text: string };
};

export type GateSubject = {
  candidate_id: string; tenant_id: string; job_order_id: string | null; required_doc_types: string[]; requires_payment: boolean; requires_contract: boolean;
  requires_visa: boolean; requires_orientation: boolean; requires_arrival: boolean; id: string; cur_needs_job?: boolean;
};
export type GateTarget = { requires_job_order: boolean; requires_vetted_employer: boolean };

/** The row `evaluateGates` needs for a placement: its current stage and that stage's exit requirements. */
export async function gateSubject(tx: Sql, placementId: string) {
  const [p] = await tx`
    SELECT p.*, s.position AS cur_pos, s.name AS cur_name, s.required_doc_types, s.requires_payment,
           s.requires_contract, s.requires_visa, s.requires_orientation, s.requires_arrival, s.requires_job_order AS cur_needs_job
    FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id WHERE p.id = ${placementId}`;
  return p as unknown as GateSubject & { stage_id: string; cur_pos: number; cur_name: string; outcome: string; payment_model: string | null };
}

/**
 * Everything that must be true to move a placement forward into `t`, as a list the page can tick off (`items`)
 * and as the plain sentences `moveStage` reports when something is missing (`problems`). One place decides both,
 * so the page can never say "ready" when moving would be refused.
 */
export async function evaluateGates(tx: Sql, p: GateSubject, t: GateTarget): Promise<{ items: GateItem[]; problems: string[] }> {
  const items: GateItem[] = [];
  const problems: string[] = [];
  // Two rules are switches in Settings: comparing the two contract copies, and only using vetted employers.
  const [{ settings }] = await tx`SELECT settings FROM tenants WHERE id = ${p.tenant_id}`;
  const rules = (settings?.rules ?? {}) as { contract_check?: boolean; require_vetting?: boolean };

  const required = await requiredDocs(tx, p.id, p.required_doc_types);
  if (required.length > 0 && p.required_doc_types.length > 0) {
    const docs = await tx`
      SELECT doc_type, status, (status = 'verified' AND (expiry_date IS NULL OR expiry_date >= current_date)) AS valid
      FROM documents WHERE candidate_id = ${p.candidate_id} AND doc_type = ANY(${required})`;
    const missing: string[] = [];
    for (const r of required) {
      const mine = docs.filter((d) => d.doc_type === r);
      const done = mine.some((d) => d.valid);
      if (!done) missing.push(r);
      items.push({
        key: `doc:${r}`, label: `${r} verified`, done, anchor: "#documents",
        detail: done ? undefined : mine.some((d) => d.status === "pending") ? "uploaded, waiting to be checked" : mine.some((d) => d.status === "verified") ? "expired" : "not uploaded yet",
      });
    }
    if (missing.length) problems.push(`Missing verified documents: ${missing.join(", ")}`);
  }

  if (p.requires_payment) {
    const due = await balanceDue(tx, p.id);
    items.push({ key: "fees", label: "Fees paid", done: due <= 0, anchor: "#money", detail: due > 0 ? `KES ${(due / 100).toLocaleString("en-KE")} still due` : undefined });
    if (due > 0) problems.push(`Fees due and unpaid: ${(due / 100).toLocaleString("en-KE")}`);
  }

  if (t.requires_job_order) {
    items.push({ key: "job", label: "Assigned to an opening", done: Boolean(p.job_order_id), anchor: "#placement" });
    if (!p.job_order_id) problems.push("Assign an opening first");
  }

  // Being put forward to the employer is the moment the recruit has to meet what the opening asks for.
  if (t.requires_job_order && !p.cur_needs_job && p.job_order_id) {
    for (const f of await placementFit(tx, p.id)) {
      items.push(f);
      if (!f.done) problems.push(`Does not meet the opening's requirement: ${f.label}`);
    }
  }

  if (t.requires_vetted_employer && p.job_order_id && rules.require_vetting !== false) {
    const [e] = await tx`
      SELECT e.id, e.vetted FROM job_orders j JOIN employers e ON e.id = j.employer_id WHERE j.id = ${p.job_order_id}`;
    items.push({ key: "vetted", label: "Employer vetted", done: Boolean(e?.vetted), href: e ? `/employers/${e.id}#checks` : undefined, detail: e?.vetted ? undefined : "record a registration check first" });
    if (!e?.vetted) problems.push("The employer has not been vetted");
  }

  if (p.requires_contract && rules.contract_check !== false) {
    const c = await contractStatus(tx, p.id);
    const both = Boolean(c.candidate && c.employer);
    items.push({
      key: "contract", label: "Contract copies recorded and matching", done: both && c.differences.length === 0, anchor: "#contract",
      detail: !both ? "record the candidate's and the employer's copies" : c.differences.length ? `differ on ${c.differences.join(", ")}` : undefined,
    });
    if (!both) problems.push("Record both the candidate's and the employer's contract copies");
    else if (c.differences.length) problems.push(`The two contract copies differ on: ${c.differences.join(", ")}`);
  }

  if (p.requires_visa || p.requires_orientation || p.requires_arrival) {
    const [tr] = await tx`SELECT * FROM placement_travel WHERE placement_id = ${p.id}`;
    const today = new Date(new Date().toDateString());
    if (p.requires_visa) {
      const ok = tr?.visa_status === "approved" && (!tr.visa_expiry || new Date(tr.visa_expiry) >= today);
      items.push({ key: "visa", label: "Visa approved", done: Boolean(ok), anchor: "#travel", detail: ok ? undefined : tr?.visa_status === "approved" ? "expired" : "not approved yet" });
      if (!ok) problems.push("The visa must be approved and not expired");
    }
    if (p.requires_orientation) {
      items.push({ key: "orientation", label: "Pre-departure orientation done", done: Boolean(tr?.orientation_done_on), anchor: "#travel" });
      if (!tr?.orientation_done_on) problems.push("Pre-departure orientation has not been completed");
    }
    if (p.requires_arrival) {
      items.push({ key: "arrival", label: "Arrival confirmed", done: Boolean(tr?.arrival_confirmed_on), anchor: "#travel" });
      if (!tr?.arrival_confirmed_on) problems.push("Arrival has not been confirmed");
    }
  }
  return { items, problems };
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

  // Gates only apply when moving forward.
  const problems = t.position > p.cur_pos ? (await evaluateGates(tx, p as unknown as GateSubject, t as unknown as GateTarget)).problems : [];

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
