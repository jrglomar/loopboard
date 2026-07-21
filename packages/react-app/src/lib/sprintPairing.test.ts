// sprintPairing tests — CONTRACTS.md §4.30 v1.68, ADR-079
// Pure function — no mocks needed.

import { describe, it, expect } from "vitest";
import { pairDevSprint } from "./sprintPairing";
import type { SprintRef } from "./types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function mk(
  id: number,
  name: string,
  startDate: string | null,
  endDate: string | null,
  state: "active" | "future" = "future"
): SprintRef {
  return { id, name, state, startDate, endDate, completeDate: null, goal: null, boardId: 20 };
}

const PO_SPRINT: SprintRef = mk(1, "Sprint 8", "2026-06-28", "2026-07-11", "future"); // 14 days

// ── No candidates ─────────────────────────────────────────────────────────────

describe("pairDevSprint — no candidates", () => {
  it("returns undefined when both devActive and devFuture are empty", () => {
    expect(pairDevSprint(PO_SPRINT, [], [])).toBeUndefined();
  });

  it("returns undefined when poSprint is also undefined and there are no candidates", () => {
    expect(pairDevSprint(undefined, [], [])).toBeUndefined();
  });
});

// ── poSprint undefined ────────────────────────────────────────────────────────

describe("pairDevSprint — poSprint undefined", () => {
  it("falls back to future[0] when poSprint is undefined and future sprints exist", () => {
    const future = [mk(10, "Dev Future A", "2026-06-01", "2026-06-14"), mk(11, "Dev Future B", "2026-06-15", "2026-06-28")];
    const active = [mk(20, "Dev Active", "2026-05-01", "2026-05-14", "active")];
    expect(pairDevSprint(undefined, active, future)?.id).toBe(10);
  });

  it("falls back to active[0] when poSprint is undefined and there are no future sprints", () => {
    const active = [mk(20, "Dev Active", "2026-05-01", "2026-05-14", "active")];
    expect(pairDevSprint(undefined, active, [])?.id).toBe(20);
  });
});

// ── Overlap scoring ───────────────────────────────────────────────────────────

describe("pairDevSprint — overlap scoring", () => {
  it("picks the candidate with the greatest calendar-day overlap", () => {
    // Overlaps PO (06-28..07-11) by 7 days (06-28..07-04)
    const partial = mk(10, "Partial", "2026-06-21", "2026-07-04", "future");
    // Fully contained in PO range — overlaps by the full 14 days
    const full = mk(11, "Full", "2026-06-28", "2026-07-11", "future");
    expect(pairDevSprint(PO_SPRINT, [], [partial, full])?.id).toBe(11);
  });

  it("counts overlap inclusively for a single shared day", () => {
    // PO ends 07-11; this candidate starts 07-11 — exactly 1 overlapping day.
    const oneDay = mk(10, "OneDay", "2026-07-11", "2026-07-18", "future");
    // This candidate is entirely disjoint (starts the day after PO ends).
    const none = mk(11, "None", "2026-07-12", "2026-07-20", "future");
    expect(pairDevSprint(PO_SPRINT, [], [none, oneDay])?.id).toBe(10);
  });

  it("scores a candidate missing dates as 0, even when other candidates overlap", () => {
    const noDates = mk(10, "NoDates", null, null, "future");
    const overlapping = mk(11, "Overlapping", "2026-06-28", "2026-07-04", "future");
    expect(pairDevSprint(PO_SPRINT, [], [noDates, overlapping])?.id).toBe(11);
  });

  it("scores every candidate 0 when the PO sprint itself has no dates", () => {
    const poNoDates = mk(1, "Sprint 8", null, null, "future");
    const future = mk(10, "Dev Future", "2026-06-01", "2026-06-14", "future");
    // Falls through to the all-zero path: no name match → future[0]
    expect(pairDevSprint(poNoDates, [], [future])?.id).toBe(10);
  });
});

// ── Ties ──────────────────────────────────────────────────────────────────────

describe("pairDevSprint — ties", () => {
  it("breaks a tie between two future sprints by earliest startDate", () => {
    // Both overlap PO (06-28..07-11) by exactly 7 days.
    const earlier = mk(10, "Earlier", "2026-06-21", "2026-07-04", "future"); // overlap 06-28..07-04
    const later = mk(11, "Later", "2026-07-05", "2026-07-18", "future"); // overlap 07-05..07-11
    expect(pairDevSprint(PO_SPRINT, [], [later, earlier])?.id).toBe(10);
  });

  it("breaks a tie between a future and an active sprint in favor of future", () => {
    // Identical date ranges → identical overlap scores.
    const active = mk(20, "Active", "2026-06-28", "2026-07-04", "active");
    const future = mk(21, "Future", "2026-06-28", "2026-07-04", "future");
    expect(pairDevSprint(PO_SPRINT, [active], [future])?.id).toBe(21);
  });
});

// ── All-zero fallback: name match / future[0] / active[0] ────────────────────

describe("pairDevSprint — all-zero fallback", () => {
  it("picks the exact name match over the future-first fallback when all scores are 0", () => {
    const future = mk(10, "Sprint X", null, null, "future");
    const activeNameMatch = mk(20, "Sprint 8", null, null, "active"); // matches PO_SPRINT.name
    expect(pairDevSprint(PO_SPRINT, [activeNameMatch], [future])?.id).toBe(20);
  });

  it("falls back to future[0] when all scores are 0 and no name matches", () => {
    const future = mk(10, "Sprint X", null, null, "future");
    const active = mk(20, "Sprint Y", null, null, "active");
    expect(pairDevSprint(PO_SPRINT, [active], [future])?.id).toBe(10);
  });

  it("falls back to active[0] when all scores are 0, no name match, and no future sprints", () => {
    const active = mk(20, "Sprint Y", null, null, "active");
    expect(pairDevSprint(PO_SPRINT, [active], [])?.id).toBe(20);
  });
});
