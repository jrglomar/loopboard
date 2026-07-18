/**
 * Session tokens (v1.44, ADR-054) — a compact, HMAC-signed, expiring token carried in an
 * httpOnly cookie. Format: `<payloadB64url>.<hmacB64url>` where payload = { uid, exp }.
 * Signed with SESSION_SECRET (from config). Node built-in `crypto` only.
 */

import * as crypto from "crypto";
import { getTaskHelperSecrets } from "../config.js";

export const SESSION_COOKIE = "ib_session";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionPayload {
  uid: string;
  exp: number; // epoch ms
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function secret(): string {
  const { sessionSecret } = getTaskHelperSecrets();
  if (sessionSecret === "") throw new Error("SESSION_SECRET is not set — the Task Helper is disabled");
  return sessionSecret;
}

function sign(payloadB64: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(payloadB64).digest());
}

/** Create a signed session token for a user id, expiring in `ttlMs`. */
export function issueSession(uid: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const payload: SessionPayload = { uid, exp: Date.now() + ttlMs };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verify a token; returns the user id when valid + unexpired, else null. Never throws. */
export function verifySession(token: string | undefined): string | null {
  try {
    if (!token) return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = sign(payloadB64);
    const a = fromB64url(sig);
    const b = fromB64url(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(fromB64url(payloadB64).toString("utf8")) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
