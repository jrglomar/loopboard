// ticketCells tests — v1.69, ADR-080
// Direct/unit coverage for SummaryCell (new) and PointsCell's onSaved callback.
// StatusCell/MoveSprintCell/PointsCell's core behavior is already covered via
// AssignmentList.test.tsx (moved verbatim); this file focuses on what's NEW here.
// Keyless/offline — updateTicketPoints/updateTicketSummary (../hooks/useJira) mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { PointsCell, SummaryCell } from "./ticketCells";
import type { IssueSummary } from "../lib/types";

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    updateTicketPoints: vi.fn(),
    updateTicketSummary: vi.fn(),
  };
});

// ticketActionsClient isn't exercised by these two cells, but ticketCells.tsx
// imports it at module scope (StatusCell/MoveSprintCell) — mock it so nothing
// in this file accidentally reaches a real network call.
vi.mock("../lib/ticketActionsClient", () => ({
  getTransitions: vi.fn(),
  transitionIssue: vi.fn(),
  moveIssueToSprint: vi.fn(),
}));

import * as useJiraModule from "../hooks/useJira";

const ISSUE: IssueSummary = {
  key: "PO-1",
  summary: "Original summary",
  status: "To Do",
  statusCategory: "todo",
  assignee: null,
  assigneeAccountId: null,
  storyPoints: 5,
  issueType: "Story",
  url: "https://jira.example.com/browse/PO-1",
  blocked: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useJiraModule.updateTicketSummary).mockResolvedValue({
    key: "PO-1", url: ISSUE.url, updatedFields: ["summary"],
  });
  vi.mocked(useJiraModule.updateTicketPoints).mockResolvedValue({
    key: "PO-1", url: ISSUE.url, updatedFields: ["storyPoints"],
  });
});

afterEach(() => {
  cleanup();
});

// ── SummaryCell ───────────────────────────────────────────────────────────────

describe("SummaryCell — collapsed state", () => {
  it("renders the truncatable summary text and a Rename button", () => {
    render(<SummaryCell issue={ISSUE} onSaved={vi.fn()} />);
    expect(screen.getByText("Original summary")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename PO-1" })).toBeTruthy();
  });
});

describe("SummaryCell — save", () => {
  it("opens prefilled with the FULL summary, saves on Save click, and calls onSaved", async () => {
    const onSaved = vi.fn();
    render(<SummaryCell issue={ISSUE} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));

    const input = screen.getByRole("textbox", { name: "New summary for PO-1" }) as HTMLInputElement;
    expect(input.value).toBe("Original summary");
    expect(input.maxLength).toBe(255);

    fireEvent.change(input, { target: { value: "Renamed summary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save summary for PO-1" }));

    await waitFor(() =>
      expect(vi.mocked(useJiraModule.updateTicketSummary)).toHaveBeenCalledWith("PO-1", "Renamed summary")
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // Collapses back to the read view showing the new summary.
    await waitFor(() => expect(screen.getByText("Renamed summary")).toBeTruthy());
    expect(screen.queryByRole("textbox", { name: "New summary for PO-1" })).toBeNull();
  });

  it("Enter saves the same way as clicking Save", async () => {
    const onSaved = vi.fn();
    render(<SummaryCell issue={ISSUE} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));

    const input = screen.getByRole("textbox", { name: "New summary for PO-1" });
    fireEvent.change(input, { target: { value: "Renamed via Enter" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(vi.mocked(useJiraModule.updateTicketSummary)).toHaveBeenCalledWith("PO-1", "Renamed via Enter")
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("does not write when the value is unchanged", async () => {
    const onSaved = vi.fn();
    render(<SummaryCell issue={ISSUE} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));

    fireEvent.click(screen.getByRole("button", { name: "Save summary for PO-1" }));

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "New summary for PO-1" })).toBeNull();
    });
    expect(vi.mocked(useJiraModule.updateTicketSummary)).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("SummaryCell — cancel / Escape", () => {
  it("Cancel button reverts the draft and collapses without writing", async () => {
    render(<SummaryCell issue={ISSUE} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));

    const input = screen.getByRole("textbox", { name: "New summary for PO-1" });
    fireEvent.change(input, { target: { value: "Discarded edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel rename for PO-1" }));

    expect(screen.queryByRole("textbox", { name: "New summary for PO-1" })).toBeNull();
    expect(screen.getByText("Original summary")).toBeTruthy();
    expect(vi.mocked(useJiraModule.updateTicketSummary)).not.toHaveBeenCalled();
  });

  it("Escape reverts the draft and collapses without writing", async () => {
    render(<SummaryCell issue={ISSUE} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));

    const input = screen.getByRole("textbox", { name: "New summary for PO-1" });
    fireEvent.change(input, { target: { value: "Discarded via escape" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "New summary for PO-1" })).toBeNull();
    expect(screen.getByText("Original summary")).toBeTruthy();
    expect(vi.mocked(useJiraModule.updateTicketSummary)).not.toHaveBeenCalled();
  });
});

describe("SummaryCell — empty/whitespace-only reverts", () => {
  it("rejects an empty save by reverting, without writing", async () => {
    render(<SummaryCell issue={ISSUE} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));

    const input = screen.getByRole("textbox", { name: "New summary for PO-1" });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.queryByRole("textbox", { name: "New summary for PO-1" })).toBeNull();
    expect(screen.getByText("Original summary")).toBeTruthy();
    expect(vi.mocked(useJiraModule.updateTicketSummary)).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only save by reverting, without writing", async () => {
    render(<SummaryCell issue={ISSUE} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));

    const input = screen.getByRole("textbox", { name: "New summary for PO-1" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save summary for PO-1" }));

    expect(screen.queryByRole("textbox", { name: "New summary for PO-1" })).toBeNull();
    expect(screen.getByText("Original summary")).toBeTruthy();
    expect(vi.mocked(useJiraModule.updateTicketSummary)).not.toHaveBeenCalled();
  });
});

describe("SummaryCell — error", () => {
  it("shows an inline aria-live error, reverts the value, and stays open on failure", async () => {
    vi.mocked(useJiraModule.updateTicketSummary).mockRejectedValueOnce({
      code: "UPSTREAM", message: "Jira rejected the rename",
    });
    const onSaved = vi.fn();
    render(<SummaryCell issue={ISSUE} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));

    const input = screen.getByRole("textbox", { name: "New summary for PO-1" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Doomed edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save summary for PO-1" }));

    await waitFor(() => expect(screen.getByText(/Jira rejected the rename/i)).toBeTruthy());
    // Stays open (editor still present) with the value reverted.
    const stillOpen = screen.getByRole("textbox", { name: "New summary for PO-1" }) as HTMLInputElement;
    expect(stillOpen.value).toBe("Original summary");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("disables the input and buttons while saving", async () => {
    let resolve!: (v: { key: string; url: string; updatedFields: string[] }) => void;
    const pending = new Promise<{ key: string; url: string; updatedFields: string[] }>((res) => { resolve = res; });
    vi.mocked(useJiraModule.updateTicketSummary).mockReturnValueOnce(pending);

    render(<SummaryCell issue={ISSUE} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));
    const input = screen.getByRole("textbox", { name: "New summary for PO-1" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Mid-flight edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save summary for PO-1" }));

    await waitFor(() => expect(input.disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Save summary for PO-1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel rename for PO-1" }) as HTMLButtonElement).disabled).toBe(true);

    resolve({ key: "PO-1", url: ISSUE.url, updatedFields: ["summary"] });
  });
});

// ── PointsCell — onSaved (v1.69, ADR-080) ───────────────────────────────────────

describe("PointsCell — onSaved callback", () => {
  it("calls onSaved after a successful points write", async () => {
    const onSaved = vi.fn();
    render(<PointsCell issue={ISSUE} onSaved={onSaved} />);
    const input = screen.getByLabelText("Story points for PO-1") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(vi.mocked(useJiraModule.updateTicketPoints)).toHaveBeenCalledWith("PO-1", 8)
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("does not call onSaved when the write fails", async () => {
    vi.mocked(useJiraModule.updateTicketPoints).mockRejectedValueOnce({ code: "UPSTREAM", message: "nope" });
    const onSaved = vi.fn();
    render(<PointsCell issue={ISSUE} onSaved={onSaved} />);
    const input = screen.getByLabelText("Story points for PO-1") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "13" } });
    fireEvent.blur(input);

    await waitFor(() => expect(input.value).toBe("5")); // reverted
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("works without an onSaved prop (optional callback, no crash on success)", async () => {
    render(<PointsCell issue={ISSUE} />);
    const input = screen.getByLabelText("Story points for PO-1") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(vi.mocked(useJiraModule.updateTicketPoints)).toHaveBeenCalledWith("PO-1", 3)
    );
  });
});
