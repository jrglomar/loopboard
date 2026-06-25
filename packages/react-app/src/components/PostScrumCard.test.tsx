// PostScrumCard tests — v1.20, ADR-031. Keyless/offline (usePostScrum + useTeamMembers mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { PostScrumCard } from "./PostScrumCard";
import type { PostScrumNote } from "../lib/types";

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return { ...actual, usePostScrum: vi.fn(), useTeamMembers: vi.fn() };
});
import * as useJiraModule from "../hooks/useJira";

const save = vi.fn<(n: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

function setMock(data: PostScrumNote[] | null) {
  vi.mocked(useJiraModule.usePostScrum).mockReturnValue({
    data, loading: false, error: null, run: vi.fn(), save,
  });
  vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
    data: [{ accountId: "u1", displayName: "Alice" }], loading: false, error: null, run: vi.fn(), save: vi.fn(),
  });
}

beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(undefined); });
afterEach(() => cleanup());

describe("PostScrumCard (v1.20)", () => {
  it("prompts to select a sprint when sprintId is null", () => {
    setMock([]);
    render(<PostScrumCard sprintId={null} />);
    expect(screen.getByText(/Select a sprint to track post-scrum notes/i)).toBeTruthy();
  });

  it("groups notes by person", () => {
    setMock([
      { id: "a", person: "Alice", note: "ask infra", createdAt: "t" },
      { id: "b", person: "Bob", note: "review API", createdAt: "t" },
      { id: "c", person: "Alice", note: "follow up", createdAt: "t" },
    ]);
    render(<PostScrumCard sprintId={100} />);
    expect(screen.getByText("ask infra")).toBeTruthy();
    expect(screen.getByText("follow up")).toBeTruthy();
    expect(screen.getByText("review API")).toBeTruthy();
    // Person headings present (Alice appears once as a heading).
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText("Bob")).toBeTruthy();
  });

  it("adding a note calls save with person + note appended", async () => {
    setMock([]);
    render(<PostScrumCard sprintId={100} boardId={10} />);
    fireEvent.change(screen.getByLabelText(/^Person$/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/Post-scrum note/i), { target: { value: "ping QA" } });
    fireEvent.click(screen.getByRole("button", { name: /Add post-scrum note/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([{ person: "Alice", note: "ping QA" }])
    );
  });

  it("removing a note calls save without it", async () => {
    setMock([{ id: "a", person: "Alice", note: "ask infra", createdAt: "t" }]);
    render(<PostScrumCard sprintId={100} />);
    fireEvent.click(screen.getByRole("button", { name: /Remove note "ask infra"/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith([]));
  });
});
