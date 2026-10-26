import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_STAGES } from "../src/lib/stages";
import { steps, type Step } from "../src/lib/next-steps";
import { freshPlacement } from "./helpers";

config({ path: ".env.local" });

type Tx = import("../src/lib/db").Sql;
let db: typeof import("../src/lib/db");
class Rollback extends Error {}

beforeAll(async () => {
  db = await import("../src/lib/db");
});

describe("next-step suggestions", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const all: Step[] = [
    steps.candidateCreated(id, "A B"), steps.importDone(3), steps.documentUploaded(id), steps.documentReviewed(id, "verified"), steps.employerCreated(id, "Acme"),
    steps.employerCheck(id, "ok"), steps.employerVetted(id), steps.employerLogin(id), steps.jobOrderCreated(id, "Nurse"), steps.jobOrderApproved(id), steps.jobAssigned(id),
    ...[1, 2, 3, 4, 5].map((p) => steps.stageMoved(id, p, "Stage", id)), steps.placementClosed(id), steps.applicationDecided(id, "shortlisted"),
    steps.applicationDecided(null, "declined"), steps.contractRecorded(id, "candidate", false), steps.contractRecorded(id, "employer", true), steps.travelSaved(id),
    steps.appointmentAdded(id), steps.checkinDone(), steps.complaintRecorded(), steps.costAdded(id, true), steps.costAdded(id, false), steps.feeAdded(id),
    steps.invoiceRaised(id), steps.paymentRecorded(id, "RCT-00001"), steps.mpesaRequested(id), steps.userAdded(), steps.mpesaSettingsSaved(), steps.checklistSaved(),
    steps.welcome("Joy"), steps.sampleLoaded(), steps.employerInterview(), steps.employerSelected(id), steps.employerContract(), steps.employerRequestSent(),
    steps.portalWelcome("acme"), steps.portalDocument("acme"), steps.portalApplied("acme"), steps.portalComplaint("acme"), steps.portalPay("acme"),
  ];

  it("every suggestion offers something to do, with exactly one highlighted choice at most", () => {
    for (const s of all) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.actions.length).toBeGreaterThan(0);
      expect(s.actions.filter((a) => a.primary).length).toBeLessThanOrEqual(1);
    }
  });

  it("every link stays inside the app", () => {
    for (const s of all) for (const a of s.actions) {
      expect(a.href, `${s.title} → ${a.label}`).toMatch(/^\/[A-Za-z0-9/#\-_?=.]*$/);
      expect(a.href.startsWith("//")).toBe(false);
    }
  });

  it("tells the user the right thing for the stage they have just reached", () => {
    expect(steps.stageMoved(id, 3, "Selected", id).body).toMatch(/contract/i);
    expect(steps.stageMoved(id, 4, "Getting ready", id).actions[0].href).toContain("#travel");
    expect(steps.stageMoved(id, 4, "Getting ready", id).actions.some((a) => a.href === "/verify")).toBe(true);
    expect(steps.stageMoved(id, 5, "Abroad", id).actions[0].href).toContain("#invoices");
  });

  it("only suggests raising an invoice when the employer pays the costs", () => {
    expect(steps.costAdded(id, true).actions.some((a) => a.label.includes("invoice"))).toBe(true);
    expect(steps.costAdded(id, false).actions.some((a) => a.label.includes("invoice"))).toBe(false);
  });
});

describe("sample data", () => {
  async function inNewAgency<T>(fn: (tx: Tx, tenantId: string) => Promise<T>): Promise<T> {
    let out!: T;
    await db.sql.begin(async (raw) => {
      const tx = raw as unknown as Tx;
      const [t] = await tx`SELECT platform_create_tenant('Sample Test', 'sample-test', 'Owner', 'owner@sample-test.example', 'h', 'pro', 14, ${tx.json(DEFAULT_STAGES as never)}) AS id`;
      await tx`SELECT set_config('app.tenant_id', ${t.id}, true)`;
      out = await fn(tx, t.id);
      throw new Rollback();
    }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
    return out;
  }

  it("removes only the sample records, including their append-only money rows, and keeps real ones", async () => {
    const r = await inNewAgency(async (tx, T) => {
      const real = await freshPlacement(tx, T, { stage: 2 });
      const sample = await freshPlacement(tx, T, { stage: 3 });
      await tx`UPDATE candidates SET source = 'sample' WHERE id = ${sample.candidateId}`;
      const [emp] = await tx`INSERT INTO employers (tenant_id, company, country, is_sample) VALUES (${T}, 'Sample Co', 'Qatar', true) RETURNING id`;
      await tx`INSERT INTO employers (tenant_id, company, country) VALUES (${T}, 'Real Co', 'UAE')`;
      void emp;
      await tx`INSERT INTO costs (tenant_id, placement_id, category, amount_minor) VALUES (${T}, ${sample.placementId}, 'Medical', 1000), (${T}, ${real.placementId}, 'Medical', 2000)`;
      await tx`INSERT INTO payments (tenant_id, receipt_no, party, placement_id, method, amount_minor, currency) VALUES (${T}, 'R-1', 'candidate', ${sample.placementId}, 'cash', 500, 'KES')`;
      await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id, detail) VALUES (${T}, 'candidate.create', 'candidate', ${sample.candidateId}, '{"name":"S"}')`;
      const [out] = await tx`SELECT sample_remove() AS r`;
      return {
        out: out.r,
        candidates: (await tx`SELECT id FROM candidates`).map((c) => c.id),
        employers: (await tx`SELECT company FROM employers`).map((e) => e.company),
        costs: (await tx`SELECT amount_minor FROM costs`).map((c) => Number(c.amount_minor)),
        payments: (await tx`SELECT 1 FROM payments`).length,
        real: real.candidateId,
      };
    });
    expect(r.out).toMatchObject({ candidates: 1, employers: 1 });
    expect(r.candidates).toEqual([r.real]);
    expect(r.employers).toEqual(["Real Co"]);
    expect(r.costs).toEqual([2000]);
    expect(r.payments).toBe(0);
  });

  it("never touches another agency's records", async () => {
    const before = ((await db.withTenant(((await db.sql`SELECT * FROM auth_lookup_user('admin@demo.test')`) as unknown as { tenant_id: string }[])[0].tenant_id, (tx) => tx`SELECT count(*) AS n FROM candidates`))[0].n);
    await inNewAgency(async (tx) => { await tx`SELECT sample_remove()`; });
    const after = ((await db.withTenant(((await db.sql`SELECT * FROM auth_lookup_user('admin@demo.test')`) as unknown as { tenant_id: string }[])[0].tenant_id, (tx) => tx`SELECT count(*) AS n FROM candidates`))[0].n);
    expect(after).toBe(before);
  });

  it("sample candidates are never sent messages", async () => {
    const { notifyCandidate } = await import("../src/lib/notify");
    const n = await inNewAgency(async (tx, T) => {
      const f = await freshPlacement(tx, T, { stage: 1 });
      await tx`UPDATE candidates SET source = 'sample' WHERE id = ${f.candidateId}`;
      await notifyCandidate(tx, T, { id: f.candidateId, name: "S", phone: "+254700000001", email: "s@x.example" }, "welcome", {});
      return (await tx`SELECT 1 FROM messages`).length;
    });
    expect(n).toBe(0);
  });
});

describe("every action says what comes next", () => {
  // Actions that need no suggestion go here.
  const SILENT = new Set<string>();

  it("each server action suggests a next step or moves the user on", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = "src/app/actions";
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && x !== "next.ts")) {
      const parts = readFileSync(`${dir}/${f}`, "utf8").split(/^export async function /m).slice(1);
      for (const p of parts) {
        const name = p.slice(0, p.indexOf("("));
        if (SILENT.has(name)) continue;
        if (!/next:|steps\.|redirect\(/.test(p)) missing.push(`${f}:${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
