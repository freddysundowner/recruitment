import { withTenant } from "./db";
import { evaluateGates, gateSubject, type GateItem } from "./pipeline";

export type Guide = {
  placement: { id: string; outcome: string; payment_model: string | null; job_order_id: string | null };
  stages: { id: string; position: number; name: string; description: string }[];
  cur: { id: string; position: number; name: string; description: string };
  next: { id: string; position: number; name: string } | null;
  items: GateItem[];
};

/** What stands between a placement and its next stage, from the same rules that gate the move itself. */
export async function loadGuide(tenantId: string, placementId: string): Promise<Guide> {
  return withTenant(tenantId, async (tx) => {
    const p = await gateSubject(tx, placementId);
    const stages = (await tx`SELECT id, position, name, description FROM pipeline_stages ORDER BY position`) as unknown as Guide["stages"];
    const cur = stages.find((s) => s.position === p.cur_pos)!;
    const next = stages.find((s) => s.position === p.cur_pos + 1) ?? null;
    const items = next ? (await evaluateGates(tx, p, next as never)).items : [];
    return { placement: { id: placementId, outcome: p.outcome, payment_model: p.payment_model, job_order_id: p.job_order_id }, stages, cur, next, items };
  });
}
