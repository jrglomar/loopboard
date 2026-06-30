// leaveStatus.ts unit tests — v1.31, ADR-043. Pure; keyless/offline.

import { describe, it, expect } from "vitest";
import { summarizeLeaveStatus } from "./leaveStatus";
import type { AllLeavesMap } from "./leavesClient";

const STORE: AllLeavesMap = {
  "1": {
    Alice: { "2026-06-15": "VL", "2026-06-18": "Offset", "2026-06-30": "EL" },
    Bob: { "2026-06-15": "Holiday" },
  },
  "2": {
    Alice: { "2026-06-18": "VL" }, // overlapping (Alice 06-18) — should dedupe to the first seen
  },
};

describe("summarizeLeaveStatus", () => {
  it("lists who is out TODAY (sorted by name)", () => {
    const s = summarizeLeaveStatus(STORE, { today: "2026-06-15" });
    expect(s.today).toEqual([
      { assignee: "Alice", type: "VL" },
      { assignee: "Bob", type: "Holiday" },
    ]);
  });

  it("lists UPCOMING leave within the horizon, sorted by days away, and excludes far-out dates", () => {
    const s = summarizeLeaveStatus(STORE, { today: "2026-06-15", horizonDays: 7 });
    // 06-18 is in (3 days); 06-30 is 15 days → excluded
    expect(s.upcoming).toEqual([{ assignee: "Alice", date: "2026-06-18", type: "Offset", daysAway: 3 }]);
  });

  it("dedupes the same (assignee, date) across sprints — first sprint wins", () => {
    const s = summarizeLeaveStatus(STORE, { today: "2026-06-15", horizonDays: 30 });
    const alice618 = s.upcoming.filter((u) => u.assignee === "Alice" && u.date === "2026-06-18");
    expect(alice618).toHaveLength(1);
    expect(alice618[0]!.type).toBe("Offset"); // from sprint "1", not the "2" VL dup
  });

  it("excludes past leave and returns empty lists when nothing matches", () => {
    const s = summarizeLeaveStatus(STORE, { today: "2026-07-15", horizonDays: 7 });
    expect(s.today).toEqual([]);
    expect(s.upcoming).toEqual([]);
  });
});
