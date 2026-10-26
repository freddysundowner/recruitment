import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { blindIndex, decrypt, encrypt, mask } from "../src/lib/crypto";
import { base32Decode, base32Encode, codeAt, newRecoveryCodes, verifyCode } from "../src/lib/totp";
import { normalizePhone } from "../src/lib/phone";
import { toMinor } from "../src/lib/money";

config({ path: ".env.local" });

describe("TOTP", () => {
  // RFC 6238 appendix B: secret "12345678901234567890", time 59 s, expected 94287082 (8 digits), so 287082 in 6.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC 6238 test vector", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(codeAt(secret, 59_000)).toBe("287082");
    expect(codeAt(secret, 1_111_111_109_000)).toBe("081804");
  });
  it("accepts one step of clock drift but not more", () => {
    expect(verifyCode(secret, "287082", 59_000)).toBe(true);
    expect(verifyCode(secret, "287082", 59_000 + 30_000)).toBe(true);
    expect(verifyCode(secret, "287082", 59_000 + 120_000)).toBe(false);
    expect(verifyCode(secret, "12345", 59_000)).toBe(false);
  });
  it("round-trips base32", () => {
    const buf = Buffer.from("hello world");
    expect(base32Decode(base32Encode(buf)).toString()).toBe("hello world");
  });
  it("makes distinct recovery codes whose hashes do not reveal them", () => {
    const { plain, hashed } = newRecoveryCodes();
    expect(new Set(plain).size).toBe(8);
    expect(hashed.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
  });
});

describe("field encryption", () => {
  it("round-trips and uses a fresh nonce each time", () => {
    const a = encrypt("A1234567"), b = encrypt("A1234567");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("A1234567");
  });
  it("detects tampering", () => {
    const [v, iv, tag, ct] = encrypt("secret").split(":");
    const bad = Buffer.from(ct, "base64");
    bad[0] ^= 1;
    expect(() => decrypt([v, iv, tag, bad.toString("base64")].join(":"))).toThrow();
  });
  it("blind index matches equal values regardless of case and spaces, and differs otherwise", () => {
    expect(blindIndex("AB 123")).toBe(blindIndex("ab123"));
    expect(blindIndex("ab123")).not.toBe(blindIndex("ab124"));
  });
  it("masks all but the last characters", () => {
    expect(mask("29104455")).toBe("••••455");
    expect(mask(null)).toBe("—");
  });
});

describe("phone numbers and money input", () => {
  it("normalises Kenyan formats", () => {
    expect(normalizePhone("0712 345 678")).toBe("+254712345678");
    expect(normalizePhone("712345678")).toBe("+254712345678");
    expect(normalizePhone("+254712345678")).toBe("+254712345678");
    expect(normalizePhone("254712345678")).toBe("+254712345678");
    expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("abc")).toBeNull();
  });
  it("parses amounts to minor units without floats", () => {
    expect(toMinor("4500")).toBe(450000);
    expect(toMinor("4,500.50")).toBe(450050);
    expect(toMinor("0.1")).toBe(10);
    expect(toMinor("12.345")).toBeNull();
    expect(toMinor("abc")).toBeNull();
  });
});

describe("upload checks", () => {
  it("rejects files whose contents do not match the claimed type", async () => {
    const { matchesType, checkUpload } = await import("../src/lib/scan");
    expect(matchesType(Buffer.from("%PDF-1.7 ..."), "application/pdf")).toBe(true);
    expect(matchesType(Buffer.from("MZ\x90\x00 fake exe"), "application/pdf")).toBe(false);
    expect(matchesType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe(true);
    expect(await checkUpload(Buffer.from("MZ\x90\x00"), "application/pdf")).toMatch(/do not match/);
    expect(await checkUpload(Buffer.from("%PDF-1.4"), "application/pdf")).toBeNull();
  });
});

describe("csv export", () => {
  it("neutralises spreadsheet formulas and quotes awkward cells", async () => {
    const { toCsv } = await import("../src/lib/csv");
    const out = toCsv([["name", "note"], ["=HYPERLINK(\"http://evil\")", 'a "b", c'], ["+254712345678", "-5"], [null, new Date("2026-03-04")]]);
    const lines = out.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil"")","a ""b"", c"`);
    expect(lines[2]).toBe("'+254712345678,-5"); // phone numbers are text, plain numbers stay numbers
    expect(lines[3]).toBe(",2026-03-04");
  });
});
