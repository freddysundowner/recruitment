import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { freshPlacement } from "./helpers";

config({ path: ".env.local" });

type Tx = import("../src/lib/db").Sql;
let db: typeof import("../src/lib/db");
let demo: string, other: string;
class Rollback extends Error {}

async function inTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  await db.withTenant(tenantId, async (tx) => { out = await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  return out;
}

beforeAll(async () => {
  db = await import("../src/lib/db");
  const q = async (e: string) => ((await db.sql`SELECT * FROM auth_lookup_user(${e})`) as unknown as { tenant_id: string }[])[0].tenant_id;
  demo = await q("admin@demo.test");
  other = await q("admin@other.test");
});

describe("erasing a candidate's traces", () => {
  it("removes their messages and strips their name from the audit trail", async () => {
    const r = await inTenant(demo, async (tx) => {
      const f = await freshPlacement(tx, demo, { stage: 1 });
      await tx`INSERT INTO messages (tenant_id, channel, to_addr, body, template, candidate_id) VALUES (${demo}, 'sms', '+254700', 'Hello Test', 'welcome', ${f.candidateId})`;
      await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id, detail) VALUES (${demo}, 'candidate.create', 'candidate', ${f.candidateId}, '{"name":"Test Person"}')`;
      await tx`INSERT INTO audit_log (tenant_id, action, entity, entity_id, detail) VALUES (${demo}, 'stage.move', 'placement', ${f.placementId}, '{"to":"Screen"}')`;
      const [{ erase_candidate_traces: n }] = await tx`SELECT erase_candidate_traces(${f.candidateId})`;
      return {
        n,
        messages: (await tx`SELECT 1 FROM messages WHERE candidate_id = ${f.candidateId}`).length,
        named: (await tx`SELECT 1 FROM audit_log WHERE entity_id = ${f.candidateId} AND detail ? 'name'`).length,
        kept: (await tx`SELECT 1 FROM audit_log WHERE entity_id = ${f.candidateId}`).length, // the event stays, minus the name
        otherAudit: (await tx`SELECT 1 FROM audit_log WHERE entity_id = ${f.placementId}`).length,
      };
    });
    expect(r.n).toBe(2);
    expect(r.messages).toBe(0);
    expect(r.named).toBe(0);
    expect(r.kept).toBe(1);
    expect(r.otherAudit).toBe(1);
  });

  it("cannot reach another agency's candidate", async () => {
    // A candidate and message in the demo agency...
    let candidateId = "";
    await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${demo}, true)`;
      const f = await freshPlacement(tx as unknown as Tx, demo, { stage: 1 });
      candidateId = f.candidateId;
      await tx`INSERT INTO messages (tenant_id, channel, to_addr, body, template, candidate_id) VALUES (${demo}, 'sms', '+254701', 'Private', 'welcome', ${f.candidateId})`;
      // ...cannot be erased by a session that belongs to the other agency.
      await tx`SELECT set_config('app.tenant_id', ${other}, true)`;
      await tx`SELECT erase_candidate_traces(${f.candidateId})`;
      await tx`SELECT set_config('app.tenant_id', ${demo}, true)`;
      const still = await tx`SELECT 1 FROM messages WHERE candidate_id = ${f.candidateId}`;
      expect(still).toHaveLength(1);
      throw new Rollback();
    }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
    expect(candidateId).not.toBe("");
  });
});
