import type { Sql } from "./db";
import type { Actor } from "./actor";

export async function audit(
  tx: Sql,
  ctx: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
) {
  await tx`
    INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, detail)
    VALUES (${ctx.tenantId}, ${ctx.userId}, ${action}, ${entity}, ${entityId}, ${tx.json(detail as never)})`;
}

/** Next number in a per-tenant sequence, for example receipts and invoices. */
export async function nextNumber(tx: Sql, tenantId: string, key: string, prefix: string): Promise<string> {
  const [row] = await tx`
    INSERT INTO tenant_counters (tenant_id, key, value) VALUES (${tenantId}, ${key}, 1)
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + 1
    RETURNING value`;
  return `${prefix}-${String(row.value).padStart(5, "0")}`;
}
