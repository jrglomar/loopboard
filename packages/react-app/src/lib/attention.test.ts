// buildAttention tests — v1.42, ADR-052. Pure, deterministic (today is injected).

import { describe, it, expect } from "vitest";
import { buildAttention } from "./attention";
import type { IssueSummary, LinkedPr } from "./types";

const TODAY = "2026-07-07";

function issue(partial: Partial<IssueSummary> & { key: string }): IssueSummary {
  return {
    key: partial.key,
    summary: partial.summary ?? `Summary ${partial.key}`,
    status: partial.status ?? "To Do",
    statusCategory: partial.statusCategory ?? "todo",
    assignee: partial.assignee ?? null,
    assigneeAccountId: partial.assigneeAccountId ?? null,
    storyPoints: partial.storyPoints ?? null,
    issueType: partial.issueType ?? "Task",
    url: partial.url ?? `https://jira/browse/${partial.key}`,
    blocked: partial.blocked ?? false,
    resolvedAt: partial.resolvedAt ?? null,
    updatedAt: partial.updatedAt ?? null,
  };
}

function pr(partial: Partial<LinkedPr>): LinkedPr {
  return {
    url: partial.url ?? "https://gh/pr/1",
    title: partial.title ?? "PR title",
    repo: partial.repo ?? "org/repo",
    status: partial.status ?? "open",
    decision: partial.decision ?? "review_required",
    approvals: partial.approvals ?? 0,
    reviewers: partial.reviewers ?? [],
    lastUpdate: partial.lastUpdate,
  };
}

describe("buildAttention (v1.42)", () => {
  it("flags an in-progress issue not updated in ≥ staleDays days", () => {
    const res = buildAttention({
      issues: [
        issue({ key: "D-1", statusCategory: "inprogress", assignee: "Al", updatedAt: "2026-07-02T09:00:00Z" }), // 5 days
        issue({ key: "D-2", statusCategory: "inprogress", assignee: "Bo", updatedAt: "2026-07-07T08:00:00Z" }), // today
      ],
      prsByKey: {},
      today: TODAY,
      staleDays: 3,
    });
    expect(res.staleCount).toBe(1);
    expect(res.items[0]).toMatchObject({ kind: "stale", key: "D-1", detail: "No update in 5 days" });
  });

  it("treats the staleDays boundary as stale (>=)", () => {
    const res = buildAttention({
      issues: [issue({ key: "D-1", statusCategory: "inprogress", assignee: "Al", updatedAt: "2026-07-04T00:00:00Z" })], // exactly 3
      prsByKey: {}, today: TODAY, staleDays: 3,
    });
    expect(res.staleCount).toBe(1);
  });

  it("does not flag staleness without a known updatedAt", () => {
    const res = buildAttention({
      issues: [issue({ key: "D-1", statusCategory: "inprogress", assignee: "Al", updatedAt: null })],
      prsByKey: {}, today: TODAY,
    });
    expect(res.staleCount).toBe(0);
  });

  it("flags unfinished unassigned issues, but not done ones", () => {
    const res = buildAttention({
      issues: [
        issue({ key: "D-1", statusCategory: "todo", assignee: null }),
        issue({ key: "D-2", statusCategory: "done", assignee: null }), // done → ignored
        issue({ key: "D-3", statusCategory: "inprogress", assignee: "Al", updatedAt: TODAY + "T08:00:00Z" }), // assigned + fresh
      ],
      prsByKey: {}, today: TODAY,
    });
    expect(res.unassignedCount).toBe(1);
    expect(res.items.map((i) => i.key)).toEqual(["D-1"]);
  });

  it("does not double-flag a stale issue that is also unassigned", () => {
    const res = buildAttention({
      issues: [issue({ key: "D-1", statusCategory: "inprogress", assignee: null, updatedAt: "2026-07-01T00:00:00Z" })],
      prsByKey: {}, today: TODAY, staleDays: 3,
    });
    expect(res.staleCount).toBe(1);
    expect(res.unassignedCount).toBe(0);
    expect(res.items).toHaveLength(1);
  });

  it("flags open PRs awaiting review, ignoring merged/approved ones", () => {
    const res = buildAttention({
      issues: [issue({ key: "D-1", statusCategory: "inprogress", assignee: "Al", updatedAt: TODAY + "T08:00:00Z" })],
      prsByKey: {
        "D-1": [
          pr({ status: "open", decision: "review_required", repo: "org/api" }),
          pr({ status: "open", decision: "approved" }), // already approved → ignored
          pr({ status: "merged", decision: "review_required" }), // merged → ignored
        ],
      },
      today: TODAY,
    });
    expect(res.prReviewCount).toBe(1);
    expect(res.items[0]).toMatchObject({ kind: "pr_review", key: "D-1", detail: "PR awaiting review · org/api" });
  });

  it("returns an empty result when nothing needs attention", () => {
    const res = buildAttention({
      issues: [
        issue({ key: "D-1", statusCategory: "done", assignee: "Al" }),
        issue({ key: "D-2", statusCategory: "inprogress", assignee: "Bo", updatedAt: TODAY + "T08:00:00Z" }),
      ],
      prsByKey: { "D-2": [pr({ status: "merged", decision: "approved" })] },
      today: TODAY,
    });
    expect(res.items).toHaveLength(0);
    expect(res).toMatchObject({ staleCount: 0, unassignedCount: 0, prReviewCount: 0 });
  });

  it("orders items stale → unassigned → pr_review", () => {
    const res = buildAttention({
      issues: [
        issue({ key: "S-1", statusCategory: "inprogress", assignee: "Al", updatedAt: "2026-07-01T00:00:00Z" }),
        issue({ key: "U-1", statusCategory: "todo", assignee: null }),
        issue({ key: "P-1", statusCategory: "inprogress", assignee: "Bo", updatedAt: TODAY + "T08:00:00Z" }),
      ],
      prsByKey: { "P-1": [pr({ status: "open", decision: "review_required" })] },
      today: TODAY, staleDays: 3,
    });
    expect(res.items.map((i) => i.kind)).toEqual(["stale", "unassigned", "pr_review"]);
  });
});
