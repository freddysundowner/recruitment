import postgres from "postgres";

export type Sql = postgres.Sql;

const globalForDb = globalThis as unknown as { __sql?: Sql };

export const sql: Sql =
  globalForDb.__sql ??
  postgres(process.env.DATABASE_URL!, {
    max: 10,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") globalForDb.__sql = sql;

/**
 * Runs `fn` inside a transaction with the tenant set on the database session.
 * Row-level security then returns only that tenant's rows, even if a query
 * forgets its own tenant filter. Every tenant query must go through this.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

/** A candidate's session: the agency wall plus a second wall around that one candidate's own rows. */
export async function withCandidate<T>(tenantId: string, candidateId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.candidate_id', ${candidateId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

/** An employer's session: limited to that employer's job orders and the candidates shortlisted for them. */
export async function withEmployer<T>(tenantId: string, employerId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.employer_id', ${employerId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}
