// LeaveStatusCard tests — v1.31, ADR-043. Keyless/offline (useAllLeaves mocked).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LeaveStatusCard } from "./LeaveStatusCard";

vi.mock("../hooks/useJira", () => ({ useAllLeaves: vi.fn() }));
import * as useJiraModule from "../hooks/useJira";

function setLeaves(data: Record<string, Record<string, Record<string, string>>>) {
  vi.mocked(useJiraModule.useAllLeaves).mockReturnValue({
    data: data as never, loading: false, error: null, run: vi.fn(), save: vi.fn(),
  });
}

afterEach(() => cleanup());

describe("LeaveStatusCard (v1.31)", () => {
  it("shows who is out today and who has upcoming leave", () => {
    setLeaves({
      "1": {
        Alice: { "2026-06-15": "VL", "2026-06-18": "Offset" },
        Bob: { "2026-06-15": "Holiday" },
      },
    });
    render(<LeaveStatusCard today="2026-06-15" />);

    // Out today: Alice + Bob
    const todayList = screen.getByRole("list", { name: /On leave today/i });
    expect(todayList.textContent).toContain("Alice");
    expect(todayList.textContent).toContain("Bob");
    expect(screen.getByText(/2 out today/i)).toBeTruthy(); // Alice + Bob

    // Upcoming: Alice on 06-18 (in 3 days)
    const upcoming = screen.getByRole("list", { name: /Upcoming leave/i });
    expect(upcoming.textContent).toContain("Alice");
    expect(upcoming.textContent).toMatch(/in 3d/i);
  });

  it("shows friendly empty states when nobody is on leave", () => {
    setLeaves({});
    render(<LeaveStatusCard today="2026-06-15" />);
    expect(screen.getByText(/Everyone's in today/i)).toBeTruthy();
    expect(screen.getByText(/No upcoming leave/i)).toBeTruthy();
  });
});
