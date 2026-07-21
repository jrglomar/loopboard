// draftPlan tests — CONTRACTS.md §4.30 v1.68, ADR-079
// Pure functions — no mocks needed.

import { describe, it, expect } from "vitest";
import { draftTotalsByAccount, unplannedIssues, staleDraftEntries } from "./draftPlan";
import type { DraftAssignment, IssueSummary } from "./types";

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

const ALICE: DraftAssignment = { accountId: "acc-1", displayName: "Alice" };
const BOB: DraftAssignment = { accountId: "acc-2", displayName: "Bob" };

const PO_1 = issue("PO-1", 5);
const PO_2 = issue("PO-2", 3);
const PO_3 = issue("PO-3", null); // unpointed
const ISSUES: IssueSummary[] = [PO_1, PO_2, PO_3];

// ── draftTotalsByAccount ──────────────────────────────────────────────────────

describe("draftTotalsByAccount", () => {
  it("sums points and counts per accountId for drafted, in-sprint tickets", () => {
    const assignments = { "PO-1": ALICE, "PO-2": ALICE, "PO-3": BOB };
    const totals = draftTotalsByAccount(assignments, ISSUES);

    expect(totals["acc-1"]).toEqual({ points: 8, count: 2, issues: [PO_1, PO_2] });
    expect(totals["acc-2"]).toEqual({ points: 0, count: 1, issues: [PO_3] }); // null storyPoints -> 0
  });

  it("treats an unpointed ticket (storyPoints: null) as 0 points", () => {
    const totals = draftTotalsByAccount({ "PO-3": ALICE }, ISSUES);
    expect(totals["acc-1"]!.points).toBe(0);
    expect(totals["acc-1"]!.count).toBe(1);
  });

  it("ignores tickets that are not drafted", () => {
    const totals = draftTotalsByAccount({ "PO-1": ALICE }, ISSUES);
    expect(Object.keys(totals)).toEqual(["acc-1"]);
    expect(totals["acc-1"]!.count).toBe(1);
  });

  it("ignores a draft entry whose ticket is no longer in the sprint (stale)", () => {
    const totals = draftTotalsByAccount({ "PO-99": ALICE }, ISSUES);
    expect(totals).toEqual({});
  });

  it("returns {} for empty assignments", () => {
    expect(draftTotalsByAccount({}, ISSUES)).toEqual({});
  });

  it("returns {} for an empty issue list even with assignments present", () => {
    expect(draftTotalsByAccount({ "PO-1": ALICE }, [])).toEqual({});
  });

  it("preserves sprint bucket order within each member's issues list", () => {
    const assignments = { "PO-2": ALICE, "PO-1": ALICE };
    const totals = draftTotalsByAccount(assignments, ISSUES); // ISSUES = [PO-1, PO-2, PO-3]
    expect(totals["acc-1"]!.issues.map((i) => i.key)).toEqual(["PO-1", "PO-2"]);
  });
});

// ── unplannedIssues ───────────────────────────────────────────────────────────

describe("unplannedIssues", () => {
  it("returns issues that have no draft assignment", () => {
    const result = unplannedIssues({ "PO-1": ALICE }, ISSUES);
    expect(result.map((i) => i.key)).toEqual(["PO-2", "PO-3"]);
  });

  it("returns [] when every ticket is drafted", () => {
    const result = unplannedIssues({ "PO-1": ALICE, "PO-2": BOB, "PO-3": ALICE }, ISSUES);
    expect(result).toEqual([]);
  });

  it("returns all issues when assignments is empty", () => {
    const result = unplannedIssues({}, ISSUES);
    expect(result).toEqual(ISSUES);
  });

  it("ignores a stale assignment key that doesn't match any current issue", () => {
    const result = unplannedIssues({ "PO-99": ALICE }, ISSUES);
    expect(result).toEqual(ISSUES); // PO-99 isn't in `issues`, so it doesn't hide anything
  });
});

// ── staleDraftEntries ──────────────────────────────────────────────────────────

describe("staleDraftEntries", () => {
  it("returns entries whose ticket is no longer in the sprint", () => {
    const assignments = { "PO-1": ALICE, "PO-99": BOB };
    const result = staleDraftEntries(assignments, ISSUES);
    expect(result).toEqual([{ issueKey: "PO-99", assignment: BOB }]);
  });

  it("returns [] when every drafted ticket is still in the sprint", () => {
    const assignments = { "PO-1": ALICE, "PO-2": BOB };
    expect(staleDraftEntries(assignments, ISSUES)).toEqual([]);
  });

  it("returns [] for empty assignments", () => {
    expect(staleDraftEntries({}, ISSUES)).toEqual([]);
  });

  it("treats every entry as stale when the issue list is empty", () => {
    const assignments = { "PO-1": ALICE, "PO-2": BOB };
    const result = staleDraftEntries(assignments, []);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.issueKey).sort()).toEqual(["PO-1", "PO-2"]);
  });
});
