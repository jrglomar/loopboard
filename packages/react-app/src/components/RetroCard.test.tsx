// RetroCard tests — v1.42, ADR-052. Presentational; keyless/offline.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { RetroCard } from "./RetroCard";
import type { RetroData } from "../lib/retroClient";

const save = vi.fn<(f: unknown) => Promise<void>>().mockResolvedValue(undefined);

const sample: RetroData = {
  reasonForDelays: "late scope",
  whatWorkedWell: "pairing",
  whatDidNotWork: "flaky CI",
  plannedImprovements: "stabilize CI",
  kudos: "Alice",
  updatedAt: "2026-07-06T10:00:00Z",
};

beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(undefined); });
afterEach(() => cleanup());

describe("RetroCard (v1.42)", () => {
  it("prompts to select a sprint when disabled", () => {
    render(<RetroCard retro={null} onSave={save} disabled />);
    expect(screen.getByText(/Select a sprint to record its retrospective/i)).toBeTruthy();
  });

  it("seeds the textareas from the stored retro", () => {
    render(<RetroCard retro={sample} onSave={save} />);
    expect((screen.getByLabelText(/Reason for delays/i) as HTMLTextAreaElement).value).toBe("late scope");
    expect((screen.getByLabelText(/What worked well/i) as HTMLTextAreaElement).value).toBe("pairing");
    expect((screen.getByLabelText(/Kudos/i) as HTMLTextAreaElement).value).toBe("Alice");
    expect(screen.getByText(/Saved/i)).toBeTruthy();
  });

  it("Save is disabled until a field changes, then persists all fields", async () => {
    render(<RetroCard retro={sample} onSave={save} />);
    const saveBtn = screen.getByRole("button", { name: /Save retrospective/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true); // pristine

    fireEvent.change(screen.getByLabelText(/What did not work well/i), {
      target: { value: "slow reviews" },
    });
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        reasonForDelays: "late scope",
        whatWorkedWell: "pairing",
        whatDidNotWork: "slow reviews",
        plannedImprovements: "stabilize CI",
        kudos: "Alice",
      })
    );
  });

  it("starts empty when no retro is stored yet", () => {
    render(<RetroCard retro={null} onSave={save} />);
    expect((screen.getByLabelText(/Kudos/i) as HTMLTextAreaElement).value).toBe("");
    // no "Saved <date>" stamp when nothing persisted
    expect(screen.queryByText(/^Saved /i)).toBeNull();
  });
});
