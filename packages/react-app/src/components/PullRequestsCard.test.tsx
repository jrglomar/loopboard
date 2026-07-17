// PullRequestsCard tests — manual store (v1.16) + linked-PR auto list from Jira dev-status
// (v1.22, ADR-034) with approval badges. Keyless/offline (usePullRequests + useIssuePullRequests mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { PullRequestsCard } from "./PullRequestsCard";
import type { PullRequest, LinkedPr } from "../lib/types";

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    usePullRequests: vi.fn(),
    useIssuePullRequests: vi.fn(),
    // v1.59 (ADR-071): idle/empty shape (anti-drift parity — see Reports.test.tsx's comment).
    useMultiSprintReport: vi.fn().mockReturnValue({ data: null, loading: false, error: null, run: vi.fn() }),
  };
});
import * as useJiraModule from "../hooks/useJira";

const save = vi.fn<(p: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

function setMock(data: PullRequest[] | null) {
  vi.mocked(useJiraModule.usePullRequests).mockReturnValue({
    data, loading: false, error: null, run: vi.fn(), save,
  });
}

function setIssuePrsMock(data: Record<string, LinkedPr[]>) {
  vi.mocked(useJiraModule.useIssuePullRequests).mockReturnValue({ data, loading: false });
}

function linkedPr(over: Partial<LinkedPr>): LinkedPr {
  return {
    url: "https://github.com/o/repo/pull/1", title: "PR", repo: "o/repo",
    status: "open", decision: "review_required", approvals: 0, reviewers: [], ...over,
  };
}

beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(undefined); setIssuePrsMock({}); });
afterEach(() => cleanup());

describe("PullRequestsCard — manual store", () => {
  it("prompts to select a sprint when sprintId is null", () => {
    setMock([]);
    render(<PullRequestsCard sprintId={null} />);
    expect(screen.getByText(/Select a sprint to track pending PRs/i)).toBeTruthy();
  });

  it("renders an existing manual PR as a link with a short label", () => {
    setMock([{ id: "a", url: "https://github.com/o/repo/pull/42", addedAt: "t" }]);
    render(<PullRequestsCard sprintId={100} />);
    const link = screen.getByRole("link", { name: /Open pull request repo#42/i });
    expect(link.getAttribute("href")).toBe("https://github.com/o/repo/pull/42");
  });

  it("adding a PR calls save with the new url appended", async () => {
    setMock([]);
    render(<PullRequestsCard sprintId={100} />);
    fireEvent.change(screen.getByLabelText(/Pull request URL/i), {
      target: { value: "https://github.com/o/repo/pull/7" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([{ url: "https://github.com/o/repo/pull/7" }])
    );
  });

  it("removing a PR calls save without it", async () => {
    setMock([{ id: "a", url: "https://github.com/o/repo/pull/9", addedAt: "t" }]);
    render(<PullRequestsCard sprintId={100} />);
    fireEvent.click(screen.getByRole("button", { name: /Remove PR repo#9/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith([]));
  });
});

describe("PullRequestsCard — linked PRs from Jira dev-status (v1.22)", () => {
  it("lists linked PRs across repos including merged/closed, labelling their state", () => {
    setMock([]);
    setIssuePrsMock({
      "VRDB-1": [
        linkedPr({ url: "https://github.com/o/web/pull/10", title: "Open PR", repo: "o/web", status: "open" }),
        linkedPr({ url: "https://github.com/o/web/pull/8", title: "Merged PR", status: "merged" }),
      ],
      "VRDB-2": [
        linkedPr({ url: "https://github.com/o/api/pull/3", title: "API PR", repo: "o/api", status: "open" }),
        linkedPr({ url: "https://github.com/o/api/pull/2", title: "Closed PR", status: "declined" }),
      ],
    });
    render(<PullRequestsCard sprintId={100} sprintKeys={["VRDB-1", "VRDB-2"]} />);
    expect(screen.getByText("Open PR")).toBeTruthy();
    expect(screen.getByText("API PR")).toBeTruthy(); // a different repo
    // Merged + closed PRs are now shown too, with a state label.
    expect(screen.getByText("Merged PR")).toBeTruthy();
    expect(screen.getByText("Closed PR")).toBeTruthy();
    expect(screen.getByText("Merged")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  it("sorts still-open PRs ahead of merged/closed", () => {
    setMock([]);
    setIssuePrsMock({
      "VRDB-1": [
        linkedPr({ url: "u-merged", title: "Merged one", status: "merged" }),
        linkedPr({ url: "u-open", title: "Open one", status: "open" }),
      ],
    });
    render(<PullRequestsCard sprintId={100} sprintKeys={["VRDB-1"]} />);
    const open = screen.getByText("Open one");
    const merged = screen.getByText("Merged one");
    // Open row appears before the merged row in document order.
    expect(open.compareDocumentPosition(merged) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows an approval badge from the linked PR's own decision", () => {
    setMock([]);
    setIssuePrsMock({
      "VRDB-1": [linkedPr({ url: "u1", title: "Approved PR", decision: "approved", approvals: 2, reviewers: ["a", "b"] })],
    });
    render(<PullRequestsCard sprintId={100} sprintKeys={["VRDB-1"]} />);
    expect(screen.getByText(/Approved ·2/)).toBeTruthy();
  });

  it("shows a changes-requested badge", () => {
    setMock([]);
    setIssuePrsMock({
      "VRDB-1": [linkedPr({ url: "u2", title: "Needs work", decision: "changes_requested" })],
    });
    render(<PullRequestsCard sprintId={100} sprintKeys={["VRDB-1"]} />);
    expect(screen.getByText(/Changes/)).toBeTruthy();
  });

  it("dedupes a linked PR already tracked in the manual list (by url)", () => {
    setMock([{ id: "m", url: "https://github.com/o/web/pull/10", addedAt: "t" }]);
    setIssuePrsMock({
      "VRDB-1": [linkedPr({ url: "https://github.com/o/web/pull/10", title: "Dup PR", status: "open" })],
    });
    render(<PullRequestsCard sprintId={100} sprintKeys={["VRDB-1"]} />);
    // The linked (auto) title is not shown a second time; the manual row remains.
    expect(screen.queryByText("Dup PR")).toBeNull();
  });

  it("empty state when no linked or manual PRs", () => {
    setMock([]);
    setIssuePrsMock({});
    render(<PullRequestsCard sprintId={100} sprintKeys={["VRDB-1"]} />);
    expect(screen.getByText(/No linked PRs for this sprint/i)).toBeTruthy();
  });
});
