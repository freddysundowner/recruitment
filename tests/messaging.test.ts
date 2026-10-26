import { config } from "dotenv";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sendSms } from "../src/lib/providers/sms";
import { sendEmail } from "../src/lib/providers/email";
import { DEFAULT_STAGES } from "../src/lib/stages";

config({ path: ".env.local" });

type Tx = import("../src/lib/db").Sql;
let db: typeof import("../src/lib/db");
let apply: typeof import("../src/lib/mpesa-apply");
let buildConfig: typeof import("../src/lib/platform-config").buildConfig;
let creditsFor: typeof import("../src/lib/platform-config").creditsFor;
let smsSegments: typeof import("../src/lib/platform-config").smsSegments;
class Rollback extends Error {}

beforeAll(async () => {
  db = await import("../src/lib/db");
  apply = await import("../src/lib/mpesa-apply");
  ({ buildConfig, creditsFor, smsSegments } = await import("../src/lib/platform-config")); // after the environment is loaded
});
afterEach(() => vi.unstubAllGlobals());

/** A throwaway agency that is rolled back at the end, like the other tests. */
async function inNewAgency<T>(fn: (tx: Tx, tenantId: string) => Promise<T>): Promise<T> {
  let out!: T;
  await db.sql.begin(async (raw) => {
    const tx = raw as unknown as Tx;
    const [t] = await tx`SELECT platform_create_tenant('Msg Test', 'msg-test', 'Owner', 'owner@msg-test.example', 'h', 'pro', 7, ${tx.json(DEFAULT_STAGES as never)}) AS id`;
    await tx`SELECT set_config('app.tenant_id', ${t.id}, true)`;
    out = await fn(tx, t.id);
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  return out;
}

describe("platform settings", () => {
  it("fall back to the environment, and the console wins when it has a value", async () => {
    const { encrypt } = await import("../src/lib/crypto");
    const env = { BLESSEDTEXTS_API_KEY: "env-key", BREVO_API_KEY: "env-brevo", EMAIL_FROM: "env@x.example" } as unknown as NodeJS.ProcessEnv;
    const fromEnv = buildConfig([], env);
    expect(fromEnv.sms.apiKey).toBe("env-key");
    expect(fromEnv.email.fromEmail).toBe("env@x.example");
    expect(fromEnv.credits).toEqual({ priceMinor: 40, freeOnSignup: 20 });
    expect(fromEnv.signup).toEqual({ enabled: true, trialDays: 7 });
    const fromDb = buildConfig([{ key: "sms", value: { api_key_enc: encrypt("db-key"), sender_id: "23107" } }, { key: "credits", value: { price_minor: 50, free_on_signup: 5 } }, { key: "signup", value: { enabled: false, trial_days: 14 } }], env);
    expect(fromDb.sms).toMatchObject({ apiKey: "db-key", senderId: "23107" });
    expect(fromDb.credits).toEqual({ priceMinor: 50, freeOnSignup: 5 });
    expect(fromDb.signup).toEqual({ enabled: false, trialDays: 14 });
  });

  it("a single install never offers sign-up", () => {
    expect(buildConfig([], { TENANT_MODE: "single" } as unknown as NodeJS.ProcessEnv).signup.enabled).toBe(false);
  });

  it("prices credits and counts text segments", () => {
    expect(creditsFor(10000, 40)).toBe(250); // KES 100 at KES 0.40
    expect(creditsFor(3900, 40)).toBe(97);
    expect(smsSegments("Hello")).toBe(1);
    expect(smsSegments("x".repeat(160))).toBe(1);
    expect(smsSegments("x".repeat(161))).toBe(2);
    expect(smsSegments("Habari ☺".repeat(10))).toBeGreaterThan(1);
  });
});

describe("providers", () => {
  const cfg = (extra: Record<string, unknown> = {}) => buildConfig([{ key: "sms", value: { sender_id: "23107", ...extra } }], { BLESSEDTEXTS_API_KEY: "k", BREVO_API_KEY: "b", EMAIL_FROM: "no-reply@x.example" } as unknown as NodeJS.ProcessEnv);

  it("sends a text the way BlessedTexts documents it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ status_code: "1000", status_desc: "Success", message_id: 77 }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendSms(cfg(), "+254721000111", "Hello world!", "MYAGENCY");
    expect(r).toEqual({ ref: "77", delivered: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sms.blessedtexts.com/api/sms/v1/sendsms");
    expect(JSON.parse(init.body)).toEqual({ api_key: "k", sender_id: "MYAGENCY", message: "Hello world!", phone: "254721000111" });
  });

  it("uses the platform sender when the agency has none, and reports a refusal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ status_code: "1003", status_desc: "Insufficient balance" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSms(cfg(), "+254721000111", "Hi")).rejects.toThrow(/Insufficient balance/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sender_id).toBe("23107");
  });

  it("only logs when there is no API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendSms(buildConfig([], {} as NodeJS.ProcessEnv), "+254721000111", "Hi")).toEqual({ ref: "dev-log", delivered: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends email through Brevo, from the agency's own address when it has one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "<abc@brevo>" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendEmail(cfg(), "a@b.example", "Subject", "Body", { email: "jobs@agency.example", name: "Agency" });
    expect(r).toEqual({ ref: "<abc@brevo>", delivered: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe("b");
    expect(JSON.parse(init.body)).toMatchObject({ sender: { email: "jobs@agency.example", name: "Agency" }, to: [{ email: "a@b.example" }], subject: "Subject", textContent: "Body" });
  });
});

describe("SMS credits", () => {
  it("spending takes credits, refusing when there are not enough, and a refund puts them back", async () => {
    const r = await inNewAgency(async (tx, T) => {
      await tx`SELECT sms_credits_add(${T}, 20, 'signup_grant', 'initial')`;
      const a = (await tx`SELECT sms_credits_spend(${T}, 3, 'm1') AS ok`)[0].ok;
      const left = (await tx`SELECT sms_credits FROM tenants WHERE id = ${T}`)[0].sms_credits;
      const tooMany = (await tx`SELECT sms_credits_spend(${T}, 500, 'm2') AS ok`)[0].ok;
      await tx`SELECT sms_credits_add(${T}, 3, 'refund', 'm1')`;
      const back = (await tx`SELECT sms_credits FROM tenants WHERE id = ${T}`)[0].sms_credits;
      const ledger = await tx`SELECT delta, balance_after, reason FROM sms_credit_ledger ORDER BY created_at, delta`;
      return { a, left, tooMany, back, ledger };
    });
    expect(r.a).toBe(true);
    expect(r.left).toBe(17);
    expect(r.tooMany).toBe(false);
    expect(r.back).toBe(20);
    expect(r.ledger.map((l) => l.delta).sort((x, y) => x - y)).toEqual([-3, 3, 20]);
  });

  it("the welcome credits and a purchase can only be counted once", async () => {
    const left = await inNewAgency(async (tx, T) => {
      await tx`SELECT sms_credits_add(${T}, 20, 'signup_grant', 'initial')`;
      await tx`SELECT sms_credits_add(${T}, 20, 'signup_grant', 'initial')`;
      await tx`SELECT sms_credits_add(${T}, 250, 'purchase', 'NLJ7RT61SV')`;
      await tx`SELECT sms_credits_add(${T}, 250, 'purchase', 'NLJ7RT61SV')`;
      return (await tx`SELECT sms_credits FROM tenants WHERE id = ${T}`)[0].sms_credits;
    });
    expect(left).toBe(270);
  });

  it("an agency cannot give itself credits or edit the ledger", async () => {
    const r = await inNewAgency(async (tx, T) => {
      await tx`SELECT sms_credits_add(${T}, 5, 'signup_grant', 'initial')`;
      await tx`SELECT set_config('app.tenant_id', ${T}, true)`;
      const out: string[] = [];
      for (const q of [() => tx`INSERT INTO sms_credit_ledger (tenant_id, delta, balance_after, reason) VALUES (${T}, 99, 99, 'admin')`, () => tx`UPDATE tenants SET sms_credits = 9999 WHERE id = ${T}`]) {
        await tx`SAVEPOINT s`;
        try { await q(); out.push("allowed"); } catch (e) { out.push((e as Error).message); }
        await tx`ROLLBACK TO SAVEPOINT s`;
      }
      return out;
    });
    expect(r, JSON.stringify(r)).toHaveLength(2);
    expect(r[0]).toMatch(/permission denied/);
    expect(r[1]).toMatch(/permission denied/);
  });

  it("a confirmed M-Pesa purchase adds the credits, once", async () => {
    const r = await inNewAgency(async (tx, T) => {
      const [req] = await tx`
        INSERT INTO mpesa_requests (tenant_id, purpose, phone, amount_minor, account_ref, token_hash, checkout_request_id, meta)
        VALUES (${T}, 'sms_credits', '+254700000000', 10000, 'SMSTEST', ${"h" + Math.random()}, 'ws_CO_test', ${tx.json({ credits: 250 } as never)}) RETURNING id`;
      const first = await apply.applyMpesaResult(tx, T, req.id, { resultCode: 0, resultDesc: "ok", amount: 100, receipt: "ABC123XYZ9" });
      const second = await apply.applyMpesaResult(tx, T, req.id, { resultCode: 0, resultDesc: "ok", amount: 100, receipt: "ABC123XYZ9" });
      const wrong = await (async () => {
        const [r2] = await tx`
          INSERT INTO mpesa_requests (tenant_id, purpose, phone, amount_minor, account_ref, token_hash, checkout_request_id, meta)
          VALUES (${T}, 'sms_credits', '+254700000000', 10000, 'SMSTEST', ${"h" + Math.random()}, 'ws_CO_test2', ${tx.json({ credits: 250 } as never)}) RETURNING id`;
        return apply.applyMpesaResult(tx, T, r2.id, { resultCode: 0, resultDesc: "ok", amount: 5, receipt: "ZZZ999AAA1" });
      })();
      return { first, second, wrong, left: (await tx`SELECT sms_credits FROM tenants WHERE id = ${T}`)[0].sms_credits };
    });
    expect(r.first).toBe("applied");
    expect(r.second).toBe("ignored");
    expect(r.wrong).toBe("amount_mismatch"); // paying a different amount adds nothing
    expect(r.left).toBe(250);
  });
});

describe("sender IDs", () => {
  it("a new sender waits for approval, and replacing it starts the wait again", async () => {
    const r = await inNewAgency(async (tx, T) => {
      await tx`SELECT tenant_sender_set(${T}, 'sms', 'SUNRISE', '', false)`;
      const first = (await tx`SELECT status FROM tenant_senders WHERE kind = 'sms'`)[0].status;
      const [row] = await tx`SELECT id FROM tenant_senders WHERE kind = 'sms'`;
      await tx`SELECT platform_sender_review(${row.id}, 'approved', '', 'tester')`;
      const approved = (await tx`SELECT status FROM tenant_senders WHERE kind = 'sms'`)[0].status;
      await tx`SELECT tenant_sender_set(${T}, 'sms', 'OTHERNAME', '', false)`;
      const replaced = (await tx`SELECT status, value FROM tenant_senders WHERE kind = 'sms'`)[0];
      const auto = await tx`SELECT tenant_sender_set(${T}, 'email', 'jobs@x.example', 'X', true)`;
      const email = (await tx`SELECT status FROM tenant_senders WHERE kind = 'email'`)[0].status;
      return { first, approved, replaced, email, auto: auto.length };
    });
    expect(r.first).toBe("pending");
    expect(r.approved).toBe("approved");
    expect(r.replaced).toEqual({ status: "pending", value: "OTHERNAME" });
    expect(r.email).toBe("approved"); // a single install has nobody to ask
  });
});

describe("delivering a queued message", () => {
  // The worker works across agencies as the table owner, so this uses the owner connection and rolls everything back.
  async function asWorker<T>(fn: (sql: import("postgres").Sql, tenantId: string) => Promise<T>): Promise<T> {
    const postgres = (await import("postgres")).default;
    const admin = postgres(process.env.MIGRATE_DATABASE_URL!, { onnotice: () => {} });
    let out!: T;
    try {
      await admin.begin(async (tx) => {
        const [t] = await tx`SELECT platform_create_tenant('Deliver Test', 'deliver-test', 'Owner', 'owner@deliver-test.example', 'h', 'pro', 7, ${tx.json(DEFAULT_STAGES as never)}) AS id`;
        await tx`SELECT sms_credits_add(${t.id}, 2, 'signup_grant', 'initial')`;
        out = await fn(tx as never, t.id);
        throw new Rollback();
      }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
    } finally { await admin.end(); }
    return out;
  }
  const queue = async (tx: import("postgres").Sql, T: string, body: string, channel = "sms") =>
    (await tx`INSERT INTO messages (tenant_id, channel, to_addr, subject, body, template) VALUES (${T}, ${channel}, ${channel === "sms" ? "+254700000001" : "a@b.example"}, 'S', ${body}, 'test') RETURNING id`)[0].id as string;
  const configured = () => buildConfig([], { BLESSEDTEXTS_API_KEY: "k", BLESSEDTEXTS_SENDER_ID: "23107", BREVO_API_KEY: "b", EMAIL_FROM: "x@y.example" } as unknown as NodeJS.ProcessEnv);

  it("a delivered text costs one credit and is recorded; the agency's approved sender is used", async () => {
    const { deliverMessage } = await import("../src/lib/send-message");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ status_code: "1000", status_desc: "Success", message_id: 9 }])));
    vi.stubGlobal("fetch", fetchMock);
    const r = await asWorker(async (sql, T) => {
      const [s] = await sql`INSERT INTO tenant_senders (tenant_id, kind, value, status) VALUES (${T}, 'sms', 'MYAGENCY', 'approved') RETURNING id`;
      void s;
      const id = await queue(sql, T, "Hello");
      await deliverMessage(sql, id, configured(), false);
      const [m] = await sql`SELECT status, credits FROM messages WHERE id = ${id}`;
      return { m, left: (await sql`SELECT sms_credits FROM tenants WHERE id = ${T}`)[0].sms_credits };
    });
    expect(r.m).toMatchObject({ status: "sent", credits: 1 });
    expect(r.left).toBe(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sender_id).toBe("MYAGENCY");
  });

  it("a text the provider refuses is refunded", async () => {
    const { deliverMessage } = await import("../src/lib/send-message");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ status_code: "1007", status_desc: "Invalid sender" }]))));
    const r = await asWorker(async (sql, T) => {
      const id = await queue(sql, T, "Hello");
      const err = await deliverMessage(sql, id, configured(), false).catch((e) => e as Error);
      return { err, left: (await sql`SELECT sms_credits FROM tenants WHERE id = ${T}`)[0].sms_credits };
    });
    expect((r.err as Error).message).toMatch(/Invalid sender/);
    expect(r.left).toBe(2);
  });

  it("with no credits left the text is not sent", async () => {
    const { deliverMessage, OutOfCredits } = await import("../src/lib/send-message");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await asWorker(async (sql, T) => {
      await sql`SELECT sms_credits_spend(${T}, 2, 'x')`;
      const id = await queue(sql, T, "Hello");
      const err = await deliverMessage(sql, id, configured(), false).catch((e) => e);
      return err instanceof OutOfCredits;
    });
    expect(r).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("emails and single installs are never charged credits", async () => {
    const { deliverMessage } = await import("../src/lib/send-message");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ messageId: "m", status_code: "1000" }), { status: 200 }))));
    const r = await asWorker(async (sql, T) => {
      const mail = await queue(sql, T, "Hi", "email");
      await deliverMessage(sql, mail, configured(), false);
      const text = await queue(sql, T, "Hi");
      await deliverMessage(sql, text, configured(), true);
      return (await sql`SELECT sms_credits FROM tenants WHERE id = ${T}`)[0].sms_credits;
    });
    expect(r).toBe(2);
  });
});

describe("saving platform settings", () => {
  it("round-trips through the database with secrets kept encrypted", async () => {
    const { encrypt } = await import("../src/lib/crypto");
    const { getRawSettings, getPlatformConfig } = await import("../src/lib/platform-config");
    const postgres = (await import("postgres")).default;
    const admin = postgres(process.env.MIGRATE_DATABASE_URL!, { onnotice: () => {} });
    const before = await admin`SELECT value FROM platform_settings WHERE key = 'sms'`;
    try {
      await db.sql`SELECT platform_setting_save('sms', ${db.sql.json({ api_key_enc: encrypt("secret-key-123"), sender_id: "23107" } as never)}, 'test')`;
      const raw = await getRawSettings();
      expect(JSON.stringify(raw.sms)).not.toContain("secret-key-123");
      const cfg = await getPlatformConfig();
      expect(cfg.sms).toMatchObject({ apiKey: "secret-key-123", senderId: "23107" });
    } finally {
      if (before.length) await admin`UPDATE platform_settings SET value = ${admin.json(before[0].value)} WHERE key = 'sms'`;
      else await admin`DELETE FROM platform_settings WHERE key = 'sms'`;
      await admin.end();
    }
  });

  it("the agencies' database role cannot read the settings table directly", async () => {
    await expect(db.sql`SELECT * FROM platform_settings`).rejects.toThrow(/permission denied/);
  });
});
