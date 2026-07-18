// Task Helper crypto/auth primitives — v1.44, ADR-054. Keyless/offline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetConfigCache } from "../src/lib/config.js";
import { seal, open, maskHint } from "../src/lib/crypto/secretBox.js";
import { hashPassword, verifyPassword } from "../src/lib/auth/password.js";
import { issueSession, verifySession } from "../src/lib/auth/session.js";
import { readCookie } from "../src/lib/auth/middleware.js";
import type { Request } from "express";

const ENC_KEY = Buffer.alloc(32, 7).toString("base64"); // valid 32-byte AES key

beforeEach(() => {
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "1";
  process.env["JIRA_DEV_BOARD_ID"] = "2";
  process.env["TOKEN_ENC_KEY"] = ENC_KEY;
  process.env["SESSION_SECRET"] = "super-secret-hmac-key";
  resetConfigCache();
});

afterEach(() => {
  delete process.env["TOKEN_ENC_KEY"];
  delete process.env["SESSION_SECRET"];
  resetConfigCache();
});

describe("secretBox (AES-256-GCM)", () => {
  it("seals and opens back to the original plaintext", () => {
    const sealed = seal("my-jira-api-token-abcd");
    expect(sealed.ciphertext).not.toContain("my-jira"); // ciphertext isn't the plaintext
    expect(open(sealed)).toBe("my-jira-api-token-abcd");
  });

  it("uses a random IV — two seals of the same value differ", () => {
    expect(seal("x").ciphertext).not.toBe(seal("x").ciphertext);
  });

  it("fails to open a tampered ciphertext", () => {
    const sealed = seal("secret");
    const tampered = { ...sealed, ciphertext: Buffer.from("zzzz").toString("base64") };
    expect(() => open(tampered)).toThrow();
  });

  it("fails when the key is the wrong length", () => {
    process.env["TOKEN_ENC_KEY"] = Buffer.alloc(16, 1).toString("base64"); // 16 bytes, not 32
    resetConfigCache();
    expect(() => seal("x")).toThrow(/32 bytes/);
  });

  it("masks a token to its last 4", () => {
    expect(maskHint("abcd1234wxyz")).toBe("…wxyz");
  });
});

describe("password (scrypt)", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects a malformed stored hash without throwing", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("session (HMAC token)", () => {
  it("issues a token that verifies back to the user id", () => {
    const token = issueSession("user-123");
    expect(verifySession(token)).toBe("user-123");
  });

  it("rejects a tampered token", () => {
    const token = issueSession("user-123");
    expect(verifySession(token.slice(0, -2) + "xy")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = issueSession("user-123", -1000); // already expired
    expect(verifySession(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = issueSession("user-123");
    process.env["SESSION_SECRET"] = "a-totally-different-secret";
    resetConfigCache();
    expect(verifySession(token)).toBeNull();
  });

  it("rejects undefined / empty", () => {
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession("")).toBeNull();
  });
});

describe("readCookie", () => {
  it("extracts a named cookie from the Cookie header", () => {
    const req = { headers: { cookie: "foo=1; ib_session=abc.def; bar=2" } } as unknown as Request;
    expect(readCookie(req, "ib_session")).toBe("abc.def");
    expect(readCookie(req, "missing")).toBeUndefined();
  });

  it("returns undefined when there is no Cookie header", () => {
    const req = { headers: {} } as unknown as Request;
    expect(readCookie(req, "ib_session")).toBeUndefined();
  });
});
