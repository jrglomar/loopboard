// Impediments + PRs store tools — v1.16, ADR-027. Keyless/offline (temp JSON files).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache } from "../src/lib/config.js";
import { getImpedimentsTool } from "../src/tools/getImpediments.js";
import { setImpedimentsTool } from "../src/tools/setImpediments.js";
import { getPullRequestsTool } from "../src/tools/getPullRequests.js";
import { setPullRequestsTool } from "../src/tools/setPullRequests.js";

let dir: string;
let impFile: string;
let prFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopboard-huddle-"));
  impFile = path.join(dir, "imp.json");
  prFile = path.join(dir, "prs.json");
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["JIRA_IMPEDIMENTS_FILE"] = impFile;
  process.env["JIRA_PRS_FILE"] = prFile;
  resetConfigCache();
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("impediments store tools (v1.16)", () => {
  it("get on an empty store returns []", async () => {
    const out = (await getImpedimentsTool.handler({ sprintId: 100 })) as { impediments: unknown[] };
    expect(out.impediments).toEqual([]);
  });

  it("set → get round-trips and fills id + createdAt", async () => {
    const setOut = (await setImpedimentsTool.handler({
      sprintId: 100,
      impediments: [{ text: "Blocked on infra", ticketKey: "DEV-1" }],
    })) as { impediments: Array<{ id: string; text: string; createdAt: string; ticketKey?: string }> };
    expect(setOut.impediments).toHaveLength(1);
    expect(setOut.impediments[0]!.id).toBeTruthy();
    expect(setOut.impediments[0]!.createdAt).toBeTruthy();
    expect(setOut.impediments[0]!.ticketKey).toBe("DEV-1");

    const getOut = (await getImpedimentsTool.handler({ sprintId: 100 })) as { impediments: Array<{ text: string }> };
    expect(getOut.impediments[0]!.text).toBe("Blocked on infra");
  });

  it("is per-sprint (sprint 200 unaffected by sprint 100)", async () => {
    await setImpedimentsTool.handler({ sprintId: 100, impediments: [{ text: "A" }] });
    const other = (await getImpedimentsTool.handler({ sprintId: 200 })) as { impediments: unknown[] };
    expect(other.impediments).toEqual([]);
  });

  it("rejects missing sprintId", async () => {
    await expect(setImpedimentsTool.handler({ impediments: [] })).rejects.toThrow();
  });
});

describe("pull-requests store tools (v1.16)", () => {
  it("set → get round-trips and fills id + addedAt", async () => {
    const setOut = (await setPullRequestsTool.handler({
      sprintId: 100,
      pullRequests: [{ url: "https://github.com/x/y/pull/1", ticketKey: "DEV-1" }],
    })) as { pullRequests: Array<{ id: string; url: string; addedAt: string; ticketKey?: string }> };
    expect(setOut.pullRequests[0]!.id).toBeTruthy();
    expect(setOut.pullRequests[0]!.addedAt).toBeTruthy();
    expect(setOut.pullRequests[0]!.url).toContain("/pull/1");

    const getOut = (await getPullRequestsTool.handler({ sprintId: 100 })) as { pullRequests: Array<{ ticketKey?: string }> };
    expect(getOut.pullRequests[0]!.ticketKey).toBe("DEV-1");
  });

  it("rejects a PR with no url", async () => {
    await expect(
      setPullRequestsTool.handler({ sprintId: 100, pullRequests: [{ title: "x" }] })
    ).rejects.toThrow();
  });
});
