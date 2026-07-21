// draftPlan tests — CONTRACTS.md §4.30 v1.70, ADR-081
// Pure functions — no mocks needed.

import { describe, it, expect } from "vitest";
import { draftTotalsByAccount, allocatedByIssue, unplannedIssues, staleShareEntries } from "./draftPlan";
import type { DraftShare, IssueSummary } from "./types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function issue(key: string, storyPoints: number | null, summary = `Summary for ${key}`): IssueSummary {
  return {
    key,
    summary,
    status: "To Do",
    statusCategory: "todo",
    assignee: null,
    assigneeAccountId: null,
    storyPoints,
    issueType: "Story",
    url: `https://jira.example.com/browse/${key}`,
    blocked: false,
  };
}

function share(accountId: string, displayName: string, points: number): DraftShare {
  return { accountId, displayName, points };
}

const ALICE_ID = "acc-1";
const BOB_ID = "acc-2";

const PO_1 = issue("PO-1", 5);
const PO_2 = issue("PO-2", 3);
const PO_3 = issue("PO-3", null); // unpointed
const ISSUES: IssueSummary[] = [PO_1, PO_2, PO_3];

const ROSTER = new Set([ALICE_ID, BOB_ID]);

// ── draftTotalsByAccount ──────────────────────────────────────────────────────

describe("draftTotalsByAccount", () => {
  it("sums each member's share points and counts across in-sprint tickets", () => {
    const assignments = {
      "PO-1": [share(ALICE_ID, "Alice", 5)],
      "PO-2": [share(ALICE_ID, "Alice", 3)],
      "PO-3": [share(BOB_ID, "Bob", 0)],
    };
    const totals = draftTotalsByAccount(assignments, ISSUES);

    expect(totals["acc-1"]).toEqual({
      points: 8,
      count: 2,
      items: [
        { issue: PO_1, points: 5 },
        { issue: PO_2, points: 3 },
      ],
    });
    expect(totals["acc-2"]).toEqual({ points: 0, count: 1, items: [{ issue: PO_3, points: 0 }] });
  });

  it("splits one ticket's points across two developer shares independently", () => {
    const assignments = { "PO-1": [share(ALICE_ID, "Alice", 3), share(BOB_ID, "Bob", 2)] };
    const totals = draftTotalsByAccount(assignments, ISSUES);

    expect(totals["acc-1"]).toEqual({ points: 3, count: 1, items: [{ issue: PO_1, points: 3 }] });
    expect(totals["acc-2"]).toEqual({ points: 2, count: 1, items: [{ issue: PO_1, points: 2 }] });
  });

  it("uses each share's OWN points, not the ticket's real storyPoints (over/under is allowed)", () => {
    const assignments = { "PO-1": [share(ALICE_ID, "Alice", 999)] }; // PO-1 real points = 5
    const totals = draftTotalsByAccount(assignments, ISSUES);
    expect(totals["acc-1"]!.points).toBe(999);
  });

  it("ignores tickets that are not drafted", () => {
    const totals = draftTotalsByAccount({ "PO-1": [share(ALICE_ID, "Alice", 5)] }, ISSUES);
    expect(Object.keys(totals)).toEqual(["acc-1"]);
    expect(totals["acc-1"]!.count).toBe(1);
  });

  it("treats an empty share array for a key as undrafted (defensive — server rejects these)", () => {
    const totals = draftTotalsByAccount({ "PO-1": [] }, ISSUES);
    expect(totals).toEqual({});
  });

  it("ignores a draft entry whose ticket is no longer in the sprint (stale)", () => {
    const totals = draftTotalsByAccount({ "PO-99": [share(ALICE_ID, "Alice", 5)] }, ISSUES);
    expect(totals).toEqual({});
  });

  it("returns {} for empty assignments", () => {
    expect(draftTotalsByAccount({}, ISSUES)).toEqual({});
  });

  it("returns {} for an empty issue list even with assignments present", () => {
    expect(draftTotalsByAccount({ "PO-1": [share(ALICE_ID, "Alice", 5)] }, [])).toEqual({});
  });

  it("preserves sprint bucket order within each member's items list", () => {
    const assignments = {
      "PO-2": [share(ALICE_ID, "Alice", 3)],
      "PO-1": [share(ALICE_ID, "Alice", 5)],
    };
    const totals = draftTotalsByAccount(assignments, ISSUES); // ISSUES = [PO-1, PO-2, PO-3]
    expect(totals["acc-1"]!.items.map((i) => i.issue.key)).toEqual(["PO-1", "PO-2"]);
  });
});

// ── allocatedByIssue ──────────────────────────────────────────────────────────

describe("allocatedByIssue", () => {
  it("sums share points for a single-share ticket", () => {
    expect(allocatedByIssue({ "PO-1": [share(ALICE_ID, "Alice", 5)] })).toEqual({ "PO-1": 5 });
  });

  it("sums share points across a split ticket's multiple shares", () => {
    const assignments = { "PO-1": [share(ALICE_ID, "Alice", 3), share(BOB_ID, "Bob", 2)] };
    expect(allocatedByIssue(assignments)).toEqual({ "PO-1": 5 });
  });

  it("returns 0 for a ticket with an empty share array", () => {
    expect(allocatedByIssue({ "PO-1": [] })).toEqual({ "PO-1": 0 });
  });

  it("omits keys with no assignments entry — caller defaults via ?? 0", () => {
    const result = allocatedByIssue({ "PO-1": [share(ALICE_ID, "Alice", 5)] });
    expect(result["PO-2"]).toBeUndefined();
  });

  it("returns {} for empty assignments", () => {
    expect(allocatedByIssue({})).toEqual({});
  });

  it("computes independent of the current issue list (includes stale keys)", () => {
    expect(allocatedByIssue({ "PO-99": [share(ALICE_ID, "Alice", 5)] })).toEqual({ "PO-99": 5 });
  });

  it("sums fractional/over-real-points shares as-is (advisory, never clamped)", () => {
    const assignments = { "PO-1": [share(ALICE_ID, "Alice", 4.5), share(BOB_ID, "Bob", 4.5)] }; // 9 > real 5
    expect(allocatedByIssue(assignments)).toEqual({ "PO-1": 9 });
  });
});

// ── unplannedIssues ───────────────────────────────────────────────────────────

describe("unplannedIssues", () => {
  it("returns issues that have no draft assignment", () => {
    const result = unplannedIssues({ "PO-1": [share(ALICE_ID, "Alice", 5)] }, ISSUES);
    expect(result.map((i) => i.key)).toEqual(["PO-2", "PO-3"]);
  });

  it("returns [] when every ticket is drafted", () => {
    const result = unplannedIssues(
      {
        "PO-1": [share(ALICE_ID, "Alice", 5)],
        "PO-2": [share(BOB_ID, "Bob", 3)],
        "PO-3": [share(ALICE_ID, "Alice", 0)],
      },
      ISSUES
    );
    expect(result).toEqual([]);
  });

  it("returns all issues when assignments is empty", () => {
    const result = unplannedIssues({}, ISSUES);
    expect(result).toEqual(ISSUES);
  });

  it("ignores a stale assignment key that doesn't match any current issue", () => {
    const result = unplannedIssues({ "PO-99": [share(ALICE_ID, "Alice", 5)] }, ISSUES);
    expect(result).toEqual(ISSUES); // PO-99 isn't in `issues`, so it doesn't hide anything
  });

  it("treats a key with an empty share array as still unplanned", () => {
    const result = unplannedIssues({ "PO-1": [] }, ISSUES);
    expect(result.map((i) => i.key)).toContain("PO-1");
  });

  it("a ticket with two shares (split across developers) is not unplanned", () => {
    const result = unplannedIssues(
      { "PO-1": [share(ALICE_ID, "Alice", 3), share(BOB_ID, "Bob", 2)] },
      ISSUES
    );
    expect(result.map((i) => i.key)).not.toContain("PO-1");
  });
});

// ── staleShareEntries ─────────────────────────────────────────────────────────

describe("staleShareEntries", () => {
  it("reports every share on a ticket that's no longer in the sprint as ticket-gone", () => {
    const assignments = { "PO-99": [share(ALICE_ID, "Alice", 5), share(BOB_ID, "Bob", 2)] };
    const result = staleShareEntries(assignments, ISSUES, ROSTER);

    expect(result).toEqual([
      { issueKey: "PO-99", share: share(ALICE_ID, "Alice", 5), reason: "ticket-gone" },
      { issueKey: "PO-99", share: share(BOB_ID, "Bob", 2), reason: "ticket-gone" },
    ]);
  });

  it("reports a share whose member left the roster (ticket still in-sprint) as member-gone", () => {
    const assignments = { "PO-1": [share("acc-99", "Charlie", 5)] };
    const result = staleShareEntries(assignments, ISSUES, ROSTER);

    expect(result).toEqual([
      { issueKey: "PO-1", share: share("acc-99", "Charlie", 5), reason: "member-gone" },
    ]);
  });

  it("on a split ticket, reports only the ex-member's share — not the still-rostered one", () => {
    const assignments = { "PO-1": [share(ALICE_ID, "Alice", 3), share("acc-99", "Charlie", 2)] };
    const result = staleShareEntries(assignments, ISSUES, ROSTER);

    expect(result).toEqual([
      { issueKey: "PO-1", share: share("acc-99", "Charlie", 2), reason: "member-gone" },
    ]);
  });

  it("reports ticket-gone (never member-gone) when both the ticket and the member are gone", () => {
    const assignments = { "PO-99": [share("acc-99", "Charlie", 5)] };
    const result = staleShareEntries(assignments, ISSUES, ROSTER);

    expect(result).toEqual([
      { issueKey: "PO-99", share: share("acc-99", "Charlie", 5), reason: "ticket-gone" },
    ]);
  });

  it("returns [] when every share is on an in-sprint ticket held by a current roster member", () => {
    const assignments = { "PO-1": [share(ALICE_ID, "Alice", 5)], "PO-2": [share(BOB_ID, "Bob", 3)] };
    expect(staleShareEntries(assignments, ISSUES, ROSTER)).toEqual([]);
  });

  it("returns [] for empty assignments", () => {
    expect(staleShareEntries({}, ISSUES, ROSTER)).toEqual([]);
  });

  it("an empty share array for a key contributes no entries", () => {
    expect(staleShareEntries({ "PO-1": [] }, ISSUES, ROSTER)).toEqual([]);
  });

  it("treats every share as member-gone when the roster set is empty", () => {
    const assignments = { "PO-1": [share(ALICE_ID, "Alice", 5)] };
    const result = staleShareEntries(assignments, ISSUES, new Set());

    expect(result).toEqual([
      { issueKey: "PO-1", share: share(ALICE_ID, "Alice", 5), reason: "member-gone" },
    ]);
  });
});
