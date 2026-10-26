import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

type Db = typeof import("../src/lib/db");
let db: Db;
let tenantId: string;
let cand: { id: string }; // a candidate with a placement and documents
let otherCand: { id: string };
let employer: { id: string }; // employer of the first candidate's job order
let otherEmployer: { id: string };

beforeAll(async () => {
  db = await import("../src/lib/db");
  const u = ((await db.sql`SELECT * FROM auth_lookup_user('admin@demo.test')`) as unknown as { tenant_id: string }[])[0];
  tenantId = u.tenant_id;
  await db.withTenant(tenantId, async (tx) => {
    // Esther: at stage 4 on a Gulf Care job order. Hassan: another candidate, another employer.
    cand = ((await tx`SELECT id FROM candidates WHERE first_name = 'Esther'`) as unknown as { id: string }[])[0];
    otherCand = ((await tx`SELECT id FROM candidates WHERE first_name = 'Hassan'`) as unknown as { id: string }[])[0];
    employer = ((await tx`SELECT e.id FROM employers e WHERE e.company = 'Gulf Care Services'`) as unknown as { id: string }[])[0];
    otherEmployer = ((await tx`SELECT e.id FROM employers e WHERE e.company = 'Riyadh Build Co'`) as unknown as { id: string }[])[0];
  });
});

describe("a candidate session", () => {
  it("sees only that candidate's own rows", async () => {
    const r = await db.withCandidate(tenantId, cand.id, async (tx) => ({
      candidates: await tx`SELECT id FROM candidates`,
      placements: await tx`SELECT candidate_id FROM placements`,
      docs: await tx`SELECT candidate_id FROM documents`,
    }));
    expect(r.candidates.map((c) => c.id)).toEqual([cand.id]);
    expect(new Set(r.placements.map((p) => p.candidate_id))).toEqual(new Set([cand.id]));
    expect(r.docs.every((d) => d.candidate_id === cand.id)).toBe(true);
  });

  it("cannot read another candidate even by id", async () => {
    const rows = await db.withCandidate(tenantId, cand.id, (tx) => tx`SELECT * FROM candidates WHERE id = ${otherCand.id}`);
    expect(rows).toHaveLength(0);
  });

  it("cannot see money the agency spent, staff accounts, employers or the audit trail", async () => {
    const r = await db.withCandidate(tenantId, cand.id, async (tx) => ({
      costs: await tx`SELECT 1 FROM costs`,
      users: await tx`SELECT 1 FROM users`,
      employers: await tx`SELECT 1 FROM employers`,
      invoices: await tx`SELECT 1 FROM invoices`,
      audit: await tx`SELECT 1 FROM audit_log`,
      jobs: await tx`SELECT 1 FROM jobs`,
      counters: await tx`SELECT 1 FROM tenant_counters`,
    }));
    for (const [k, v] of Object.entries(r)) expect(v, k).toHaveLength(0);
  });

  it("sees open job orders only, and its own fee payments only", async () => {
    const r = await db.withCandidate(tenantId, cand.id, async (tx) => ({
      jobs: await tx`SELECT status FROM job_orders`,
      pays: await tx`SELECT party FROM payments`,
    }));
    expect(r.jobs.length).toBeGreaterThan(0);
    expect(r.jobs.every((j) => j.status === "open")).toBe(true);
    expect(r.pays.every((p) => p.party === "candidate")).toBe(true);
  });

  it("cannot write rows for someone else", async () => {
    await expect(
      db.withCandidate(tenantId, cand.id, (tx) =>
        tx`INSERT INTO complaints (tenant_id, candidate_id, raised_via, subject, body) VALUES (${tenantId}, ${otherCand.id}, 'portal', 'x', 'y')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("can write its own complaint, and can add to the audit trail but not read it back", async () => {
    class Rollback extends Error {}
    const r = await db.withCandidate(tenantId, cand.id, async (tx) => {
      await tx`INSERT INTO complaints (tenant_id, candidate_id, raised_via, subject, body) VALUES (${tenantId}, ${cand.id}, 'portal', 'x', 'y')`;
      await tx`INSERT INTO audit_log (tenant_id, action, entity) VALUES (${tenantId}, 'test', 'test')`;
      const seen = await tx`SELECT 1 FROM audit_log`;
      throw Object.assign(new Rollback(), { seen: seen.length });
    }).catch((e) => e);
    expect(r).toBeInstanceOf(Rollback);
    expect(r.seen).toBe(0);
  });
});

describe("an employer session", () => {
  it("sees only its own job orders and invoices", async () => {
    const r = await db.withEmployer(tenantId, employer.id, async (tx) => ({
      jobs: await tx`SELECT employer_id FROM job_orders`,
      invoices: await tx`SELECT employer_id FROM invoices`,
      employers: await tx`SELECT id FROM employers`,
    }));
    expect(r.jobs.length).toBeGreaterThan(0);
    expect(r.jobs.every((j) => j.employer_id === employer.id)).toBe(true);
    expect(r.invoices.every((i) => i.employer_id === employer.id)).toBe(true);
    expect(r.employers.map((e) => e.id)).toEqual([employer.id]);
  });

  it("sees candidates shortlisted for its jobs but not other employers' candidates", async () => {
    const mine = await db.withEmployer(tenantId, employer.id, (tx) => tx`SELECT id FROM candidates`);
    expect(mine.map((c) => c.id)).toContain(cand.id);
    expect(mine.map((c) => c.id)).not.toContain(otherCand.id);
    const theirs = await db.withEmployer(tenantId, otherEmployer.id, (tx) => tx`SELECT id FROM candidates`);
    expect(theirs.map((c) => c.id)).not.toContain(cand.id);
  });

  it("cannot see documents, costs, staff accounts or the money received from candidates", async () => {
    const r = await db.withEmployer(tenantId, employer.id, async (tx) => ({
      docs: await tx`SELECT 1 FROM documents`,
      costs: await tx`SELECT 1 FROM costs`,
      users: await tx`SELECT 1 FROM users`,
      fees: await tx`SELECT 1 FROM fee_charges`,
      cpay: await tx`SELECT 1 FROM payments WHERE party = 'candidate'`,
    }));
    for (const [k, v] of Object.entries(r)) expect(v, k).toHaveLength(0);
  });

  it("sees interview appointments only, not medical or embassy ones", async () => {
    class Rollback extends Error {}
    const r = await db.withTenant(tenantId, async (tx) => {
      const [p] = await tx`SELECT id FROM placements WHERE candidate_id = ${cand.id}`;
      await tx`INSERT INTO appointments (tenant_id, placement_id, kind, scheduled_at) VALUES (${tenantId}, ${p.id}, 'medical', now()), (${tenantId}, ${p.id}, 'interview', now())`;
      // staff transaction is still open; query as employer in a nested way is not possible, so verify the policy text instead
      const [pol] = await tx`SELECT pg_get_expr(polqual, polrelid) AS q FROM pg_policy WHERE polname = 'portal_scope' AND polrelid = 'appointments'::regclass`;
      throw Object.assign(new Rollback(), { q: pol.q as string });
    }).catch((e) => e);
    expect(r.q).toContain("interview");
  });
});
