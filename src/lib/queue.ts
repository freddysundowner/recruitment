import type { Sql } from "./db";

type Opts = { runAt?: Date; dedupeKey?: string; maxAttempts?: number };

/** Adds a background job. Jobs are run by the worker process (npm run worker). */
export async function enqueue(tx: Sql, tenantId: string, kind: string, payload: Record<string, unknown>, opts: Opts = {}) {
  await tx`
    INSERT INTO jobs (tenant_id, kind, payload, run_at, dedupe_key, max_attempts)
    VALUES (${tenantId}, ${kind}, ${tx.json(payload as never)}, ${opts.runAt ?? new Date()}, ${opts.dedupeKey ?? null}, ${opts.maxAttempts ?? 5})
    ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`;
}
