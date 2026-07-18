/**
 * atomicFile — writeJsonAtomic tests (v1.63, ADR-075). Keyless/offline (temp files only).
 *
 * Covers the shared crash-atomic write helper directly (exact formatting, full overwrite,
 * no leftover .tmp) plus one round-trip through a real store (leavesStore) to prove the
 * swap from a plain fs.writeFileSync is a behavioral no-op on the happy path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The rename-retry tests need to inject transient failures, and vi.spyOn cannot redefine
// properties on the ESM "fs" namespace — so the module is wrapped once here with a
// passthrough default (every other test in this file exercises the REAL rename).
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeJsonAtomic } from "../src/lib/atomicFile.js";

function errnoError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}
import { resetConfigCache } from "../src/lib/config.js";
import { writeLeaves, readLeaves } from "../src/lib/leavesStore.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "invokeboard-atomicfile-"));
});

afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("writeJsonAtomic", () => {
  it("writes parseable JSON with the exact JSON.stringify(data, null, 2) formatting", () => {
    const file = path.join(dir, "out.json");
    const data = { b: 2, a: [1, 2, 3], nested: { x: "y" } };

    writeJsonAtomic(file, data);

    const raw = fs.readFileSync(file, "utf8");
    expect(raw).toBe(JSON.stringify(data, null, 2));
    expect(JSON.parse(raw)).toEqual(data);
  });

  it("overwrites an existing file's content completely", () => {
    const file = path.join(dir, "out.json");
    const stale = { old: "a much longer previous payload that should not survive", extra: [1, 2, 3, 4, 5] };
    fs.writeFileSync(file, JSON.stringify(stale, null, 2), "utf8");

    const next = { fresh: true };
    writeJsonAtomic(file, next);

    const raw = fs.readFileSync(file, "utf8");
    expect(raw).toBe(JSON.stringify(next, null, 2));
    expect(raw).not.toContain("old");
    expect(raw).not.toContain("extra");
  });

  it("leaves no .tmp file behind after a successful write", () => {
    const file = path.join(dir, "out.json");

    writeJsonAtomic(file, { ok: true });

    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual(["out.json"]);
  });

  it("retries a transient EPERM rename (Windows AV lock) and still lands the write", () => {
    // On Windows a scanner can hold a just-created file for a few ms → renameSync throws
    // a transient EPERM. The helper retries; the queued Once-failures are fully consumed,
    // so the wrapped default (the REAL rename) lands the 3rd attempt.
    const file = path.join(dir, "out.json");
    const renameMock = vi.mocked(fs.renameSync);
    renameMock.mockClear();
    renameMock
      .mockImplementationOnce(() => {
        throw errnoError("EPERM", "EPERM: operation not permitted");
      })
      .mockImplementationOnce(() => {
        throw errnoError("EPERM", "EPERM: operation not permitted");
      });

    writeJsonAtomic(file, { survived: true });

    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ survived: true });
    expect(renameMock).toHaveBeenCalledTimes(3); // 2 transient failures + 1 success
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it("does NOT retry non-transient rename errors (e.g. ENOENT propagates immediately)", () => {
    const file = path.join(dir, "out.json");
    const renameMock = vi.mocked(fs.renameSync);
    renameMock.mockClear();
    renameMock.mockImplementationOnce(() => {
      throw errnoError("ENOENT", "ENOENT: no such file or directory");
    });

    expect(() => writeJsonAtomic(file, { x: 1 })).toThrow(/ENOENT/);
    expect(renameMock).toHaveBeenCalledTimes(1); // no retry loop for foreign errors
  });
});

describe("writeJsonAtomic — leavesStore round-trip (v1.63 no-op on the happy path)", () => {
  // Mirrors how v15.test.ts provisions a per-test temp leaves file: point JIRA_LEAVES_FILE
  // at a unique path and resetConfigCache() so leavesStore picks it up.
  const originalEnv = { ...process.env };
  let tempLeavesFile: string;

  beforeEach(() => {
    process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
    process.env["JIRA_EMAIL"] = "test@example.com";
    process.env["JIRA_API_TOKEN"] = "test-token";
    process.env["JIRA_PO_BOARD_ID"] = "10001";
    process.env["JIRA_DEV_BOARD_ID"] = "10002";
    tempLeavesFile = path.join(dir, "leaves.json");
    process.env["JIRA_LEAVES_FILE"] = tempLeavesFile;
    resetConfigCache();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    resetConfigCache();
  });

  it("save -> read round-trips through the real store, with no leftover .tmp", () => {
    writeLeaves({ "100": { Alice: { "2026-07-18": "VL" } } });

    const result = readLeaves();
    expect(result).toEqual({ "100": { Alice: { "2026-07-18": "VL" } } });
    expect(fs.existsSync(`${tempLeavesFile}.tmp`)).toBe(false);
  });

  it("a second write fully replaces the first (overwrite, not merge)", () => {
    writeLeaves({ "100": { Alice: { "2026-07-18": "VL" } } });
    writeLeaves({ "200": { Bob: { "2026-07-19": "EL" } } });

    const result = readLeaves();
    expect(result).toEqual({ "200": { Bob: { "2026-07-19": "EL" } } });
  });
});
