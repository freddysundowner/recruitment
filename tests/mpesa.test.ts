import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCallback } from "../src/lib/mpesa";

config({ path: ".env.local" });

type Tx = import("../src/lib/db").Sql;
let db: typeof import("../src/lib/db");
let apply: typeof import("../src/lib/mpesa-apply");
let demo: { id: string; tenant_id: string };
class Rollback extends Error {}

async function sandbox<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  await db.withTenant(demo.tenant_id, async (tx) => { out = await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  return out;
}

beforeAll(async () => {
  db = await import("../src/lib/db");
  apply = await import("../src/lib/mpesa-apply");
  demo = ((await db.sql`SELECT * FROM auth_lookup_user('admin@demo.test')`) as unknown as { id: string; tenant_id: string }[])[0];
});

// The shape Safaricom documents for a successful STK push result.
const success = {
  Body: { stkCallback: {
    MerchantRequestID: "29115-34620561-1", CheckoutRequestID: "ws_CO_191220191020363925", ResultCode: 0,
    ResultDesc: "The service request is processed successfully.",
    CallbackMetadata: { Item: [
      { Name: "Amount", Value: 1500 }, { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
      { Name: "TransactionDate", Value: 20191219102115 }, { Name: "PhoneNumber", Value: 254708374149 },
    ] },
  } },
};

describe("callback parsing", () => {
  it("reads a success payload", () => {
    expect(parseCallback(success)).toMatchObject({ checkoutRequestId: "ws_CO_191220191020363925", resultCode: 0, amount: 1500, receipt: "NLJ7RT61SV", phone: "254708374149" });
  });
  it("reads a cancellation, which has no metadata", () => {
    const r = parseCallback({ Body: { stkCallback: { MerchantRequestID: "x", CheckoutRequestID: "y", ResultCode: 1032, ResultDesc: "Request cancelled by user" } } });
    expect(r).toMatchObject({ resultCode: 1032, receipt: undefined });
  });
  it("rejects junk", () => {
    expect(parseCallback({})).toBeNull();
    expect(parseCallback({ Body: { stkCallback: { ResultCode: "0" } } })).toBeNull();
  });
});

describe("applying a result", () => {
  async function newRequest(tx: Tx, amountKes = 1500) {
    const [p] = await tx`SELECT p.id, p.candidate_id FROM placements p WHERE p.outcome <> 'closed' LIMIT 1`;
    const [r] = await tx`
      INSERT INTO mpesa_requests (tenant_id, placement_id, candidate_id, phone, amount_minor, account_ref, checkout_request_id, token_hash, created_by)
      VALUES (${demo.tenant_id}, ${p.id}, ${p.candidate_id}, '+254708374149', ${amountKes * 100}, 'FEE', 'ws_CO_test', ${"hash" + Math.random()}, ${demo.id}) RETURNING id`;
    return { id: r.id as string, placementId: p.id as string };
  }

  it("records a payment once, even if Safaricom retries the callback", async () => {
    const r = await sandbox(async (tx) => {
      const q = await newRequest(tx);
      const cb = parseCallback(success)!;
      const first = await apply.applyMpesaResult(tx, demo.tenant_id, q.id, cb);
      const second = await apply.applyMpesaResult(tx, demo.tenant_id, q.id, cb);
      const pays = await tx`SELECT receipt_no, reference, amount_minor, method FROM payments WHERE placement_id = ${q.placementId} AND reference = 'NLJ7RT61SV'`;
      const [req] = await tx`SELECT status, mpesa_receipt FROM mpesa_requests WHERE id = ${q.id}`;
      return { first, second, pays, req };
    });
    expect(r.first).toBe("applied");
    expect(r.second).toBe("ignored");
    expect(r.pays).toHaveLength(1);
    expect(r.pays[0]).toMatchObject({ method: "mpesa", reference: "NLJ7RT61SV" });
    expect(Number(r.pays[0].amount_minor)).toBe(150000);
    expect(r.req).toMatchObject({ status: "success", mpesa_receipt: "NLJ7RT61SV" });
  });

  it("does not trust a success for a different amount", async () => {
    const r = await sandbox(async (tx) => {
      const q = await newRequest(tx, 2000);
      const res = await apply.applyMpesaResult(tx, demo.tenant_id, q.id, parseCallback(success)!); // paid 1500, asked 2000
      const pays = await tx`SELECT 1 FROM payments WHERE reference = 'NLJ7RT61SV'`;
      const [req] = await tx`SELECT status, result_desc FROM mpesa_requests WHERE id = ${q.id}`;
      return { res, pays, req };
    });
    expect(r.res).toBe("amount_mismatch");
    expect(r.pays).toHaveLength(0);
    expect(r.req.status).toBe("failed");
    expect(r.req.result_desc).toMatch(/Amount mismatch/);
  });

  it("marks a cancelled request without recording a payment", async () => {
    const r = await sandbox(async (tx) => {
      const q = await newRequest(tx);
      await apply.applyMpesaResult(tx, demo.tenant_id, q.id, { resultCode: 1032, resultDesc: "Request cancelled by user" });
      const [req] = await tx`SELECT status FROM mpesa_requests WHERE id = ${q.id}`;
      const pays = await tx`SELECT 1 FROM payments WHERE placement_id = ${q.placementId} AND method = 'mpesa'`;
      return { status: req.status, pays: pays.length };
    });
    expect(r).toEqual({ status: "cancelled", pays: 0 });
  });

  it("lets Safaricom's callback find its agency only through the secret token", async () => {
    const { sha256 } = await import("../src/lib/crypto");
    const found = await sandbox(async (tx) => {
      const q = await newRequest(tx);
      await tx`UPDATE mpesa_requests SET token_hash = ${sha256("secret-token")} WHERE id = ${q.id}`;
      return db.sql`SELECT * FROM mpesa_lookup(${sha256("secret-token")})`; // outside the sandbox connection: sees nothing until committed
    });
    expect(found).toHaveLength(0);
    expect(await db.sql`SELECT * FROM mpesa_lookup(${sha256("wrong-token")})`).toHaveLength(0);
  });
});
