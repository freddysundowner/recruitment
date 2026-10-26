import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { freshPlacement } from "./helpers";

config({ path: ".env.local" });

type Db = typeof import("../src/lib/db");
type Pipe = typeof import("../src/lib/pipeline");
type Tx = import("../src/lib/db").Sql;

let db: Db;
let pipe: Pipe;
let demo: { id: string; tenant_id: string };
class Rollback extends Error {}

async function sandbox<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  await db
    .withTenant(demo.tenant_id, async (tx) => {
      out = await fn(tx);
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  return out;
}
const actor = (role: "admin" | "recruiter") => ({ userId: demo.id, tenantId: demo.tenant_id, role });

beforeAll(async () => {
  db = await import("../src/lib/db");
  pipe = await import("../src/lib/pipeline");
  demo = ((await db.sql`SELECT * FROM auth_lookup_user('admin@demo.test')`) as unknown as { id: string; tenant_id: string }[])[0];
});

describe("contract gate", () => {
  it("diffContracts names every term that differs", () => {
    const a = { salary_minor: 130000, currency: "AED", hours_per_week: 48, months: 24 };
    expect(pipe.diffContracts(a, { ...a })).toEqual([]);
    expect(pipe.diffContracts(a, { ...a, salary_minor: 100000, months: 12 })).toEqual(["salary", "contract length"]);
    expect(pipe.diffContracts(a, { ...a, currency: "USD", hours_per_week: 60 })).toEqual(["currency", "hours per week"]);
  });

  it("blocks leaving Selected with no copies, with mismatched copies, and allows matching copies", async () => {
    const r = await sandbox(async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 3, job: "vetted" });
      const p = { id: f.placementId };
      const next = await f.stageId(4);
      const none = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      const ins = (party: string, salary: number) => tx`
        INSERT INTO contracts (tenant_id, placement_id, party, salary_minor, currency, hours_per_week, months)
        VALUES (${demo.tenant_id}, ${p.id}, ${party}, ${salary}, 'USD', 48, 24)`;
      await ins("candidate", 110000);
      await ins("employer", 90000);
      const mismatch = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      await ins("employer", 110000); // the employer corrects their copy; the latest one counts
      const match = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      return { none, mismatch, match };
    });
    expect(r.none.ok).toBe(false);
    if (!r.none.ok) expect(r.none.error).toMatch(/Record both/);
    expect(r.mismatch.ok).toBe(false);
    if (!r.mismatch.ok) expect(r.mismatch.error).toMatch(/differ on: salary/);
    // Moving into Getting ready only needs the job and a vetted employer, so the contract was the one thing in the way.
    expect(r.match.ok).toBe(true);
  });
});

describe("visa and travel gates", () => {
  it("blocks leaving Getting ready until the visa is approved and orientation is done", async () => {
    const r = await sandbox(async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 4, job: "vetted", docs: ["Passport", "Police clearance", "Medical report"], userId: demo.id });
      const p = { id: f.placementId };
      const next = await f.stageId(5);
      const blocked = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      await tx`INSERT INTO placement_travel (placement_id, tenant_id, visa_status, visa_number) VALUES (${p.id}, ${demo.tenant_id}, 'applied', 'V1')`;
      const applied = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      await tx`UPDATE placement_travel SET visa_status = 'approved', visa_expiry = current_date - 1 WHERE placement_id = ${p.id}`;
      const expired = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      await tx`UPDATE placement_travel SET visa_expiry = current_date + 200 WHERE placement_id = ${p.id}`;
      const noOrientation = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      await tx`UPDATE placement_travel SET orientation_done_on = current_date WHERE placement_id = ${p.id}`;
      const ok = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      const [pl] = await tx`SELECT outcome FROM placements WHERE id = ${p.id}`;
      const checkins = await tx`SELECT due_on - current_date AS days FROM checkins WHERE placement_id = ${p.id} ORDER BY due_on`;
      return { blocked, applied, expired, noOrientation, ok, outcome: pl.outcome, days: checkins.map((c) => Number(c.days)) };
    });
    expect(r.blocked.ok).toBe(false);
    expect(r.applied.ok).toBe(false);
    expect(r.expired.ok).toBe(false);
    if (!r.expired.ok) expect(r.expired.error).toMatch(/visa must be approved and not expired/);
    expect(r.noOrientation.ok).toBe(false);
    if (!r.noOrientation.ok) expect(r.noOrientation.error).toMatch(/orientation/i);
    expect(r.ok.ok).toBe(true);
    expect(r.outcome).toBe("deployed");
    expect(r.days).toEqual([30, 90, 180]);
  });
});

describe("country checklists", () => {
  it("replace the stage's default document list for that country", async () => {
    const r = await sandbox(async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 4, job: "vetted", docs: ["Passport"], userId: demo.id });
      const p = { id: f.placementId };
      const next = await f.stageId(5);
      await tx`INSERT INTO placement_travel (placement_id, tenant_id, visa_status, visa_number, visa_expiry, orientation_done_on) VALUES (${p.id}, ${demo.tenant_id}, 'approved', 'V1', current_date + 200, current_date)`;
      const before = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      const [j] = await tx`SELECT j.country FROM placements p JOIN job_orders j ON j.id = p.job_order_id WHERE p.id = ${p.id}`;
      await tx`INSERT INTO country_checklists (tenant_id, country, required_doc_types) VALUES (${demo.tenant_id}, ${j.country}, ${["Passport"]})
               ON CONFLICT (tenant_id, lower(country), lower(job_category)) DO UPDATE SET required_doc_types = EXCLUDED.required_doc_types`;
      const docs = await pipe.requiredDocs(tx, p.id, ["Passport", "Police clearance", "Medical report"]);
      const after = await pipe.moveStage(tx, actor("recruiter"), p.id, next, "", false);
      return { before, docs, after };
    });
    expect(r.before.ok).toBe(false);
    expect(r.docs).toEqual(["Passport"]);
    // The candidate's passport is verified, so with the shorter list the documents gate no longer blocks.
    expect(r.after.ok).toBe(true);
  });
});

describe("messages and reminders", () => {
  it("never queues the same reminder twice", async () => {
    const { notifyCandidate } = await import("../src/lib/notify");
    const n = await sandbox(async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 1 });
      const [c] = await tx`SELECT id, first_name, phone, email FROM candidates WHERE id = ${f.candidateId}`;
      const person = { id: c.id, name: c.first_name, phone: c.phone, email: c.email };
      await notifyCandidate(tx, demo.tenant_id, person, "document_expiring", { doc: "Passport", days: 5 }, { dedupeKey: "test:dup" });
      await notifyCandidate(tx, demo.tenant_id, person, "document_expiring", { doc: "Passport", days: 5 }, { dedupeKey: "test:dup" });
      return (await tx`SELECT count(*) AS n FROM messages WHERE dedupe_key LIKE 'test:dup%'`)[0].n;
    });
    expect(Number(n)).toBe(1);
  });
});
