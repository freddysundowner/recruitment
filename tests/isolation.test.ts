import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { freshPlacement } from "./helpers";

config({ path: ".env.local" });

type Db = typeof import("../src/lib/db");
type Pipe = typeof import("../src/lib/pipeline");

let db: Db;
let pipe: Pipe;
let demo: { id: string; tenant_id: string };
let other: { id: string; tenant_id: string };

class Rollback extends Error {}

/** Runs fn in a tenant transaction and always rolls back, so tests leave no data behind. */
async function sandbox<T>(tenantId: string, fn: (tx: import("../src/lib/db").Sql) => Promise<T>): Promise<T> {
  let out!: T;
  await db
    .withTenant(tenantId, async (tx) => {
      out = await fn(tx);
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  return out;
}

beforeAll(async () => {
  db = await import("../src/lib/db");
  pipe = await import("../src/lib/pipeline");
  [demo] = await db.sql`SELECT * FROM auth_lookup_user('admin@demo.test')`.then((r) => r as never);
  [other] = await db.sql`SELECT * FROM auth_lookup_user('admin@other.test')`.then((r) => r as never);
});

describe("tenant isolation (row-level security)", () => {
  it("a tenant sees only its own candidates", async () => {
    const mine = await db.withTenant(demo.tenant_id, (tx) => tx`SELECT tenant_id FROM candidates`);
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine.map((r) => r.tenant_id))).toEqual(new Set([demo.tenant_id]));
  });

  it("another agency sees none of them, even when asking for them by id", async () => {
    const [{ id }] = await db.withTenant(demo.tenant_id, (tx) => tx`SELECT id FROM candidates LIMIT 1`);
    const rows = await db.withTenant(other.tenant_id, (tx) => tx`SELECT * FROM candidates WHERE id = ${id}`);
    expect(rows).toHaveLength(0);
    const all = await db.withTenant(other.tenant_id, (tx) => tx`SELECT * FROM candidates`);
    expect(all).toHaveLength(0);
  });

  it("with no tenant set, nothing is returned", async () => {
    const rows = await db.sql`SELECT * FROM candidates`;
    expect(rows).toHaveLength(0);
  });

  it("cannot write a row into another tenant", async () => {
    await expect(
      sandbox(other.tenant_id, (tx) =>
        tx`INSERT INTO candidates (tenant_id, first_name, last_name, phone) VALUES (${demo.tenant_id}, 'X', 'Y', '0700')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot move another tenant's rows by updating them", async () => {
    const [{ id }] = await db.withTenant(demo.tenant_id, (tx) => tx`SELECT id FROM candidates LIMIT 1`);
    const res = await sandbox(other.tenant_id, (tx) => tx`UPDATE candidates SET phone = '000' WHERE id = ${id}`);
    expect(res.count).toBe(0);
  });
});

describe("append-only tables", () => {
  it("costs cannot be edited or deleted", async () => {
    await expect(sandbox(demo.tenant_id, (tx) => tx`UPDATE costs SET amount_minor = 1`)).rejects.toThrow(/permission denied/);
    await expect(sandbox(demo.tenant_id, (tx) => tx`DELETE FROM costs`)).rejects.toThrow(/permission denied/);
  });

  it("the audit log cannot be edited or deleted", async () => {
    await expect(sandbox(demo.tenant_id, (tx) => tx`DELETE FROM audit_log`)).rejects.toThrow(/permission denied/);
    await expect(sandbox(demo.tenant_id, (tx) => tx`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/permission denied/);
  });
});

describe("pipeline gates", () => {
  const ctx = (role: "admin" | "recruiter") => ({ userId: demo.id, tenantId: demo.tenant_id, role, name: "t" });

  it("blocks leaving Documents and medical without verified required documents", async () => {
    const r = await sandbox(demo.tenant_id, async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 6, job: "vetted", docs: ["Passport"], userId: demo.id });
      return pipe.moveStage(tx, ctx("recruiter"), f.placementId, await f.stageId(7), "", false);
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Missing verified documents: Police clearance, Medical report/);
  });

  it("only an admin can override, and only with a reason", async () => {
    const r = await sandbox(demo.tenant_id, async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 6, job: "vetted", userId: demo.id });
      const to = await f.stageId(7);
      const asRecruiter = await pipe.moveStage(tx, ctx("recruiter"), f.placementId, to, "please", true);
      const noReason = await pipe.moveStage(tx, ctx("admin"), f.placementId, to, "", true);
      const ok = await pipe.moveStage(tx, ctx("admin"), f.placementId, to, "Docs held by embassy", true);
      const [h] = await tx`SELECT override FROM stage_history WHERE placement_id = ${f.placementId} ORDER BY created_at DESC LIMIT 1`;
      return { asRecruiter, noReason, ok, override: h.override };
    });
    expect(r.asRecruiter.ok).toBe(false);
    expect(r.noReason.ok).toBe(false);
    expect(r.ok.ok).toBe(true);
    expect(r.override).toBe(true);
  });

  it("blocks a candidate without a job order from entering Shortlist", async () => {
    const r = await sandbox(demo.tenant_id, async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 1, job: null });
      // Stage 2 has requires_payment but no charges exist, so this passes; stage 3 needs a job order.
      const a = await pipe.moveStage(tx, ctx("recruiter"), f.placementId, await f.stageId(2), "", false);
      const b = await pipe.moveStage(tx, ctx("recruiter"), f.placementId, await f.stageId(3), "", false);
      return { a, b };
    });
    expect(r.a.ok).toBe(true);
    expect(r.b.ok).toBe(false);
    if (!r.b.ok) expect(r.b.error).toMatch(/job order/);
  });

  it("blocks leaving Screen while fees that are due are unpaid, then allows it once paid", async () => {
    const r = await sandbox(demo.tenant_id, async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 2, job: "vetted" });
      const next = await f.stageId(3);
      // A fee that is due today, and a later instalment that is not due yet.
      await tx`INSERT INTO fee_charges (tenant_id, placement_id, fee_type, amount_minor, due_on)
               VALUES (${demo.tenant_id}, ${f.placementId}, 'Registration', 500000, current_date),
                      (${demo.tenant_id}, ${f.placementId}, 'Medical', 900000, current_date + 30)`;
      const blocked = await pipe.moveStage(tx, ctx("recruiter"), f.placementId, next, "", false);
      const due = await pipe.balanceDue(tx, f.placementId);
      await tx`INSERT INTO payments (tenant_id, receipt_no, party, placement_id, method, amount_minor, currency, reference)
               VALUES (${demo.tenant_id}, 'RCT-TEST', 'candidate', ${f.placementId}, 'cash', 500000, 'KES', '')`;
      const dueAfter = await pipe.balanceDue(tx, f.placementId);
      const allowed = await pipe.moveStage(tx, ctx("recruiter"), f.placementId, next, "", false);
      return { blocked, due, dueAfter, allowed };
    });
    expect(r.blocked.ok).toBe(false);
    if (!r.blocked.ok) expect(r.blocked.error).toMatch(/Fees due and unpaid/);
    expect(r.due).toBe(500000); // only the instalment that is due, not the one 30 days away
    expect(r.dueAfter).toBe(0);
    expect(r.allowed.ok).toBe(true);
  });

  it("blocks entering Interview when the employer is not vetted", async () => {
    const r = await sandbox(demo.tenant_id, async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 3, job: "unvetted" });
      return pipe.moveStage(tx, ctx("recruiter"), f.placementId, await f.stageId(4), "", false);
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not been vetted/);
  });
});

describe("csv parser", () => {
  it("handles quotes, embedded commas, escaped quotes and CRLF", async () => {
    const { parseCsv } = await import("../src/lib/csv");
    const rows = parseCsv('first_name,last_name,skills\r\nAna,"Wa,njiru","said ""hi"""\r\nBo,Ot,\r\n');
    expect(rows).toEqual([
      ["first_name", "last_name", "skills"],
      ["Ana", "Wa,njiru", 'said "hi"'],
      ["Bo", "Ot", ""],
    ]);
  });
});
