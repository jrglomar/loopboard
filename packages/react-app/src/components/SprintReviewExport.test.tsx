// SprintReviewExport tests — v1.35, ADR-045. Keyless/offline.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SprintReviewExport } from "./SprintReviewExport";
import type { SprintReport } from "../lib/types";

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
  byAssignee: [],
};

let capturedBlob: Blob | null = null;

beforeEach(() => {
  capturedBlob = null;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return "blob:x"; });
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SprintReviewExport (v1.35)", () => {
  it("opens the form with commitment prefilled from the report", () => {
    render(<SprintReviewExport report={REPORT} />);
    fireEvent.click(screen.getByRole("button", { name: /Full report \(CSV\)/i }));
    expect(screen.getByText(/Full sprint report — Sprint 5/)).toBeTruthy();
    expect((screen.getByLabelText(/Commitment points/i) as HTMLInputElement).value).toBe("40");
  });

  it("exports a Field/Value CSV that combines typed answers, pulled data, and fly-ins", async () => {
    render(<SprintReviewExport report={REPORT} />);
    fireEvent.click(screen.getByRole("button", { name: /Full report \(CSV\)/i }));

    fireEvent.change(screen.getByLabelText(/Team name/i), { target: { value: "QA Team" } });
    fireEvent.change(screen.getByLabelText(/Kudos/i), { target: { value: "Great sprint" } });
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(capturedBlob).toBeTruthy();
    // jsdom's Blob has no .text() — read it via FileReader.
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsText(capturedBlob!);
    });
    expect(text.split("\r\n")[0]).toBe("Field,Value");
    expect(text).toContain("Team name,QA Team");
    expect(text).toContain("Sprint goals,Ship it");
    expect(text).toContain("Completed points,32");
    expect(text).toContain("Kudos,Great sprint");
    expect(text).toContain("Fly-ins,DEV-7: Fly in: onsite QA"); // pulled via matchFlyIn
  });
});
