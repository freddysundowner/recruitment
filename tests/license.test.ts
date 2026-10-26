import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LICENSE_GRACE_DAYS, stateFor, verifyKey, type LicensePayload } from "../src/lib/license";

const day = 864e5;
const pair = generateKeyPairSync("ed25519");
const pubB64 = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");

function issue(over: Partial<LicensePayload> = {}, privateKey = pair.privateKey): string {
  const payload: LicensePayload = { v: 1, customer: "Acme Recruiters", issued: new Date().toISOString(), expires: null, users: 10, updatesUntil: null, ...over };
  const body = `RAK1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`;
}

describe("activation keys", () => {
  it("verifies a key signed by the seller", () => {
    const r = verifyKey(issue(), pubB64);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({ customer: "Acme Recruiters", users: 10 });
  });

  it("rejects a key whose contents were edited", () => {
    const k = issue({ users: 5 }).split(".");
    const forged = JSON.parse(Buffer.from(k[1], "base64url").toString());
    forged.users = 500;
    k[1] = Buffer.from(JSON.stringify(forged)).toString("base64url");
    expect(verifyKey(k.join("."), pubB64).ok).toBe(false);
  });

  it("rejects a key signed by someone else", () => {
    const other = generateKeyPairSync("ed25519");
    expect(verifyKey(issue({}, other.privateKey), pubB64).ok).toBe(false);
  });

  it("rejects junk, and refuses to verify when no public key is configured", () => {
    expect(verifyKey("not a key", pubB64).ok).toBe(false);
    expect(verifyKey("RAK1.a.b", pubB64).ok).toBe(false);
    expect(verifyKey(issue(), "").ok).toBe(false);
  });
});

describe("what a key allows", () => {
  const state = (expiresInDays: number | null) => {
    const r = verifyKey(issue({ expires: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * day).toISOString() }), pubB64);
    if (!r.ok) throw new Error("test key invalid");
    return stateFor(r.payload);
  };

  it("a perpetual key never ends", () => {
    expect(state(null)).toMatchObject({ ok: true, writable: true, inGrace: false, daysLeft: null });
  });

  it("works until it ends, then for the grace period, then goes read-only", () => {
    expect(state(100)).toMatchObject({ writable: true, inGrace: false });
    expect(state(-1)).toMatchObject({ writable: true, inGrace: true });
    expect(state(-(LICENSE_GRACE_DAYS - 1))).toMatchObject({ writable: true, inGrace: true });
    expect(state(-(LICENSE_GRACE_DAYS + 1))).toMatchObject({ writable: false, inGrace: false });
  });
});
