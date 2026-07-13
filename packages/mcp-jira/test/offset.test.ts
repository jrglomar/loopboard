// Offset-ledger store + tools — v1.26, ADR-038. Keyless/offline (temp JSON file).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache } from "../src/lib/config.js";
import { summarizeOffset, type OffsetFile } from "../src/lib/offsetStore.js";
import { getOffsetLedgerTool } from "../src/tools/getOffsetLedger.js";
import { setOffsetForSprintTool } from "../src/tools/setOffsetForSprint.js";
import { setOffsetAdjustmentTool } from "../src/tools/setOffsetAdjustment.js";

let dir: string;
let offsetFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopboard-offset-"));
  offsetFile = path.join(dir, "offset.json");
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["JIRA_OFFSET_FILE"] = offsetFile;
  resetConfigCache();
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("summarizeOffset (pure)", () => {
  it("computes earned/spent/manualAdjust/balance per assignee", () => {
    const file: OffsetFile = {
      Alice: { bySprint: { "1": { earned: 1, spent: 0 }, "2": { earned: 1, spent: 1 } }, manualAdjust: 2 },
      Bob: { bySprint: {}, manualAdjust: 0 },
    };
    const out = summarizeOffset(file);
    expect(out["Alice"]).toEqual({
      earned: 2, spent: 1, manualAdjust: 2, balance: 3, // 2−1+2
      bySprint: { "1": { earned: 1, spent: 0 }, "2": { earned: 1, spent: 1 } }, // v1.50: per-sprint banked state
    });
    expect(out["Bob"]).toEqual({ earned: 0, spent: 0, manualAdjust: 0, balance: 0, bySprint: {} });
  });
});

describe("offset tools (v1.26)", () => {
  it("set_offset_for_sprint upserts a sprint snapshot and is idempotent", async () => {
    await setOffsetForSprintTool.handler({ sprintId: 5, entries: [{ assignee: "Alice", earned: 1, spent: 0 }] });
    // Re-record the SAME sprint with different numbers — must replace, not add.
    const out = (await setOffsetForSprintTool.handler({
      sprintId: 5,
      entries: [{ assignee: "Alice", earned: 1, spent: 1 }],
    })) as { entries: Record<string, { earned: number; spent: number; balance: number }> };
    expect(out.entries["Alice"]!.earned).toBe(1);
    expect(out.entries["Alice"]!.spent).toBe(1);
    expect(out.entries["Alice"]!.balance).toBe(0);
  });

  it("accumulates earned across different sprints", async () => {
    await setOffsetForSprintTool.handler({ sprintId: 5, entries: [{ assignee: "Alice", earned: 1, spent: 0 }] });
    await setOffsetForSprintTool.handler({ sprintId: 6, entries: [{ assignee: "Alice", earned: 1, spent: 0 }] });
    const out = (await getOffsetLedgerTool.handler({})) as { entries: Record<string, { balance: number }> };
    expect(out.entries["Alice"]!.balance).toBe(2);
  });

  it("set_offset_adjustment sets the manual delta and folds into the balance", async () => {
    await setOffsetForSprintTool.handler({ sprintId: 5, entries: [{ assignee: "Alice", earned: 1, spent: 0 }] });
    const out = (await setOffsetAdjustmentTool.handler({ assignee: "Alice", manualAdjust: -1 })) as {
      entries: Record<string, { manualAdjust: number; balance: number }>;
    };
    expect(out.entries["Alice"]!.manualAdjust).toBe(-1);
    expect(out.entries["Alice"]!.balance).toBe(0); // 1 earned − 1 manual
  });

  it("rejects empty input on the write tools", async () => {
    await expect(setOffsetForSprintTool.handler({})).rejects.toThrow();
    await expect(setOffsetAdjustmentTool.handler({})).rejects.toThrow();
  });
});
