// PullRequestsCard tests — v1.16, ADR-027. Keyless/offline (usePullRequests mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { PullRequestsCard } from "./PullRequestsCard";
import type { PullRequest } from "../lib/types";

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return { ...actual, usePullRequests: vi.fn() };
});
import * as useJiraModule from "../hooks/useJira";

const save = vi.fn<(p: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

function setMock(data: PullRequest[] | null) {
  vi.mocked(useJiraModule.usePullRequests).mockReturnValue({
    data, loading: false, error: null, run: vi.fn(), save,
  });
}

beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(undefined); });
afterEach(() => cleanup());

describe("PullRequestsCard (v1.16)", () => {
  it("prompts to select a sprint when sprintId is null", () => {
    setMock([]);
    render(<PullRequestsCard sprintId={null} />);
    expect(screen.getByText(/Select a sprint to track pending PRs/i)).toBeTruthy();
  });

  it("renders an existing PR as a link with a short label", () => {
    setMock([{ id: "a", url: "https://github.com/o/repo/pull/42", addedAt: "t" }]);
    render(<PullRequestsCard sprintId={100} />);
    const link = screen.getByRole("link", { name: /Open pull request repo#42/i });
    expect(link.getAttribute("href")).toBe("https://github.com/o/repo/pull/42");
    expect(link.getAttribute("target")).toBe("_blank");
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
