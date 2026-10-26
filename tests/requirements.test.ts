import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { freshPlacement } from "./helpers";
import { fitItems, ageOn, type OpeningReqs } from "../src/lib/requirements";

config({ path: ".env.local" });

type Db = typeof import("../src/lib/db");
type Pipe = typeof import("../src/lib/pipeline");
let db: Db;
let pipe: Pipe;
let demo: { id: string; tenant_id: string };

class Rollback extends Error {}
async function sandbox<T>(fn: (tx: import("../src/lib/db").Sql) => Promise<T>): Promise<T> {
  let out!: T;
  await db.withTenant(demo.tenant_id, async (tx) => { out = await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  return out;
}
const ctx = { userId: "", tenantId: "", role: "recruiter" as const, name: "t" };

beforeAll(async () => {
  db = await import("../src/lib/db");
  pipe = await import("../src/lib/pipeline");
  [demo] = await db.sql`SELECT * FROM auth_lookup_user('admin@demo.test')`.then((r) => r as never);
  ctx.userId = demo.id; ctx.tenantId = demo.tenant_id;
});

const none: OpeningReqs = { required_doc_types: [], min_age: null, max_age: null, gender: "", min_experience_years: null, other_requirements: [] };
const today = new Date("2026-10-26");

describe("what an opening asks of a recruit", () => {
  it("works out age on the day, not just by year", () => {
    expect(ageOn("2000-10-27", today)).toBe(25);
    expect(ageOn("2000-10-26", today)).toBe(26);
  });

  it("asks nothing when nothing is set", () => {
    expect(fitItems(none, { dob: null, gender: null, experience_years: null }, [], today)).toEqual([]);
  });

  it("checks age, gender and years of experience against the record", () => {
    const job = { ...none, min_age: 21, max_age: 35, gender: "Female", min_experience_years: 2 };
    const ok = fitItems(job, { dob: "1996-01-01", gender: "Female", experience_years: 3 }, [], today);
    expect(ok.map((i) => i.done)).toEqual([true, true, true]);
    const bad = fitItems(job, { dob: "1980-01-01", gender: "Male", experience_years: 1 }, [], today);
    expect(bad.map((i) => i.done)).toEqual([false, false, false]);
    expect(bad[0].detail).toBe("they are 46");
    const blank = fitItems(job, { dob: null, gender: null, experience_years: null }, [], today);
    expect(blank.map((i) => i.detail)).toEqual(["add their date of birth", "add their gender", "add their years of experience"]);
  });

  it("leaves the free-text items to be ticked by hand", () => {
    const job = { ...none, other_requirements: ["Nursing licence", "Basic English"] };
    const items = fitItems(job, { dob: null, gender: null, experience_years: null }, ["Nursing licence"], today);
    expect(items.map((i) => [i.label, i.done, Boolean(i.manual)])).toEqual([["Nursing licence", true, true], ["Basic English", false, true]]);
  });
});

describe("requirements in the pipeline", () => {
  it("holds a recruit back from the company until they meet the opening, then lets them through", async () => {
    const r = await sandbox(async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 1, job: "vetted", userId: demo.id });
      const [pl] = await tx`SELECT job_order_id FROM placements WHERE id = ${f.placementId}`;
      await tx`UPDATE job_orders SET min_age = 25, other_requirements = ARRAY['Nursing licence'] WHERE id = ${pl.job_order_id}`;
      const next = await f.stageId(2);
      const blocked = await pipe.moveStage(tx, ctx, f.placementId, next, "", false);
      await tx`UPDATE candidates SET dob = '1990-05-05' WHERE id = ${f.candidateId}`;
      const stillBlocked = await pipe.moveStage(tx, ctx, f.placementId, next, "", false);
      await tx`UPDATE placements SET requirement_ticks = ARRAY['Nursing licence'] WHERE id = ${f.placementId}`;
      const allowed = await pipe.moveStage(tx, ctx, f.placementId, next, "", false);
      return { blocked, stillBlocked, allowed };
    });
    expect(r.blocked.ok).toBe(false);
    if (!r.blocked.ok) expect(r.blocked.error).toMatch(/Age 25 or over/);
    expect(r.stillBlocked.ok).toBe(false);
    if (!r.stillBlocked.ok) { expect(r.stillBlocked.error).toMatch(/Nursing licence/); expect(r.stillBlocked.error).not.toMatch(/Age/); }
    expect(r.allowed.ok).toBe(true);
  });

  it("uses the opening's own document list for the Getting ready stage", async () => {
    const r = await sandbox(async (tx) => {
      const f = await freshPlacement(tx, demo.tenant_id, { stage: 4, job: "vetted", docs: ["Passport"], userId: demo.id });
      const [pl] = await tx`SELECT job_order_id FROM placements WHERE id = ${f.placementId}`;
      await tx`INSERT INTO placement_travel (placement_id, tenant_id, visa_status, visa_number, visa_expiry, orientation_done_on) VALUES (${f.placementId}, ${demo.tenant_id}, 'approved', 'V1', current_date + 200, current_date)`;
      const next = await f.stageId(5);
      const before = await pipe.moveStage(tx, ctx, f.placementId, next, "", false);
      await tx`UPDATE job_orders SET required_doc_types = ARRAY['Passport'] WHERE id = ${pl.job_order_id}`;
      const docs = await pipe.requiredDocs(tx, f.placementId, ["Passport", "Police clearance", "Medical report"]);
      const after = await pipe.moveStage(tx, ctx, f.placementId, next, "", false);
      return { before, docs, after };
    });
    expect(r.before.ok).toBe(false);
    expect(r.docs).toEqual(["Passport"]);
    expect(r.after.ok).toBe(true);
  });
});
