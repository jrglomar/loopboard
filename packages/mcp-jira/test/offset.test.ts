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
import { addOffsetAdjustmentTool } from "../src/tools/addOffsetAdjustment.js";
import { deleteOffsetAdjustmentTool } from "../src/tools/deleteOffsetAdjustment.js";
import type { OffsetSummary } from "../src/lib/offsetStore.js";

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
      adjustments: [], // v1.54: manual-adjustment log (empty here)
    });
    expect(out["Bob"]).toEqual({ earned: 0, spent: 0, manualAdjust: 0, balance: 0, bySprint: {}, adjustments: [] });
  });

  it("folds the manual-adjustment log into the balance, newest-first (v1.54, ADR-065)", () => {
    const file: OffsetFile = {
      Alice: {
        bySprint: { "1": { earned: 1, spent: 0 } },
        manualAdjust: 2,
        adjustments: [
          { id: "a", amount: 3, note: "correction", createdAt: "2026-07-01T00:00:00Z" },
          { id: "b", amount: -1, createdAt: "2026-07-05T00:00:00Z" },
        ],
      },
    };
    const s = summarizeOffset(file)["Alice"]!;
    expect(s.balance).toBe(5); // 1 earned − 0 spent + 2 opening + (3 − 1) adjustments
    expect(s.adjustments.map((a) => a.id)).toEqual(["b", "a"]); // newest (2026-07-05) first
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
    await expect(addOffsetAdjustmentTool.handler({})).rejects.toThrow();
    await expect(deleteOffsetAdjustmentTool.handler({})).rejects.toThrow();
  });
});

describe("offset manual-adjustment log (v1.54, ADR-065)", () => {
  it("add_offset_adjustment appends a dated entry (server-assigned id) and folds into the balance", async () => {
    await setOffsetForSprintTool.handler({ sprintId: 5, entries: [{ assignee: "Alice", earned: 1, spent: 0 }] });
    const out = (await addOffsetAdjustmentTool.handler({ assignee: "Alice", amount: 4, note: "  carry from Q1  " })) as {
      entries: Record<string, OffsetSummary>;
    };
    const alice = out.entries["Alice"]!;
    expect(alice.adjustments).toHaveLength(1);
    expect(alice.adjustments[0]!.amount).toBe(4);
    expect(alice.adjustments[0]!.note).toBe("carry from Q1"); // trimmed
    expect(typeof alice.adjustments[0]!.id).toBe("string");
    expect(alice.balance).toBe(5); // 1 earned + 4 adjustment
  });

  it("add is additive (multiple entries accumulate) and delete removes by id", async () => {
    await addOffsetAdjustmentTool.handler({ assignee: "Bob", amount: 2 });
    const two = (await addOffsetAdjustmentTool.handler({ assignee: "Bob", amount: -1, note: "spent early" })) as {
      entries: Record<string, OffsetSummary>;
    };
    expect(two.entries["Bob"]!.adjustments).toHaveLength(2);
    expect(two.entries["Bob"]!.balance).toBe(1); // 2 − 1

    // Delete the −1 entry → balance returns to 2.
    const minusOne = two.entries["Bob"]!.adjustments.find((a) => a.amount === -1)!;
    const after = (await deleteOffsetAdjustmentTool.handler({ assignee: "Bob", id: minusOne.id })) as {
      entries: Record<string, OffsetSummary>;
    };
    expect(after.entries["Bob"]!.adjustments).toHaveLength(1);
    expect(after.entries["Bob"]!.balance).toBe(2);
  });

  it("add_offset_adjustment rejects a zero amount (400 VALIDATION)", async () => {
    await expect(addOffsetAdjustmentTool.handler({ assignee: "Alice", amount: 0 })).rejects.toThrow();
  });

  it("accepts DECIMAL amounts for opening + adjustments, decimal-safe balance (v1.55, ADR-066)", async () => {
    await setOffsetForSprintTool.handler({ sprintId: 5, entries: [{ assignee: "Alice", earned: 1, spent: 0 }] });
    await setOffsetAdjustmentTool.handler({ assignee: "Alice", manualAdjust: 0.5 }); // decimal opening
    const out = (await addOffsetAdjustmentTool.handler({ assignee: "Alice", amount: 0.25, note: "half credit" })) as {
      entries: Record<string, OffsetSummary>;
    };
    expect(out.entries["Alice"]!.manualAdjust).toBe(0.5);
    expect(out.entries["Alice"]!.adjustments[0]!.amount).toBe(0.25);
    expect(out.entries["Alice"]!.balance).toBe(1.75); // 1 earned + 0.5 opening + 0.25 adjustment
  });

  it("delete is a no-op for an unknown id", async () => {
    await addOffsetAdjustmentTool.handler({ assignee: "Alice", amount: 3 });
    const out = (await deleteOffsetAdjustmentTool.handler({ assignee: "Alice", id: "nope" })) as {
      entries: Record<string, OffsetSummary>;
    };
    expect(out.entries["Alice"]!.adjustments).toHaveLength(1);
    expect(out.entries["Alice"]!.balance).toBe(3);
  });
});
