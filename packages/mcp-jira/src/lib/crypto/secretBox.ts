/**
 * secretBox (v1.44, ADR-054) — AES-256-GCM encryption for connection tokens at rest.
 *
 * The key comes from TOKEN_ENC_KEY (base64, 32 bytes). Plaintext tokens are NEVER logged
 * and only decrypted in-memory, per request, to build a per-user client. Node built-in
 * `crypto` only — no dependency.
 */

import * as crypto from "crypto";
import { getTaskHelperSecrets } from "../config.js";

export interface SealedSecret {
  ciphertext: string; // base64
  iv: string; // base64 (12 bytes)
  tag: string; // base64 (GCM auth tag, 16 bytes)
}

/** Resolve + validate the 32-byte AES key from config. Throws a clear error if malformed. */
function getKey(): Buffer {
  const { encKey } = getTaskHelperSecrets();
  if (encKey === "") {
    throw new Error("TOKEN_ENC_KEY is not set — the Task Helper is disabled");
  }
  const key = Buffer.from(encKey, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENC_KEY must be base64-encoded 32 bytes (AES-256)");
  }
  return key;
}

/** Encrypt a plaintext secret (e.g. an API token). Returns the sealed parts (all base64). */
export function seal(plaintext: string): SealedSecret {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/** Decrypt a sealed secret back to plaintext. Throws if the key/tag don't verify. */
export function open(sealed: SealedSecret): string {
  const key = getKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(sealed.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Last-4 masked hint for a token (safe to surface to the client). */
export function maskHint(token: string): string {
  const last4 = token.slice(-4);
  return `…${last4}`; // e.g. "…aB3d"
}
