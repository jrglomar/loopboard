// SprintGoalEditor tests — v1.13, ADR-024. Keyless/offline (setSprintGoal mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SprintGoalEditor } from "./SprintGoalEditor";

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    setSprintGoal: vi.fn(),
    // v1.59 (ADR-071): idle/empty shape (anti-drift parity — see Reports.test.tsx's comment).
    useMultiSprintReport: vi.fn().mockReturnValue({ data: null, loading: false, error: null, run: vi.fn() }),
  };
});

import * as useJiraModule from "../hooks/useJira";

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("SprintGoalEditor (v1.13)", () => {
  it("shows the current goal with an Edit affordance", () => {
    render(<SprintGoalEditor sprintId={55} goal="Ship checkout" />);
    expect(screen.getByText("Ship checkout")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit sprint goal/i })).toBeTruthy();
  });

  it("shows 'No goal set' when goal is null", () => {
    render(<SprintGoalEditor sprintId={55} goal={null} />);
    expect(screen.getByText(/No goal set/i)).toBeTruthy();
  });

  it("editing + Save calls set_sprint_goal and onSaved", async () => {
    vi.mocked(useJiraModule.setSprintGoal).mockResolvedValueOnce({ sprintId: 55, goal: "New goal" });
    const onSaved = vi.fn();
    render(<SprintGoalEditor sprintId={55} goal="Old goal" onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: /Edit sprint goal/i }));
    const box = screen.getByRole("textbox", { name: /Sprint goal/i }) as HTMLTextAreaElement;
    expect(box.value).toBe("Old goal");
    fireEvent.change(box, { target: { value: "New goal" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(vi.mocked(useJiraModule.setSprintGoal)).toHaveBeenCalledWith(55, "New goal");
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("New goal"));
  });

  it("surfaces an error and keeps editing on failure", async () => {
    vi.mocked(useJiraModule.setSprintGoal).mockRejectedValueOnce({ code: "UPSTREAM", message: "Sprint 55 not found" });
    render(<SprintGoalEditor sprintId={55} goal="Old" />);
    fireEvent.click(screen.getByRole("button", { name: /Edit sprint goal/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Sprint goal/i }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(await screen.findByText(/Sprint 55 not found/i)).toBeTruthy();
  });
});
