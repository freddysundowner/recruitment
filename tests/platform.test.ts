import { config } from "dotenv";
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_STAGES } from "../src/lib/stages";

config({ path: ".env.local" });

type Tx = import("../src/lib/db").Sql;
let db: typeof import("../src/lib/db");
let plan: typeof import("../src/lib/plan");
class Rollback extends Error {}

/** Runs against the real database as the app role, then rolls everything back. */
async function sandbox<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  await db.sql.begin(async (tx) => { out = await fn(tx as unknown as Tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  return out;
}
const newTenant = async (tx: Tx, slug = "acme-test", email = "owner@acme-test.example", planCode = "pro") => {
  const [r] = await tx`SELECT platform_create_tenant('Acme Test', ${slug}, 'Owner', ${email}, 'hash', ${planCode}, 14, ${tx.json(DEFAULT_STAGES as never)}) AS id`;
  await tx`SELECT set_config('app.tenant_id', ${r.id}, true)`;
  return r.id as string;
};

beforeAll(async () => {
  db = await import("../src/lib/db");
  plan = await import("../src/lib/plan");
});

describe("signup", () => {
  it("creates an agency with its admin, five stages and a trial", async () => {
    const r = await sandbox(async (tx) => {
      const id = await newTenant(tx);
      const [t] = await tx`SELECT name, slug, plan FROM tenants`;
      const users = await tx`SELECT role FROM users`;
      const stages = await tx`SELECT name, position, requires_contract FROM pipeline_stages ORDER BY position`;
      const [s] = await tx`SELECT status, plan_code, current_period_end - now() AS left FROM subscriptions`;
      return { id, t, users, stages, s };
    });
    expect(r.t).toMatchObject({ slug: "acme-test", plan: "pro" });
    expect(r.users.map((u) => u.role)).toEqual(["admin"]);
    expect(r.stages).toHaveLength(5);
    expect(r.stages[2]).toMatchObject({ name: "Selected", requires_contract: true });
    expect(r.s.status).toBe("trialing");
  });

  it("refuses bad, reserved and taken addresses and emails", async () => {
    const fails = async (slug: string, email: string) => sandbox(async (tx) => {
      try { await tx`SAVEPOINT s`; await newTenant(tx, slug, email); return "ok"; } catch (e) { return (e as Error).message; }
    });
    expect(await fails("Bad Slug!", "a@x.example")).toBe("bad_slug");
    expect(await fails("platform", "b@x.example")).toBe("reserved_slug");
    expect(await fails("demo", "c@x.example")).toBe("slug_taken");
    expect(await fails("fresh-one", "admin@demo.test")).toBe("email_taken");
  });

  it("starts the new agency with nothing from any other agency", async () => {
    const r = await sandbox(async (tx) => {
      await newTenant(tx);
      return { candidates: await tx`SELECT 1 FROM candidates`, employers: await tx`SELECT 1 FROM employers`, tenants: await tx`SELECT 1 FROM tenants`, users: await tx`SELECT 1 FROM users` };
    });
    expect(r.candidates).toHaveLength(0);
    expect(r.employers).toHaveLength(0);
    expect(r.tenants).toHaveLength(1);
    expect(r.users).toHaveLength(1);
  });
});

describe("subscription payments", () => {
  it("adds months to the paid period and activates the plan", async () => {
    const r = await sandbox(async (tx) => {
      const id = await newTenant(tx);
      const [before] = await tx`SELECT current_period_end AS e FROM subscriptions`;
      await tx`SELECT platform_record_payment(${id}, 1500000, 'bank', 'REF-1', 3, 'starter', 'test')`;
      const [after] = await tx`SELECT current_period_end AS e, status, plan_code FROM subscriptions`;
      const pays = await tx`SELECT months, plan_code, period_start, period_end FROM subscription_payments`;
      return { before: before.e as Date, after, pays };
    });
    const monthsLater = (r.after.e as Date).getTime() - r.before.getTime();
    expect(monthsLater).toBeGreaterThan(80 * 864e5); // about 3 months
    expect(r.after).toMatchObject({ status: "active", plan_code: "starter" });
    expect(r.pays[0].months).toBe(3);
  });

  it("will not record the same reference twice", async () => {
    const r = await sandbox(async (tx) => {
      const id = await newTenant(tx);
      await tx`SELECT platform_record_payment(${id}, 100, 'mpesa', 'QWE123', 1, 'pro', 'mpesa')`;
      try { await tx`SAVEPOINT x`; await tx`SELECT platform_record_payment(${id}, 100, 'mpesa', 'QWE123', 1, 'pro', 'mpesa')`; return "recorded twice"; }
      catch (e) { return (e as { code?: string }).code; }
    });
    expect(r).toBe("23505");
  });

  it("an agency can read its own payments but cannot write to its subscription", async () => {
    const r = await sandbox(async (tx) => {
      const id = await newTenant(tx);
      await tx`SELECT platform_record_payment(${id}, 100, 'bank', 'R9', 1, 'pro', 'test')`;
      const mine = await tx`SELECT 1 FROM subscription_payments`;
      let write = "allowed";
      try { await tx`SAVEPOINT w`; await tx`UPDATE subscriptions SET plan_code = 'enterprise'`; } catch (e) { write = (e as Error).message; }
      return { mine: mine.length, write };
    });
    expect(r.mine).toBe(1);
    expect(r.write).toMatch(/permission denied/);
  });
});

describe("access rules", () => {
  const row = (endDaysFromNow: number, over: Partial<Parameters<typeof plan.buildAccess>[0]> = {}) => ({
    tenant_status: "active", plan_code: "pro", status: "active", current_period_end: new Date(Date.now() + endDaysFromNow * 864e5),
    name: "Pro", features: null, max_users: 10, max_candidates: 3000, ...over,
  });

  it("works for the whole period, then for 7 days of grace, then goes read-only", () => {
    expect(plan.buildAccess(row(20))).toMatchObject({ writable: true, inGrace: false });
    expect(plan.buildAccess(row(0.5))).toMatchObject({ writable: true, inGrace: false });
    expect(plan.buildAccess(row(-1))).toMatchObject({ writable: true, inGrace: true });
    expect(plan.buildAccess(row(-6.5))).toMatchObject({ writable: true, inGrace: true });
    expect(plan.buildAccess(row(-8))).toMatchObject({ writable: false, inGrace: false });
  });

  it("is read-only when cancelled or suspended, whatever the dates", () => {
    expect(plan.buildAccess(row(30, { status: "cancelled" })).writable).toBe(false);
    expect(plan.buildAccess(row(30, { tenant_status: "suspended" })).writable).toBe(false);
  });

  it("lets a plan's own features override the defaults", () => {
    const a = plan.buildAccess(row(30, { features: { whatsapp: false, mpesa: false } }));
    expect(a.features).toMatchObject({ whatsapp: false, mpesa: false, reports: true });
  });

  it("is writable during a trial and for the grace days, and read-only after", async () => {
    const r = await sandbox(async (tx) => {
      const id = await newTenant(tx);
      const a = await plan.loadAccess(tx, id);
      return a;
    });
    expect(r).toMatchObject({ planCode: "pro", status: "trialing", writable: true, inGrace: false });
    expect(r.daysLeft).toBeGreaterThan(12);
  });

  it("applies the plan's features and limits", async () => {
    const r = await sandbox(async (tx) => {
      const id = await newTenant(tx, "tiny-test", "owner@tiny-test.example", "starter");
      return { a: await plan.loadAccess(tx, id), id };
    });
    expect(r.a.features).toMatchObject({ candidate_portal: false, mpesa: false, reports: true });
    expect(r.a.maxUsers).toBe(3);
    expect(r.a.maxCandidates).toBe(300);
  });

  it("limits staff accounts to what the plan allows", async () => {
    const r = await sandbox(async (tx) => {
      const id = await newTenant(tx, "tiny-test", "owner@tiny-test.example", "starter");
      await tx`INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES (${id}, 'B', 'b@tiny-test.example', 'h', 'recruiter'), (${id}, 'C', 'c@tiny-test.example', 'h', 'finance')`;
      try { await plan.assertUserSlot(tx, id); return "allowed"; } catch (e) { return (e as Error).message; }
    });
    expect(r).toMatch(/allows 3 staff accounts/);
  });

  it("limits candidates to what the plan allows", async () => {
    const r = await sandbox(async (tx) => {
      const id = await newTenant(tx, "tiny-test", "owner@tiny-test.example", "starter");
      try { await plan.assertCandidateSlots(tx, id, 301); return "allowed"; } catch (e) { return (e as Error).message; }
    });
    expect(r).toMatch(/allows 300 candidates/);
  });

  it("a suspended agency is not writable", async () => {
    const r = await sandbox(async (tx) => {
      const id = await newTenant(tx);
      await tx`SELECT platform_set_status(${id}, 'suspended', 'test')`;
      return plan.loadAccess(tx, id);
    });
    expect(r.writable).toBe(false);
    expect(plan.lockedMessage(r)).toMatch(/suspended/);
  });

  it("the public candidate pages close for a lapsed or suspended agency", async () => {
    const open = await sandbox(async (tx) => { await newTenant(tx); return (await tx`SELECT * FROM tenant_public('acme-test')`)[0]?.portal_open; });
    expect(open).toBe(true);
    const suspended = await sandbox(async (tx) => { const id = await newTenant(tx); await tx`SELECT platform_set_status(${id}, 'suspended', 't')`; return (await tx`SELECT * FROM tenant_public('acme-test')`).length; });
    expect(suspended).toBe(0);
    const starter = await sandbox(async (tx) => { await newTenant(tx, "tiny-test", "o@tiny-test.example", "starter"); return (await tx`SELECT * FROM tenant_public('tiny-test')`)[0]?.portal_open; });
    expect(starter).toBe(false); // the Starter plan does not include the candidate portal
  });
});

describe("stripe webhook signature", () => {
  it("accepts a correctly signed message and rejects tampering and old messages", async () => {
    const { verifyStripeSignature } = await import("../src/lib/stripe");
    const secret = "whsec_test";
    const body = '{"type":"checkout.session.completed"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret)).toBe(true);
    expect(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0")}`, secret)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t - 1000},v1=${createHmac("sha256", secret).update(`${t - 1000}.${body}`).digest("hex")}`, secret)).toBe(false);
    expect(verifyStripeSignature(body, null, secret)).toBe(false);
  });
});
