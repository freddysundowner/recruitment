import type { Sql } from "../src/lib/db";

let n = 0;

/**
 * Creates a brand-new candidate and placement inside the current (rolled-back) transaction, so tests do not
 * depend on whatever state the demo data has been left in.
 */
export async function freshPlacement(
  tx: Sql,
  tenantId: string,
  o: { stage: number; job?: "vetted" | "unvetted" | null; docs?: string[]; userId?: string } = { stage: 1 },
) {
  n += 1;
  const tag = `${Date.now()}${n}`;
  const [c] = await tx`
    INSERT INTO candidates (tenant_id, first_name, last_name, phone, phone_norm, consent_at)
    VALUES (${tenantId}, 'Test', ${"Person" + tag}, ${"07" + tag.slice(-8)}, ${"+2547" + tag.slice(-8)}, now()) RETURNING id`;
  const [stage] = await tx`SELECT id FROM pipeline_stages WHERE position = ${o.stage}`;
  let jobId: string | null = null;
  let model: string | null = null;
  if (o.job) {
    const [j] = await tx`
      SELECT j.id, j.payment_model FROM job_orders j JOIN employers e ON e.id = j.employer_id
      WHERE e.vetted = ${o.job === "vetted"} AND j.status = 'open' ORDER BY j.created_at LIMIT 1`;
    jobId = j.id;
    model = j.payment_model;
  }
  const [p] = await tx`
    INSERT INTO placements (tenant_id, candidate_id, stage_id, job_order_id, payment_model)
    VALUES (${tenantId}, ${c.id}, ${stage.id}, ${jobId}, ${model}) RETURNING id`;
  for (const d of o.docs ?? []) {
    await tx`
      INSERT INTO documents (tenant_id, candidate_id, doc_type, file_key, file_name, mime_type, status, verified_by, verified_at)
      VALUES (${tenantId}, ${c.id}, ${d}, 'seed/none', 'x.pdf', 'application/pdf', 'verified', ${o.userId ?? null}, now())`;
  }
  const stageId = async (pos: number) => (await tx`SELECT id FROM pipeline_stages WHERE position = ${pos}`)[0].id as string;
  return { placementId: p.id as string, candidateId: c.id as string, stageId };
}
