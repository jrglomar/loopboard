// Draft-plan store tools — v1.68, ADR-079. Keyless/offline (temp JSON file).
// DRAFT ONLY: get_draft_plan/set_draft_plan never call Jira.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache } from "../src/lib/config.js";
import { getDraftPlanTool } from "../src/tools/getDraftPlan.js";
import { setDraftPlanTool } from "../src/tools/setDraftPlan.js";

let dir: string;
let draftPlanFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "invokeboard-draftplan-"));
  draftPlanFile = path.join(dir, "draft-plan.json");
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["JIRA_DRAFT_PLAN_FILE"] = draftPlanFile;
  resetConfigCache();
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

interface DraftPlanOutput {
  sprintId: number;
  devSprintId: number | null;
  assignments: Record<string, { accountId: string; displayName: string }>;
}

describe("get_draft_plan (v1.68)", () => {
  it("returns the empty-but-valid shape when no draft is saved for the sprint", async () => {
    const out = (await getDraftPlanTool.handler({ sprintId: 500 })) as DraftPlanOutput;
    expect(out).toEqual({ sprintId: 500, devSprintId: null, assignments: {} });
  });

  it("rejects missing sprintId", async () => {
    await expect(getDraftPlanTool.handler({})).rejects.toThrow();
  });
});

describe("set_draft_plan → get_draft_plan round-trip (v1.68)", () => {
  it("set then get returns the same plan", async () => {
    const setOut = (await setDraftPlanTool.handler({
      sprintId: 500,
      devSprintId: 700,
      assignments: {
        "DEV-1": { accountId: "acc-1", displayName: "Alice" },
        "DEV-2": { accountId: "acc-2", displayName: "Bob" },
      },
    })) as DraftPlanOutput;

    expect(setOut.sprintId).toBe(500);
    expect(setOut.devSprintId).toBe(700);
    expect(setOut.assignments["DEV-1"]).toEqual({ accountId: "acc-1", displayName: "Alice" });
    expect(setOut.assignments["DEV-2"]).toEqual({ accountId: "acc-2", displayName: "Bob" });

    const getOut = (await getDraftPlanTool.handler({ sprintId: 500 })) as DraftPlanOutput;
    expect(getOut).toEqual(setOut);
  });

  it("devSprintId persists when provided, and defaults to null when omitted", async () => {
    const withDev = (await setDraftPlanTool.handler({
      sprintId: 501,
      devSprintId: 42,
      assignments: {},
    })) as DraftPlanOutput;
    // Non-empty devSprintId with empty assignments is NOT the delete case — it persists.
    expect(withDev.devSprintId).toBe(42);
    const reread = (await getDraftPlanTool.handler({ sprintId: 501 })) as DraftPlanOutput;
    expect(reread.devSprintId).toBe(42);

    const withoutDev = (await setDraftPlanTool.handler({
      sprintId: 502,
      assignments: { "DEV-3": { accountId: "acc-3", displayName: "Carl" } },
    })) as DraftPlanOutput;
    expect(withoutDev.devSprintId).toBeNull();
  });

  it("is per-sprint (sprint 900 unaffected by sprint 501)", async () => {
    await setDraftPlanTool.handler({
      sprintId: 501,
      assignments: { "DEV-3": { accountId: "acc-3", displayName: "Carl" } },
    });
    const other = (await getDraftPlanTool.handler({ sprintId: 900 })) as DraftPlanOutput;
    expect(other.assignments).toEqual({});
    expect(other.devSprintId).toBeNull();
  });

  it("full-replace: a second set REPLACES the first, not merges", async () => {
    await setDraftPlanTool.handler({
      sprintId: 503,
      assignments: {
        "DEV-1": { accountId: "acc-1", displayName: "Alice" },
        "DEV-2": { accountId: "acc-2", displayName: "Bob" },
      },
    });

    const second = (await setDraftPlanTool.handler({
      sprintId: 503,
      devSprintId: 900,
      assignments: { "DEV-9": { accountId: "acc-9", displayName: "Zoe" } },
    })) as DraftPlanOutput;

    expect(Object.keys(second.assignments)).toEqual(["DEV-9"]);

    const getOut = (await getDraftPlanTool.handler({ sprintId: 503 })) as DraftPlanOutput;
    expect(Object.keys(getOut.assignments)).toEqual(["DEV-9"]);
    expect(getOut.devSprintId).toBe(900);
  });

  it("empty assignments with devSprintId null/omitted DELETES the sprint's stored entry", async () => {
    await setDraftPlanTool.handler({
      sprintId: 504,
      devSprintId: 111,
      assignments: { "DEV-1": { accountId: "acc-1", displayName: "Alice" } },
    });

    const cleared = (await setDraftPlanTool.handler({
      sprintId: 504,
      assignments: {},
    })) as DraftPlanOutput;
    expect(cleared).toEqual({ sprintId: 504, devSprintId: null, assignments: {} });

    // The raw store file no longer carries a "504" key at all (not just an empty entry).
    const raw = JSON.parse(fs.readFileSync(draftPlanFile, "utf8")) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(raw, "504")).toBe(false);

    const getOut = (await getDraftPlanTool.handler({ sprintId: 504 })) as DraftPlanOutput;
    expect(getOut).toEqual({ sprintId: 504, devSprintId: null, assignments: {} });
  });

  it("empty assignments with devSprintId explicitly null also deletes the entry", async () => {
    await setDraftPlanTool.handler({
      sprintId: 508,
      devSprintId: 222,
      assignments: { "DEV-1": { accountId: "acc-1", displayName: "Alice" } },
    });
    await setDraftPlanTool.handler({ sprintId: 508, devSprintId: null, assignments: {} });

    const raw = JSON.parse(fs.readFileSync(draftPlanFile, "utf8")) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(raw, "508")).toBe(false);
  });
});

describe("set_draft_plan validation (v1.68)", () => {
  it("rejects missing sprintId", async () => {
    await expect(setDraftPlanTool.handler({ assignments: {} })).rejects.toThrow();
  });

  it("rejects an assignments key that does not match the ticketKey format", async () => {
    await expect(
      setDraftPlanTool.handler({
        sprintId: 505,
        assignments: { "dev-1": { accountId: "acc-1", displayName: "Alice" } },
      })
    ).rejects.toThrow();
  });

  it("rejects an assignment entry with an empty accountId or displayName", async () => {
    await expect(
      setDraftPlanTool.handler({
        sprintId: 505,
        assignments: { "DEV-1": { accountId: "", displayName: "Alice" } },
      })
    ).rejects.toThrow();

    await expect(
      setDraftPlanTool.handler({
        sprintId: 505,
        assignments: { "DEV-1": { accountId: "acc-1", displayName: "" } },
      })
    ).rejects.toThrow();
  });

  it("rejects more than 300 assignment entries", async () => {
    const assignments: Record<string, { accountId: string; displayName: string }> = {};
    for (let i = 0; i < 301; i++) {
      assignments[`DEV-${i}`] = { accountId: `acc-${i}`, displayName: `Person ${i}` };
    }
    await expect(
      setDraftPlanTool.handler({ sprintId: 506, assignments })
    ).rejects.toThrow();
  });

  it("accepts exactly 300 assignment entries", async () => {
    const assignments: Record<string, { accountId: string; displayName: string }> = {};
    for (let i = 0; i < 300; i++) {
      assignments[`DEV-${i}`] = { accountId: `acc-${i}`, displayName: `Person ${i}` };
    }
    const out = (await setDraftPlanTool.handler({ sprintId: 507, assignments })) as DraftPlanOutput;
    expect(Object.keys(out.assignments)).toHaveLength(300);
  });
});

describe("draft-plan store — missing/corrupt file tolerance (v1.68)", () => {
  it("get_draft_plan returns the empty shape when the file does not exist", async () => {
    const out = (await getDraftPlanTool.handler({ sprintId: 999 })) as DraftPlanOutput;
    expect(out.assignments).toEqual({});
    expect(out.devSprintId).toBeNull();
  });

  it("get_draft_plan tolerates a corrupt JSON file — returns the empty shape, never throws", async () => {
    fs.writeFileSync(draftPlanFile, "not valid json {{{", "utf8");
    const out = (await getDraftPlanTool.handler({ sprintId: 999 })) as DraftPlanOutput;
    expect(out).toEqual({ sprintId: 999, devSprintId: null, assignments: {} });
  });

  it("get_draft_plan tolerates a JSON array at the top level (treats as {})", async () => {
    fs.writeFileSync(draftPlanFile, JSON.stringify([1, 2, 3]), "utf8");
    const out = (await getDraftPlanTool.handler({ sprintId: 999 })) as DraftPlanOutput;
    expect(out).toEqual({ sprintId: 999, devSprintId: null, assignments: {} });
  });
});

describe("get_draft_plan / set_draft_plan are registered in tools/index.ts (v1.68)", () => {
  it("both tools are registered", async () => {
    const { tools } = await import("../src/tools/index.js");
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_draft_plan");
    expect(names).toContain("set_draft_plan");
  });
});
