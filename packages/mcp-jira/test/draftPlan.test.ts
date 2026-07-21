// Draft-plan store tools — v1.68, ADR-079; multi-developer point split v1.70, ADR-081.
// Keyless/offline (temp JSON file).
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

interface DraftShareOut {
  accountId: string;
  displayName: string;
  points: number;
}

interface DraftPlanOutput {
  sprintId: number;
  devSprintId: number | null;
  assignments: Record<string, DraftShareOut[]>;
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
        "DEV-1": [{ accountId: "acc-1", displayName: "Alice", points: 5 }],
        "DEV-2": [{ accountId: "acc-2", displayName: "Bob", points: 3 }],
      },
    })) as DraftPlanOutput;

    expect(setOut.sprintId).toBe(500);
    expect(setOut.devSprintId).toBe(700);
    expect(setOut.assignments["DEV-1"]).toEqual([{ accountId: "acc-1", displayName: "Alice", points: 5 }]);
    expect(setOut.assignments["DEV-2"]).toEqual([{ accountId: "acc-2", displayName: "Bob", points: 3 }]);

    const getOut = (await getDraftPlanTool.handler({ sprintId: 500 })) as DraftPlanOutput;
    expect(getOut).toEqual(setOut);
  });

  it("supports a ticket split across multiple developer shares, each with its own draft points", async () => {
    const setOut = (await setDraftPlanTool.handler({
      sprintId: 511,
      devSprintId: 700,
      assignments: {
        "DEV-1": [
          { accountId: "acc-1", displayName: "Alice", points: 3 },
          { accountId: "acc-2", displayName: "Bob", points: 2 },
          { accountId: "acc-3", displayName: "Carl", points: 1 },
        ],
      },
    })) as DraftPlanOutput;

    expect(setOut.assignments["DEV-1"]).toEqual([
      { accountId: "acc-1", displayName: "Alice", points: 3 },
      { accountId: "acc-2", displayName: "Bob", points: 2 },
      { accountId: "acc-3", displayName: "Carl", points: 1 },
    ]);

    const getOut = (await getDraftPlanTool.handler({ sprintId: 511 })) as DraftPlanOutput;
    expect(getOut).toEqual(setOut);
  });

  it("de-dupes a ticket's shares by accountId — a developer appears once, last write wins", async () => {
    const setOut = (await setDraftPlanTool.handler({
      sprintId: 512,
      assignments: {
        "DEV-1": [
          { accountId: "acc-1", displayName: "Alice (stale)", points: 8 },
          { accountId: "acc-2", displayName: "Bob", points: 2 },
          { accountId: "acc-1", displayName: "Alice", points: 5 },
        ],
      },
    })) as DraftPlanOutput;

    expect(setOut.assignments["DEV-1"]).toHaveLength(2);
    expect(setOut.assignments["DEV-1"]).toContainEqual({ accountId: "acc-1", displayName: "Alice", points: 5 });
    expect(setOut.assignments["DEV-1"]).toContainEqual({ accountId: "acc-2", displayName: "Bob", points: 2 });
    // The stale duplicate is gone entirely.
    expect(setOut.assignments["DEV-1"]).not.toContainEqual(
      expect.objectContaining({ displayName: "Alice (stale)" })
    );

    const getOut = (await getDraftPlanTool.handler({ sprintId: 512 })) as DraftPlanOutput;
    expect(getOut.assignments["DEV-1"]).toHaveLength(2);
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
      assignments: { "DEV-3": [{ accountId: "acc-3", displayName: "Carl", points: 2 }] },
    })) as DraftPlanOutput;
    expect(withoutDev.devSprintId).toBeNull();
  });

  it("is per-sprint (sprint 900 unaffected by sprint 501)", async () => {
    await setDraftPlanTool.handler({
      sprintId: 501,
      assignments: { "DEV-3": [{ accountId: "acc-3", displayName: "Carl", points: 2 }] },
    });
    const other = (await getDraftPlanTool.handler({ sprintId: 900 })) as DraftPlanOutput;
    expect(other.assignments).toEqual({});
    expect(other.devSprintId).toBeNull();
  });

  it("full-replace: a second set REPLACES the first, not merges", async () => {
    await setDraftPlanTool.handler({
      sprintId: 503,
      assignments: {
        "DEV-1": [{ accountId: "acc-1", displayName: "Alice", points: 3 }],
        "DEV-2": [{ accountId: "acc-2", displayName: "Bob", points: 5 }],
      },
    });

    const second = (await setDraftPlanTool.handler({
      sprintId: 503,
      devSprintId: 900,
      assignments: { "DEV-9": [{ accountId: "acc-9", displayName: "Zoe", points: 1 }] },
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
      assignments: { "DEV-1": [{ accountId: "acc-1", displayName: "Alice", points: 4 }] },
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
      assignments: { "DEV-1": [{ accountId: "acc-1", displayName: "Alice", points: 4 }] },
    });
    await setDraftPlanTool.handler({ sprintId: 508, devSprintId: null, assignments: {} });

    const raw = JSON.parse(fs.readFileSync(draftPlanFile, "utf8")) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(raw, "508")).toBe(false);
  });
});

describe("set_draft_plan validation (v1.68; points + share-array bounds v1.70)", () => {
  it("rejects missing sprintId", async () => {
    await expect(setDraftPlanTool.handler({ assignments: {} })).rejects.toThrow();
  });

  it("rejects an assignments key that does not match the ticketKey format", async () => {
    await expect(
      setDraftPlanTool.handler({
        sprintId: 505,
        assignments: { "dev-1": [{ accountId: "acc-1", displayName: "Alice", points: 1 }] },
      })
    ).rejects.toThrow();
  });

  it("rejects a share with an empty accountId or displayName", async () => {
    await expect(
      setDraftPlanTool.handler({
        sprintId: 505,
        assignments: { "DEV-1": [{ accountId: "", displayName: "Alice", points: 1 }] },
      })
    ).rejects.toThrow();

    await expect(
      setDraftPlanTool.handler({
        sprintId: 505,
        assignments: { "DEV-1": [{ accountId: "acc-1", displayName: "", points: 1 }] },
      })
    ).rejects.toThrow();
  });

  it("rejects a share with negative points", async () => {
    await expect(
      setDraftPlanTool.handler({
        sprintId: 505,
        assignments: { "DEV-1": [{ accountId: "acc-1", displayName: "Alice", points: -1 }] },
      })
    ).rejects.toThrow();
  });

  it("accepts zero points on a share (an unpointed/unsized draft slice)", async () => {
    const out = (await setDraftPlanTool.handler({
      sprintId: 509,
      assignments: { "DEV-1": [{ accountId: "acc-1", displayName: "Alice", points: 0 }] },
    })) as DraftPlanOutput;
    expect(out.assignments["DEV-1"]).toEqual([{ accountId: "acc-1", displayName: "Alice", points: 0 }]);
  });

  it("rejects an empty share array for a key (omit the key instead)", async () => {
    await expect(
      setDraftPlanTool.handler({
        sprintId: 505,
        assignments: { "DEV-1": [] },
      })
    ).rejects.toThrow();
  });

  it("rejects more than 50 shares on a single ticket", async () => {
    const shares = [];
    for (let i = 0; i < 51; i++) {
      shares.push({ accountId: `acc-${i}`, displayName: `Person ${i}`, points: 1 });
    }
    await expect(
      setDraftPlanTool.handler({ sprintId: 513, assignments: { "DEV-1": shares } })
    ).rejects.toThrow();
  });

  it("accepts exactly 50 shares on a single ticket", async () => {
    const shares = [];
    for (let i = 0; i < 50; i++) {
      shares.push({ accountId: `acc-${i}`, displayName: `Person ${i}`, points: 1 });
    }
    const out = (await setDraftPlanTool.handler({
      sprintId: 514,
      assignments: { "DEV-1": shares },
    })) as DraftPlanOutput;
    expect(out.assignments["DEV-1"]).toHaveLength(50);
  });

  it("rejects more than 300 assignment entries", async () => {
    const assignments: Record<string, Array<{ accountId: string; displayName: string; points: number }>> = {};
    for (let i = 0; i < 301; i++) {
      assignments[`DEV-${i}`] = [{ accountId: `acc-${i}`, displayName: `Person ${i}`, points: 1 }];
    }
    await expect(
      setDraftPlanTool.handler({ sprintId: 506, assignments })
    ).rejects.toThrow();
  });

  it("accepts exactly 300 assignment entries", async () => {
    const assignments: Record<string, Array<{ accountId: string; displayName: string; points: number }>> = {};
    for (let i = 0; i < 300; i++) {
      assignments[`DEV-${i}`] = [{ accountId: `acc-${i}`, displayName: `Person ${i}`, points: 1 }];
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

describe("legacy migration — pre-v1.70 single-object assignment normalizes to DraftShare[] (v1.70, ADR-081)", () => {
  it("wraps a legacy {accountId,displayName} value to a one-element array with points:0", async () => {
    // Write the OLD (v1.68/v1.69) shape directly to the temp store file, bypassing
    // setDraftPlanTool (which only ever writes the current shape).
    const legacyDoc = {
      "600": {
        devSprintId: 42,
        assignments: {
          "DEV-9": { accountId: "acc-9", displayName: "Zoe" },
        },
      },
    };
    fs.writeFileSync(draftPlanFile, JSON.stringify(legacyDoc), "utf8");

    const out = (await getDraftPlanTool.handler({ sprintId: 600 })) as DraftPlanOutput;
    expect(out.devSprintId).toBe(42);
    expect(out.assignments).toEqual({
      "DEV-9": [{ accountId: "acc-9", displayName: "Zoe", points: 0 }],
    });
  });

  it("passes an already-migrated array value through untouched, and drops a garbage value", async () => {
    const mixedDoc = {
      "601": {
        devSprintId: null,
        assignments: {
          "DEV-1": { accountId: "acc-1", displayName: "Alice" }, // legacy single object
          "DEV-2": [{ accountId: "acc-2", displayName: "Bob", points: 4 }], // already an array
          "DEV-3": "garbage", // neither array nor object — dropped
        },
      },
    };
    fs.writeFileSync(draftPlanFile, JSON.stringify(mixedDoc), "utf8");

    const out = (await getDraftPlanTool.handler({ sprintId: 601 })) as DraftPlanOutput;
    expect(out.assignments["DEV-1"]).toEqual([{ accountId: "acc-1", displayName: "Alice", points: 0 }]);
    expect(out.assignments["DEV-2"]).toEqual([{ accountId: "acc-2", displayName: "Bob", points: 4 }]);
    expect(out.assignments["DEV-3"]).toBeUndefined();
  });

  it("a legacy write is only ever read back once migrated — a fresh set_draft_plan re-save stores the current array shape", async () => {
    fs.writeFileSync(
      draftPlanFile,
      JSON.stringify({
        "602": { devSprintId: null, assignments: { "DEV-9": { accountId: "acc-9", displayName: "Zoe" } } },
      }),
      "utf8"
    );

    // Re-save via set_draft_plan (as the UI would after loading + editing a migrated draft).
    await setDraftPlanTool.handler({
      sprintId: 602,
      assignments: { "DEV-9": [{ accountId: "acc-9", displayName: "Zoe", points: 3 }] },
    });

    const raw = JSON.parse(fs.readFileSync(draftPlanFile, "utf8")) as Record<
      string,
      { assignments: Record<string, unknown> }
    >;
    expect(raw["602"]?.assignments["DEV-9"]).toEqual([{ accountId: "acc-9", displayName: "Zoe", points: 3 }]);
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
