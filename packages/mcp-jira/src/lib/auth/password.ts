/**
 * Password hashing (v1.44, ADR-054) — scrypt (Node built-in), salted + timing-safe verify.
 * Stored form: `scrypt$<saltB64>$<hashB64>`. No dependency, no plaintext ever logged.
 */

import * as crypto from "crypto";

const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hash a plaintext password. Returns the self-describing stored string. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Verify a plaintext password against a stored hash. Timing-safe; never throws on bad input. */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const salt = Buffer.from(parts[1]!, "base64");
    const expected = Buffer.from(parts[2]!, "base64");
    const actual = crypto.scryptSync(password, salt, expected.length);
    // Lengths always match here, but guard anyway before timingSafeEqual.
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
