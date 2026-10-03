import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { hash, compare } from "bcryptjs";
import * as OTPAuth from "otpauth";
import { createLogger } from "@/lib/logger";

/**
 * TOTP multi-factor authentication for privileged accounts.
 *
 * The design decisions worth knowing:
 *
 *  1. **The secret is encrypted at rest, not stored raw.** A TOTP secret is a
 *     bearer credential: whoever reads it can mint valid codes forever. A
 *     database dump, a backup, or a read-only replica leak would otherwise hand
 *     over every admin account at once. It is sealed with AES-256-GCM under a
 *     key derived from `MFA_ENCRYPTION_KEY` (falling back to `NEXTAUTH_SECRET`,
 *     which every deployment already has) and bound to the user id via the GCM
 *     AAD, so a ciphertext lifted from one row cannot be replayed onto another.
 *  2. **Backup codes are hashed, never recoverable.** They are bcrypt-hashed and
 *     compared one at a time; consuming one rewrites the array without it.
 *  3. **Verification tolerates one step of clock drift** (±1 × 30s), because a
 *     phone whose clock is a few seconds off must not lock an operator out — but
 *     a code is still single-use within its window by the caller's own state.
 */

const log = createLogger("mfa");

const ISSUER = "ConnectPlus";
const DIGITS = 6;
const PERIOD = 30;
const WINDOW = 1; // ±30s
const BACKUP_CODE_COUNT = 10;

/** Derive a stable 32-byte key. A dedicated env var wins; NEXTAUTH_SECRET is
 *  the documented fallback so MFA works on a deployment that has not added one
 *  yet. A missing both is a configuration error the caller surfaces, not a
 *  silent unencrypted write. */
function encryptionKey(): Buffer | null {
  const raw = (process.env.MFA_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET ?? "").trim();
  if (!raw) return null;
  // sha256 normalises any length to exactly 32 bytes for aes-256.
  return createHash("sha256").update(raw).digest();
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix leaves room
 *  to rotate the scheme without a migration guessing at formats. */
export function encryptSecret(plaintext: string, aad: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("MFA_ENCRYPTION_KEY (or NEXTAUTH_SECRET) is required to store an MFA secret");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(sealed: string, aad: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("MFA_ENCRYPTION_KEY (or NEXTAUTH_SECRET) is required to read an MFA secret");
  const [version, ivB64, tagB64, dataB64] = sealed.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unrecognised MFA secret format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

/** A fresh base32 secret and the otpauth:// URI an authenticator app scans. */
export function generateEnrollment(accountLabel: string): { secret: string; uri: string } {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret,
  });
  return { secret: secret.base32, uri: totp.toString() };
}

/** Verify a submitted 6-digit code against a stored base32 secret. */
export function verifyTotp(base32Secret: string, code: string): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      algorithm: "SHA1",
      digits: DIGITS,
      period: PERIOD,
      secret: OTPAuth.Secret.fromBase32(base32Secret),
    });
    // `window: 1` accepts the previous, current and next step. Returns the
    // delta (possibly 0) or null; null is the only failure.
    return totp.validate({ token: cleaned, window: WINDOW }) !== null;
  } catch (err) {
    log.warn("totp validation threw", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Ten human-transcribable codes (`XXXXX-XXXXX`), shown exactly once. */
export function generateBackupCodes(): string[] {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1
  const codes = new Set<string>();
  while (codes.size < BACKUP_CODE_COUNT) {
    const bytes = randomBytes(10);
    let body = "";
    for (const b of bytes) body += alphabet[b % alphabet.length];
    codes.add(`${body.slice(0, 5)}-${body.slice(5, 10)}`);
  }
  return [...codes];
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => hash(c, 10)));
}

/** Compare a submitted code against the stored hashes. Returns the index that
 *  matched (so the caller can drop it) or -1. */
export async function matchBackupCode(hashes: string[], submitted: string): Promise<number> {
  const cleaned = submitted.trim().toUpperCase();
  if (!cleaned) return -1;
  for (let i = 0; i < hashes.length; i += 1) {
    const stored = hashes[i];
    if (!stored) continue;
    // bcrypt.compare is constant-time per hash; the loop itself leaks only how
    // many codes remain, which the account owner already knows.
    if (await compare(cleaned, stored)) return i;
  }
  return -1;
}
