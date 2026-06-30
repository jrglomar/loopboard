// prBadge.ts unit tests — v1.27, ADR-039. Pure; keyless/offline.

import { describe, it, expect } from "vitest";
import { summarizePrBadge } from "./prBadge";
import type { LinkedPr } from "./types";

function pr(over: Partial<LinkedPr>): LinkedPr {
  return {
    url: "https://github.com/acme/web/pull/1",
    title: "PR",
    repo: "acme/web",
    status: "open",
    decision: "review_required",
    approvals: 0,
    reviewers: [],
    ...over,
  };
}

describe("summarizePrBadge", () => {
  it("returns null when there are no PRs", () => {
    expect(summarizePrBadge(undefined)).toBeNull();
    expect(summarizePrBadge([])).toBeNull();
  });

  it("counts all PRs and reports how many are still open", () => {
    const info = summarizePrBadge([pr({ url: "a" }), pr({ url: "b", status: "merged" })]);
    expect(info).not.toBeNull();
    expect(info!.count).toBe(2);
    expect(info!.openCount).toBe(1);
  });

  it("tone = review for an open PR awaiting review", () => {
    expect(summarizePrBadge([pr({})])!.tone).toBe("review");
  });

  it("tone = approved when an open PR is approved and none request changes", () => {
    const info = summarizePrBadge([pr({ url: "a", decision: "approved", approvals: 1 })]);
    expect(info!.tone).toBe("approved");
  });

  it("tone = changes when any OPEN PR has changes requested (overrides approved)", () => {
    const info = summarizePrBadge([
      pr({ url: "a", decision: "approved", approvals: 1 }),
      pr({ url: "b", decision: "changes_requested" }),
    ]);
    expect(info!.tone).toBe("changes");
  });

  it("tone = done when every linked PR is merged/closed (none open)", () => {
    const info = summarizePrBadge([
      pr({ url: "a", status: "merged", decision: "approved" }),
      pr({ url: "b", status: "declined" }),
    ]);
    expect(info!.tone).toBe("done");
    expect(info!.openCount).toBe(0);
  });

  it("changes-requested on a MERGED pr does not force the changes tone", () => {
    // only open PRs count toward tone → merged changes_requested is ignored
    const info = summarizePrBadge([pr({ url: "a", status: "merged", decision: "changes_requested" })]);
    expect(info!.tone).toBe("done");
  });

  it("newest = the PR with the latest lastUpdate", () => {
    const older = pr({ url: "older", lastUpdate: "2026-06-01T00:00:00Z" });
    const newer = pr({ url: "newer", lastUpdate: "2026-06-20T00:00:00Z" });
    expect(summarizePrBadge([older, newer])!.newest.url).toBe("newer");
    expect(summarizePrBadge([newer, older])!.newest.url).toBe("newer");
  });
});
