import type { Sql } from "./db";
import type { Actor } from "./actor";
import { audit } from "./audit";

/** Attaches a job order to a candidate's live placement. The payment model comes from the job order. */
export async function assignJob(tx: Sql, ctx: Actor, placementId: string, jobId: string): Promise<void> {
  const [j] = await tx`SELECT id, status, quantity, payment_model, title FROM job_orders WHERE id = ${jobId} FOR UPDATE`;
  if (!j) throw new Error("Job order not found.");
  if (j.status !== "open") throw new Error("That job order is not open.");
  const [{ n }] = await tx`SELECT count(*) AS n FROM placements WHERE job_order_id = ${jobId} AND outcome <> 'closed'`;
  if (Number(n) >= j.quantity) throw new Error(`That job order is full (${j.quantity} of ${j.quantity} filled).`);
  const [p] = await tx`
    UPDATE placements SET job_order_id = ${jobId}, payment_model = ${j.payment_model}
    WHERE id = ${placementId} AND outcome <> 'closed' RETURNING candidate_id`;
  if (!p) throw new Error("Placement not found or closed.");
  await audit(tx, ctx, "placement.assign_job", "placement", placementId, { job: j.title });
}
