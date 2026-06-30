// PrBadge component tests — v1.27, ADR-039. Keyless/offline.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PrBadge } from "./PrBadge";
import type { LinkedPr } from "../lib/types";

function pr(over: Partial<LinkedPr>): LinkedPr {
  return {
    url: "https://github.com/acme/web/pull/7",
    title: "Add login",
    repo: "acme/web",
    status: "open",
    decision: "review_required",
    approvals: 0,
    reviewers: [],
    ...over,
  };
}

afterEach(() => cleanup());

describe("PrBadge", () => {
  it("renders nothing when there are no linked PRs", () => {
    const { container } = render(<PrBadge prs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the PR count and links to the newest PR in a new tab", () => {
    render(
      <PrBadge
        prs={[
          pr({ url: "https://github.com/acme/web/pull/7", lastUpdate: "2026-06-01T00:00:00Z" }),
          pr({ url: "https://github.com/acme/api/pull/9", lastUpdate: "2026-06-10T00:00:00Z" }),
        ]}
      />
    );
    const link = screen.getByRole("link");
    expect(link.textContent).toContain("2"); // count
    expect(link).toHaveAttribute("href", "https://github.com/acme/api/pull/9"); // newest
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("aria-label")).toMatch(/2 linked pull requests/);
  });

  it("lists every PR in the title when there is more than one", () => {
    render(
      <PrBadge
        prs={[
          pr({ url: "a", title: "First PR", repo: "acme/web" }),
          pr({ url: "b", title: "Second PR", repo: "acme/api" }),
        ]}
      />
    );
    const link = screen.getByRole("link");
    const title = link.getAttribute("title") ?? "";
    expect(title).toContain("First PR");
    expect(title).toContain("Second PR");
  });
});
