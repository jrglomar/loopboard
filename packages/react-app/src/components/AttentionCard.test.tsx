// AttentionCard tests — v1.42, ADR-052. Presentational; keyless/offline.
// Uses today-independent nudges (unassigned + PR review) so no clock stubbing is needed.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AttentionCard } from "./AttentionCard";
import type { IssueSummary, LinkedPr } from "../lib/types";

function issue(partial: Partial<IssueSummary> & { key: string }): IssueSummary {
  return {
    key: partial.key, summary: partial.summary ?? `Summary ${partial.key}`,
    status: "To Do", statusCategory: partial.statusCategory ?? "todo",
    assignee: partial.assignee ?? null, assigneeAccountId: null,
    storyPoints: null, issueType: "Task", url: `https://jira/browse/${partial.key}`,
    blocked: false, resolvedAt: null, updatedAt: partial.updatedAt ?? null,
  };
}

const REVIEW_PR: LinkedPr = {
  url: "https://gh/pr/9", title: "Add endpoint", repo: "org/api",
  status: "open", decision: "review_required", approvals: 0, reviewers: [],
};

afterEach(() => cleanup());

describe("AttentionCard (v1.42)", () => {
  it("shows the All clear empty state when nothing needs attention", () => {
    render(<AttentionCard issues={[issue({ key: "D-1", statusCategory: "done", assignee: "Al" })]} prsByKey={{}} />);
    expect(screen.getByText(/All clear/i)).toBeTruthy();
  });

  it("lists unassigned + PR-awaiting-review nudges with a count badge", () => {
    render(
      <AttentionCard
        issues={[
          issue({ key: "D-1", statusCategory: "todo", assignee: null, summary: "Wire the form" }),
          // assigned + fresh, so its ONLY nudge is the PR awaiting review
          issue({ key: "P-9", statusCategory: "inprogress", assignee: "Bo", updatedAt: new Date().toISOString() }),
        ]}
        prsByKey={{ "P-9": [REVIEW_PR] }}
      />
    );
    expect(screen.getByText("D-1")).toBeTruthy();
    expect(screen.getByText(/Unassigned/i)).toBeTruthy();
    expect(screen.getByText("P-9")).toBeTruthy();
    expect(screen.getByText(/PR awaiting review/i)).toBeTruthy();
    // count badge = 2 (one unassigned + one PR review)
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("links each nudge out to its URL in a new tab", () => {
    render(
      <AttentionCard
        issues={[issue({ key: "D-1", statusCategory: "todo", assignee: null })]}
        prsByKey={{}}
      />
    );
    const link = screen.getByRole("link", { name: /D-1/ });
    expect(link.getAttribute("href")).toBe("https://jira/browse/D-1");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
