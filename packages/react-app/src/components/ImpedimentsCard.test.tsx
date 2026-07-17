// ImpedimentsCard tests — v1.16, ADR-027. Keyless/offline (useImpediments mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ImpedimentsCard } from "./ImpedimentsCard";
import type { Impediment } from "../lib/types";

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useImpediments: vi.fn(),
    // v1.59 (ADR-071): idle/empty shape (anti-drift parity — see Reports.test.tsx's comment).
    useMultiSprintReport: vi.fn().mockReturnValue({ data: null, loading: false, error: null, run: vi.fn() }),
  };
});
import * as useJiraModule from "../hooks/useJira";

const save = vi.fn<(i: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

function setMock(data: Impediment[] | null) {
  vi.mocked(useJiraModule.useImpediments).mockReturnValue({
    data, loading: false, error: null, run: vi.fn(), save,
  });
}

beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(undefined); });
afterEach(() => cleanup());

describe("ImpedimentsCard (v1.16)", () => {
  it("prompts to select a sprint when sprintId is null", () => {
    setMock([]);
    render(<ImpedimentsCard sprintId={null} />);
    expect(screen.getByText(/Select a sprint to track impediments/i)).toBeTruthy();
  });

  it("renders existing impediments with their ticket key", () => {
    setMock([{ id: "a", text: "Waiting on infra", createdAt: "t", ticketKey: "DEV-1" }]);
    render(<ImpedimentsCard sprintId={100} />);
    expect(screen.getByText("Waiting on infra")).toBeTruthy();
    expect(screen.getByText("DEV-1")).toBeTruthy();
  });

  it("adding a blocker calls save with the new item appended", async () => {
    setMock([]);
    render(<ImpedimentsCard sprintId={100} />);
    fireEvent.change(screen.getByLabelText(/New impediment text/i), { target: { value: "Server down" } });
    fireEvent.click(screen.getByRole("button", { name: /Add/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith([{ text: "Server down" }]));
  });

  it("removing an impediment calls save without it", async () => {
    setMock([{ id: "a", text: "X", createdAt: "t" }]);
    render(<ImpedimentsCard sprintId={100} />);
    fireEvent.click(screen.getByRole("button", { name: /Remove impediment "X"/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith([]));
  });
});
