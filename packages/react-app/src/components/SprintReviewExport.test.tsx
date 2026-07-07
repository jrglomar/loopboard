// SprintReviewExport tests — v1.35 (ADR-045) + v1.38 (ADR-048). Keyless/offline.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SprintReviewExport } from "./SprintReviewExport";
import type { SprintReport } from "../lib/types";
import type { LeavesMap } from "../lib/leavesClient";
import type { OffsetLedger } from "../lib/offsetClient";

const REPORT: SprintReport = {
  sprint: {
    id: 5, name: "Sprint 5", state: "closed",
    startDate: "2026-06-01", endDate: "2026-06-12", completeDate: "2026-06-12", goal: "Ship it", boardId: 1,
  },
  committedPoints: 40, completedPoints: 32, completionRate: 0.8,
  totalCount: 3, completedCount: 2, carryoverCount: 1, blockedCount: 0,
  completed: [
    { key: "DEV-7", summary: "Fly in: onsite QA", status: "Done", statusCategory: "done", assignee: "Al", assigneeAccountId: null, storyPoints: 3, issueType: "Story", url: "u", blocked: false },
  ],
  notCompleted: [],
  byAssignee: [{ name: "Al", donePoints: 32, totalPoints: 40, doneCount: 2, totalCount: 3 }],
};

// Al: 1 VL on a sprint working day (2026-06-01 is a Monday).
const LEAVES: LeavesMap = { Al: { "2026-06-01": "VL" } };
const LEDGER: OffsetLedger = { Al: { earned: 1, spent: 0, manualAdjust: 0, balance: 1 } };

function renderExport() {
  return render(<SprintReviewExport report={REPORT} leaves={LEAVES} ledger={LEDGER} requiredPoints={8} roster={["Al"]} />);
}

let capturedBlob: Blob | null = null;

beforeEach(() => {
  capturedBlob = null;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return "blob:x"; });
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: /Full report/i }));
}

describe("SprintReviewExport", () => {
  it("prefills commitment from team capacity (N − leaves), not Jira committed", () => {
    renderExport();
    openForm();
    expect(screen.getByText(/Full sprint report — Sprint 5/)).toBeTruthy();
    // Al has 1 leave day (VL on 2026-06-01) → capacity = 8 − 1 = 7 (NOT the 40 committed points).
    expect((screen.getByLabelText(/Commitment points/i) as HTMLInputElement).value).toBe("7");
  });

  it("v1.39: the footer offers exactly Cancel · Download as PDF · Download as CSV (Styled Format)", () => {
    renderExport();
    openForm();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download as PDF/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download as CSV \(Styled Format\)/i })).toBeTruthy();
    // the plain Field/Value CSV button is gone
    expect(screen.queryByRole("button", { name: /^CSV$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Excel/i })).toBeNull();
  });

  it("v1.38: 'Download as CSV (Styled Format)' downloads the styled workbook", () => {
    renderExport();
    openForm();
    fireEvent.click(screen.getByRole("button", { name: /Download as CSV \(Styled Format\)/i }));

    expect(capturedBlob).toBeTruthy();
    expect(capturedBlob!.type).toContain("spreadsheetml"); // styled workbook mimetype
    expect(capturedBlob!.size).toBeGreaterThan(0);
  });

  it("v1.38: 'Download as PDF' opens a print-ready HTML report with the per-member table", () => {
    const written: string[] = [];
    const fakeWin = {
      document: { open: vi.fn(), write: vi.fn((h: string) => written.push(h)), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);

    renderExport();
    openForm();
    fireEvent.click(screen.getByRole("button", { name: /Download as PDF/i }));

    expect(openSpy).toHaveBeenCalled();
    const html = written.join("");
    expect(html).toContain("Sprint Review");
    expect(html).toContain("Per-member");
    expect(html).toContain("Al"); // the member row rendered
  });

  // v1.42 (ADR-052): the retro pre-fills the form + typed values persist back on export.
  it("v1.42: prefills the retro fields from the persisted retro prop", () => {
    render(
      <SprintReviewExport
        report={REPORT} leaves={LEAVES} ledger={LEDGER} requiredPoints={8} roster={["Al"]}
        retro={{
          reasonForDelays: "late scope", whatWorkedWell: "pairing",
          whatDidNotWork: "flaky CI", plannedImprovements: "stabilize CI", kudos: "Al",
        }}
      />
    );
    openForm();
    expect((screen.getByLabelText(/Reason for delays/i) as HTMLTextAreaElement).value).toBe("late scope");
    expect((screen.getByLabelText(/What worked well/i) as HTMLTextAreaElement).value).toBe("pairing");
    expect((screen.getByLabelText(/Kudos/i) as HTMLTextAreaElement).value).toBe("Al");
  });

  it("v1.42: persists typed retro fields back to the store on export", () => {
    const onPersistRetro = vi.fn().mockResolvedValue(undefined);
    render(
      <SprintReviewExport
        report={REPORT} leaves={LEAVES} ledger={LEDGER} requiredPoints={8} roster={["Al"]}
        retro={null} onPersistRetro={onPersistRetro}
      />
    );
    openForm();
    fireEvent.change(screen.getByLabelText(/What worked well/i), { target: { value: "shipped early" } });
    fireEvent.click(screen.getByRole("button", { name: /Download as CSV \(Styled Format\)/i }));

    expect(onPersistRetro).toHaveBeenCalledWith(
      expect.objectContaining({ whatWorkedWell: "shipped early" })
    );
  });
});
