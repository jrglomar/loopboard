// OffsetHistoryDialog tests — v1.33, ADR-044 (Phase 2). Keyless/offline.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OffsetHistoryDialog } from "./OffsetHistoryDialog";
import type { OffsetHistory } from "../lib/offsetWallet";

const HISTORY: OffsetHistory = {
  earned: 3, spent: 2, manual: 1, balance: 2,
  usage: [
    { date: "2026-06-10", sprintId: 2, sprintName: "Sprint Two" },
    { date: "2026-06-02", sprintId: 1, sprintName: "Sprint One" },
  ],
};

afterEach(() => cleanup());

describe("OffsetHistoryDialog (v1.33)", () => {
  it("shows the standing + usage list when open", () => {
    render(<OffsetHistoryDialog assignee="Alice" history={HISTORY} open onOpenChange={() => {}} />);
    expect(screen.getByText(/Offset history — Alice/)).toBeTruthy();
    const usage = screen.getByRole("list", { name: /Offset usage history/i });
    expect(usage.textContent).toContain("Sprint Two");
    expect(usage.textContent).toContain("Sprint One");
  });

  it("shows an empty state when no offsets were used", () => {
    render(
      <OffsetHistoryDialog
        assignee="Bob"
        history={{ earned: 0, spent: 0, manual: 0, balance: 0, usage: [] }}
        open
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByText(/No offsets used yet/i)).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    render(<OffsetHistoryDialog assignee={null} history={null} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText(/Offset history/)).toBeNull();
  });
});
