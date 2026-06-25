// MeetingGoalCard tests — v1.20, ADR-031. Keyless/offline (useMeetingGoal mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MeetingGoalCard } from "./MeetingGoalCard";
import type { MeetingGoal } from "../lib/types";

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return { ...actual, useMeetingGoal: vi.fn() };
});
import * as useJiraModule from "../hooks/useJira";

const save = vi.fn<(g: string) => Promise<void>>().mockResolvedValue(undefined);

function setMock(data: MeetingGoal | null) {
  vi.mocked(useJiraModule.useMeetingGoal).mockReturnValue({
    data, loading: false, error: null, run: vi.fn(), save,
  });
}

beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(undefined); });
afterEach(() => cleanup());

describe("MeetingGoalCard (v1.20)", () => {
  it("prompts to select a sprint when sprintId is null", () => {
    setMock(null);
    render(<MeetingGoalCard sprintId={null} />);
    expect(screen.getByText(/Select a sprint to set today's focus/i)).toBeTruthy();
  });

  it("shows an empty-state when no goal is set", () => {
    setMock({ sprintId: 100, goal: "", updatedAt: null });
    render(<MeetingGoalCard sprintId={100} />);
    expect(screen.getByText(/No goal — set the focus/i)).toBeTruthy();
  });

  it("renders the current goal", () => {
    setMock({ sprintId: 100, goal: "Unblock the release", updatedAt: "2026-06-25T00:00:00Z" });
    render(<MeetingGoalCard sprintId={100} />);
    expect(screen.getByText("Unblock the release")).toBeTruthy();
  });

  it("editing then saving calls save with the trimmed goal", async () => {
    setMock({ sprintId: 100, goal: "", updatedAt: null });
    render(<MeetingGoalCard sprintId={100} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit meeting goal/i }));
    fireEvent.change(screen.getByLabelText(/Meeting goal/i), { target: { value: "  Focus on QA  " } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("Focus on QA"));
  });
});
