// MeetingNotesCard tests — v1.41, ADR-051. Keyless/offline: useMeetingNotes mocked and the
// TipTap editor stubbed with a textarea (ProseMirror needs real-DOM APIs jsdom lacks).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MeetingNotesCard } from "./MeetingNotesCard";

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return { ...actual, useMeetingNotes: vi.fn() };
});

// Stub the WYSIWYG editor: a textarea that forwards raw HTML through onChange.
vi.mock("./RichTextEditor", () => ({
  RichTextEditor: ({ initialHtml, onChange }: { initialHtml: string; onChange: (h: string) => void }) => (
    <textarea
      aria-label="Meeting notes editor"
      defaultValue={initialHtml}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import * as useJiraModule from "../hooks/useJira";

const mockState = (over: Partial<ReturnType<typeof useJiraModule.useMeetingNotes>> = {}) => ({
  data: null,
  loading: false,
  error: null,
  run: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
  ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("MeetingNotesCard (v1.41)", () => {
  it("renders saved notes as HTML with links opening in a new tab", () => {
    vi.mocked(useJiraModule.useMeetingNotes).mockReturnValue(mockState({
      data: {
        html: '<p>Deploy v2 — <a href="https://wiki/runbook">runbook</a></p>',
        updatedAt: "2026-07-04T10:00:00.000Z",
      },
    }));
    render(<MeetingNotesCard sprintId={100} />);

    const link = screen.getByRole("link", { name: "runbook" });
    expect(link.getAttribute("href")).toBe("https://wiki/runbook");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/Updated/)).toBeTruthy();
  });

  it("sanitizes stored HTML on render (scripts/handlers stripped)", () => {
    vi.mocked(useJiraModule.useMeetingNotes).mockReturnValue(mockState({
      data: {
        html: '<p>ok</p><script>window.__pwned = true</script><img src=x onerror="window.__pwned=true" />',
        updatedAt: "2026-07-04T10:00:00.000Z",
      },
    }));
    const { container } = render(<MeetingNotesCard sprintId={100} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("onerror") ?? null).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("shows the empty state and opens the editor via 'Add notes'", () => {
    vi.mocked(useJiraModule.useMeetingNotes).mockReturnValue(mockState());
    render(<MeetingNotesCard sprintId={100} />);

    expect(screen.getByText(/No notes yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add notes" }));
    expect(screen.getByLabelText("Meeting notes editor")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save notes" })).toBeTruthy();
  });

  it("saves the edited (sanitized) HTML and returns to view mode", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useJiraModule.useMeetingNotes).mockReturnValue(mockState({ save }));
    render(<MeetingNotesCard sprintId={100} />);

    fireEvent.click(screen.getByRole("button", { name: "Add notes" }));
    fireEvent.change(screen.getByLabelText("Meeting notes editor"), {
      target: { value: '<p>Deploy at 9pm <script>evil()</script></p>' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const savedHtml = save.mock.calls[0]![0] as string;
    expect(savedHtml).toContain("Deploy at 9pm");
    expect(savedHtml).not.toContain("<script>"); // sanitized before persisting
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save notes" })).toBeNull());
  });

  it("an emptied editor clears the notes (saves empty string)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useJiraModule.useMeetingNotes).mockReturnValue(mockState({
      data: { html: "<p>old</p>", updatedAt: "2026-07-04T10:00:00.000Z" },
      save,
    }));
    render(<MeetingNotesCard sprintId={100} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Meeting notes editor"), { target: { value: "<p>  </p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(""));
  });
});
