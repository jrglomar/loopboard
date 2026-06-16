/**
 * Unit tests for the isCodeReview predicate and parseCodeReviewStatuses helper.
 * Pure functions — no network, no env, no config needed.
 */
import { describe, it, expect } from "vitest";
import { isCodeReview, parseCodeReviewStatuses } from "../src/lib/buckets.js";
import type { IssueSummary } from "../src/lib/types.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeIssue(
  overrides: Partial<Pick<IssueSummary, "statusCategory" | "status">>
): Pick<IssueSummary, "statusCategory" | "status"> {
  return {
    statusCategory: "inprogress",
    status: "In Progress",
    ...overrides,
  };
}

const DEFAULT_STATUSES = parseCodeReviewStatuses(
  "code review,in review,peer review,review"
);

// --------------------------------------------------------------------------
// parseCodeReviewStatuses
// --------------------------------------------------------------------------

describe("parseCodeReviewStatuses", () => {
  it("splits on comma and lowercases+trims each entry", () => {
    const result = parseCodeReviewStatuses("Code Review, IN REVIEW , peer review");
    expect(result).toEqual(["code review", "in review", "peer review"]);
  });

  it("drops empty entries (trailing comma, double comma)", () => {
    const result = parseCodeReviewStatuses("code review,,review,");
    expect(result).toEqual(["code review", "review"]);
  });

  it("handles a single entry", () => {
    expect(parseCodeReviewStatuses("review")).toEqual(["review"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseCodeReviewStatuses("")).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// isCodeReview — category guard
// --------------------------------------------------------------------------

describe("isCodeReview — category guard", () => {
  it("returns false for todo-category issue even if status name matches", () => {
    const issue = makeIssue({ statusCategory: "todo", status: "code review" });
    expect(isCodeReview(issue, DEFAULT_STATUSES)).toBe(false);
  });

  it("returns false for done-category issue even if status contains 'review'", () => {
    const issue = makeIssue({ statusCategory: "done", status: "Reviewed" });
    expect(isCodeReview(issue, DEFAULT_STATUSES)).toBe(false);
  });

  it("returns false for done-category 'review' exact match", () => {
    const issue = makeIssue({ statusCategory: "done", status: "review" });
    expect(isCodeReview(issue, DEFAULT_STATUSES)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// isCodeReview — default statuses (case-insensitive matching)
// --------------------------------------------------------------------------

describe("isCodeReview — default statuses", () => {
  it("matches 'Code Review' (mixed case)", () => {
    expect(isCodeReview(makeIssue({ status: "Code Review" }), DEFAULT_STATUSES)).toBe(true);
  });

  it("matches 'code review' (lowercase)", () => {
    expect(isCodeReview(makeIssue({ status: "code review" }), DEFAULT_STATUSES)).toBe(true);
  });

  it("matches 'CODE REVIEW' (uppercase)", () => {
    expect(isCodeReview(makeIssue({ status: "CODE REVIEW" }), DEFAULT_STATUSES)).toBe(true);
  });

  it("matches 'In Review'", () => {
    expect(isCodeReview(makeIssue({ status: "In Review" }), DEFAULT_STATUSES)).toBe(true);
  });

  it("matches 'Peer Review'", () => {
    expect(isCodeReview(makeIssue({ status: "Peer Review" }), DEFAULT_STATUSES)).toBe(true);
  });

  it("matches 'Review' (exact, case-insensitive)", () => {
    expect(isCodeReview(makeIssue({ status: "Review" }), DEFAULT_STATUSES)).toBe(true);
  });

  it("does NOT match 'In Progress'", () => {
    expect(isCodeReview(makeIssue({ status: "In Progress" }), DEFAULT_STATUSES)).toBe(false);
  });

  it("does NOT match 'Ready for Review' (partial — not in default list)", () => {
    // 'ready for review' is not an exact match for any default entry
    expect(isCodeReview(makeIssue({ status: "Ready for Review" }), DEFAULT_STATUSES)).toBe(false);
  });

  it("trims whitespace from the issue status before comparing", () => {
    expect(isCodeReview(makeIssue({ status: "  code review  " }), DEFAULT_STATUSES)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// isCodeReview — custom status list
// --------------------------------------------------------------------------

describe("isCodeReview — custom status list", () => {
  it("matches a custom status when list is configured", () => {
    const custom = parseCodeReviewStatuses("awaiting review,qa");
    expect(isCodeReview(makeIssue({ status: "Awaiting Review" }), custom)).toBe(true);
    expect(isCodeReview(makeIssue({ status: "QA" }), custom)).toBe(true);
  });

  it("does NOT match default statuses when custom list excludes them", () => {
    const custom = parseCodeReviewStatuses("awaiting review");
    expect(isCodeReview(makeIssue({ status: "Code Review" }), custom)).toBe(false);
  });

  it("returns false for any status when the list is empty", () => {
    const empty = parseCodeReviewStatuses("");
    expect(isCodeReview(makeIssue({ status: "Code Review" }), empty)).toBe(false);
    expect(isCodeReview(makeIssue({ status: "Review" }), empty)).toBe(false);
  });
});
