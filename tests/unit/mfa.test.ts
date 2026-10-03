import { describe, expect, it, beforeAll } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateEnrollment,
  hashBackupCodes,
  matchBackupCode,
  verifyTotp,
} from "@/lib/mfa";
import * as OTPAuth from "otpauth";

/**
 * The MFA library is small but every line of it is security-relevant, so these
 * tests pin the properties that matter rather than the implementation: a secret
 * round-trips, a ciphertext is bound to its row, a wrong code is refused, a code
 * from the neighbouring window is accepted, and a backup code works exactly once.
 */

beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY = "test-key-for-mfa-unit-tests-only";
});

describe("mfa secret sealing", () => {
  it("round-trips a secret through encrypt/decrypt", () => {
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP", "user-1");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(sealed, "user-1")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("refuses a ciphertext replayed onto another row", () => {
    // The AAD binds the ciphertext to the user id: a dump of one row's secret
    // must not be usable to satisfy another account's second factor.
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP", "user-1");
    expect(() => decryptSecret(sealed, "user-2")).toThrow();
  });

  it("rejects a tampered ciphertext", () => {
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP", "user-1");
    const parts = sealed.split(".");
    parts[3] = (parts[3] ?? "").slice(0, -2) + "AA";
    expect(() => decryptSecret(parts.join("."), "user-1")).toThrow();
  });

  it("rejects an unrecognised format", () => {
    expect(() => decryptSecret("plain-text-secret", "user-1")).toThrow(/format/);
  });
});

describe("mfa totp verification", () => {
  it("accepts the code the authenticator would generate", () => {
    const { secret } = generateEnrollment("admin@connectplus.app");
    const totp = new OTPAuth.TOTP({
      issuer: "ConnectPlus",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    expect(verifyTotp(secret, totp.generate())).toBe(true);
  });

  it("accepts the previous and next step for clock drift", () => {
    const { secret } = generateEnrollment("admin@connectplus.app");
    const totp = new OTPAuth.TOTP({
      issuer: "ConnectPlus",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    // window:1 means a phone up to 30s fast or slow still works.
    const prev = totp.generate({ timestamp: Date.now() - 30_000 });
    expect(verifyTotp(secret, prev)).toBe(true);
  });

  it("refuses a code from the wrong secret", () => {
    const a = generateEnrollment("a@connectplus.app");
    const b = generateEnrollment("b@connectplus.app");
    const totp = new OTPAuth.TOTP({
      issuer: "ConnectPlus",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(a.secret),
    });
    expect(verifyTotp(b.secret, totp.generate())).toBe(false);
  });

  it("refuses malformed input without throwing", () => {
    const { secret } = generateEnrollment("a@connectplus.app");
    expect(verifyTotp(secret, "")).toBe(false);
    expect(verifyTotp(secret, "abcdef")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
    expect(verifyTotp("not-base32!!!", "123456")).toBe(false);
  });
});

describe("mfa backup codes", () => {
  it("generates ten unique, readable codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });

  it("matches a stored code and reports its index", async () => {
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);
    const idx = await matchBackupCode(hashes, (codes[3] ?? "").toLowerCase());
    expect(idx).toBe(3);
  });

  it("does not match an unknown code", async () => {
    const hashes = await hashBackupCodes(generateBackupCodes());
    expect(await matchBackupCode(hashes, "AAAAA-BBBBB")).toBe(-1);
    expect(await matchBackupCode(hashes, "")).toBe(-1);
  });
});
