// SprintJournalCard — v1.48, ADR-058. Notes are a quick-add feed. Keyless/offline.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SprintJournalCard, formatStamp } from "./SprintJournalCard";

vi.mock("../../lib/journalClient", () => ({
  getJournal: vi.fn(),
  addNote: vi.fn(),
  deleteNote: vi.fn(),
  addTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
}));
vi.mock("../../lib/authClient", () => ({
  isAuthApiError: (v: unknown) => typeof v === "object" && v !== null && "code" in v,
}));

import * as journalClient from "../../lib/journalClient";

const api = journalClient as unknown as Record<
  "getJournal" | "addNote" | "deleteNote" | "addTodo" | "updateTodo" | "deleteTodo",
  ReturnType<typeof vi.fn>
>;

const SPRINT = 501;
const ISSUES = [
  { key: "DEV-1", summary: "Fix login", status: "In Progress", url: "u" },
  { key: "DEV-2", summary: "Add endpoint", status: "To Do", url: "u" },
];

const note = (over: Record<string, unknown> = {}) => ({
  id: "n1", sprintId: SPRINT, text: "Paired on auth", createdAt: "2026-07-10T09:00:00Z", ...over,
});
const todo = (over: Record<string, unknown> = {}) => ({
  id: "t1", sprintId: SPRINT, text: "Write tests", done: false, createdAt: "2026-07-10T09:00:00Z", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getJournal.mockResolvedValue({ notes: [], todos: [] });
  api.addNote.mockImplementation((sprintId: number, text: string) => Promise.resolve(note({ id: "new", text, sprintId })));
  api.deleteNote.mockResolvedValue({ deleted: true });
  api.addTodo.mockImplementation((input: Record<string, unknown>) => Promise.resolve(todo({ id: "new", ...input })));
  api.updateTodo.mockImplementation((id: string, patch: Record<string, unknown>) => Promise.resolve(todo({ id, ...patch })));
  api.deleteTodo.mockResolvedValue({ deleted: true });
});
afterEach(() => cleanup());

describe("formatStamp", () => {
  it("says 'Today' for the same calendar day", () => {
    const now = new Date("2026-07-10T18:00:00");
    expect(formatStamp(new Date("2026-07-10T09:05:00").toISOString(), now)).toMatch(/^Today, /);
  });

  it("shows the weekday + date for other days", () => {
    const now = new Date("2026-07-10T18:00:00");
    expect(formatStamp(new Date("2026-07-08T09:05:00").toISOString(), now)).not.toMatch(/^Today/);
  });
});

describe("SprintJournalCard — notes feed (v1.48)", () => {
  it("loads the journal for the sprint", async () => {
    render(<SprintJournalCard sprintId={SPRINT} issues={ISSUES} />);
    await waitFor(() => expect(api.getJournal).toHaveBeenCalledWith(SPRINT));
  });

  it("has no date navigator or Save button any more", async () => {
    render(<SprintJournalCard sprintId={SPRINT} issues={ISSUES} />);
    await waitFor(() => screen.getByLabelText("Write a note"));
    expect(screen.queryByLabelText("Day")).toBeNull();
    expect(screen.queryByRole("button", { name: /save note/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^today$/i })).toBeNull();
  });

  it("adds a note with the Add button and clears the box", async () => {
    render(<SprintJournalCard sprintId={SPRINT} issues={ISSUES} />);
    await waitFor(() => screen.getByLabelText("Write a note"));

    const box = screen.getByLabelText("Write a note");
    fireEvent.change(box, { target: { value: "Shipped the fix" } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith(SPRINT, "Shipped the fix"));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(""));
    expect(screen.getByText("Shipped the fix")).toBeTruthy();
  });

  it("saves on Enter, and Shift+Enter does not save", async () => {
    render(<SprintJournalCard sprintId={SPRINT} issues={ISSUES} />);
    await waitFor(() => screen.getByLabelText("Write a note"));
    const box = screen.getByLabelText("Write a note");

    fireEvent.change(box, { target: { value: "quick note" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(api.addNote).not.toHaveBeenCalled(); // Shift+Enter = newline

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith(SPRINT, "quick note"));
  });

  it("does not save an empty/whitespace note", async () => {
    render(<SprintJournalCard sprintId={SPRINT} issues={ISSUES} />);
    await waitFor(() => screen.getByLabelText("Write a note"));
    const box = screen.getByLabelText("Write a note");

    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(api.addNote).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /add note/i }).hasAttribute("disabled")).toBe(true);
  });

  it("lists notes newest-first and deletes one", async () => {
    api.getJournal.mockResolvedValue({
      notes: [note({ id: "n2", text: "newer" }), note({ id: "n1", text: "older" })],
      todos: [],
    });
    render(<SprintJournalCard sprintId={SPRINT} issues={ISSUES} />);
    await waitFor(() => screen.getByText("newer"));

    fireEvent.click(screen.getByRole("button", { name: /delete note "newer"/i }));
    await waitFor(() => expect(api.deleteNote).toHaveBeenCalledWith("n2"));
    await waitFor(() => expect(screen.queryByText("newer")).toBeNull());
    expect(screen.getByText("older")).toBeTruthy();
  });
});

describe("SprintJournalCard — to-dos", () => {
  it("adds a to-do tied to a sprint ticket (no date)", async () => {
    render(<SprintJournalCard sprintId={SPRINT} issues={ISSUES} />);
    await waitFor(() => screen.getByLabelText("New to-do"));

    fireEvent.change(screen.getByLabelText("New to-do"), { target: { value: "Write the migration test" } });
    fireEvent.change(screen.getByLabelText(/link to a ticket/i), { target: { value: "DEV-2" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() =>
      expect(api.addTodo).toHaveBeenCalledWith({ sprintId: SPRINT, text: "Write the migration test", ticketKey: "DEV-2" })
    );
    await waitFor(() => expect(screen.getByText("Write the migration test")).toBeTruthy());
  });

  it("marks a to-do done", async () => {
    api.getJournal.mockResolvedValue({ notes: [], todos: [todo()] });
    render(<SprintJournalCard sprintId={SPRINT} issues={ISSUES} />);
    await waitFor(() => screen.getByText("Write tests"));

    fireEvent.click(screen.getByRole("checkbox", { name: /mark "write tests" as done/i }));
    await waitFor(() => expect(api.updateTodo).toHaveBeenCalledWith("t1", { done: true }));
  });

  it("deletes a to-do and counts open/done", async () => {
    api.getJournal.mockResolvedValue({ notes: [], todos: [todo(), todo({ id: "t2", text: "Done one", done: true })] });
    render(<SprintJournalCard sprintId={SPRINT} issues={ISSUES} />);
    await waitFor(() => screen.getByText("Write tests"));
    expect(screen.getByText(/1 open · 1 done/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /delete "write tests"/i }));
    await waitFor(() => expect(api.deleteTodo).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.queryByText("Write tests")).toBeNull());
  });
});
