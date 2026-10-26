import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

type Tx = import("../src/lib/db").Sql;
let db: typeof import("../src/lib/db");
let otp: typeof import("../src/lib/otp");
let tenantId: string;
class Rollback extends Error {}

async function sandbox<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  await db.withTenant(tenantId, async (tx) => { out = await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  return out;
}
/** Test helper: read the code the system queued for sending, the way a person would read their SMS. */
const sentCode = async (tx: Tx) => {
  const [m] = await tx`SELECT body FROM messages WHERE template = 'otp' ORDER BY created_at DESC LIMIT 1`;
  return m.body.match(/\b(\d{6})\b/)[1] as string;
};

beforeAll(async () => {
  db = await import("../src/lib/db");
  otp = await import("../src/lib/otp");
  tenantId = ((await db.sql`SELECT * FROM auth_lookup_user('admin@demo.test')`) as unknown as { tenant_id: string }[])[0].tenant_id;
});

describe("one-time codes", () => {
  it("accepts the right code once and never again", async () => {
    const r = await sandbox(async (tx) => {
      await otp.issueOtp(tx, tenantId, "Demo", "+254700000001", "login");
      const code = await sentCode(tx);
      const first = await otp.checkOtp(tx, tenantId, "+254700000001", "login", code);
      const again = await otp.checkOtp(tx, tenantId, "+254700000001", "login", code);
      return { first, again };
    });
    expect(r.first.ok).toBe(true);
    expect(r.again.ok).toBe(false);
  });

  it("rejects a wrong code, and locks the code after five wrong tries", async () => {
    const r = await sandbox(async (tx) => {
      await otp.issueOtp(tx, tenantId, "Demo", "+254700000002", "login");
      const code = await sentCode(tx);
      const wrong = code === "000000" ? "111111" : "000000";
      const results = [];
      for (let i = 0; i < 5; i++) results.push((await otp.checkOtp(tx, tenantId, "+254700000002", "login", wrong)).ok);
      const rightButLocked = await otp.checkOtp(tx, tenantId, "+254700000002", "login", code);
      return { results, rightButLocked };
    });
    expect(r.results).toEqual([false, false, false, false, false]);
    expect(r.rightButLocked.ok).toBe(false);
  });

  it("does not work for a different number or purpose", async () => {
    const r = await sandbox(async (tx) => {
      await otp.issueOtp(tx, tenantId, "Demo", "+254700000003", "login");
      const code = await sentCode(tx);
      return {
        otherPhone: await otp.checkOtp(tx, tenantId, "+254700000004", "login", code),
        otherPurpose: await otp.checkOtp(tx, tenantId, "+254700000003", "register", code),
      };
    });
    expect(r.otherPhone.ok).toBe(false);
    expect(r.otherPurpose.ok).toBe(false);
  });

  it("expires", async () => {
    const r = await sandbox(async (tx) => {
      await otp.issueOtp(tx, tenantId, "Demo", "+254700000005", "login");
      const code = await sentCode(tx);
      await tx`UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE phone = '+254700000005'`;
      return otp.checkOtp(tx, tenantId, "+254700000005", "login", code);
    });
    expect(r.ok).toBe(false);
  });

  it("limits how many codes one number can request", async () => {
    const r = await sandbox(async (tx) => {
      const out = [];
      for (let i = 0; i < 4; i++) out.push((await otp.issueOtp(tx, tenantId, "Demo", "+254700000006", "login")).ok);
      return out;
    });
    expect(r).toEqual([true, true, true, false]);
  });

  it("stores only a hash of the code", async () => {
    const r = await sandbox(async (tx) => {
      await otp.issueOtp(tx, tenantId, "Demo", "+254700000007", "login");
      const code = await sentCode(tx);
      const [row] = await tx`SELECT code_hash FROM otp_codes WHERE phone = '+254700000007'`;
      return { code, hash: row.code_hash as string };
    });
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.hash).not.toContain(r.code);
  });
});
