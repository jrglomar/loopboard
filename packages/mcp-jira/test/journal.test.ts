// Personal sprint journal (v1.47/v1.48, ADR-057/058) — notes feed + to-dos, per REAL user.
// Keyless/offline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache, USER_STORES_DIR } from "../src/lib/config.js";
import {
  getSprintJournal, addNote, deleteNote, addTodo, updateTodo, deleteTodo,
} from "../src/lib/journalStore.js";

let dir: string;
const USER = "user-aaa";
const OTHER = "user-bbb";
const SPRINT = 501;

function cleanStores() {
  fs.rmSync(path.join(USER_STORES_DIR, USER), { recursive: true, force: true });
  fs.rmSync(path.join(USER_STORES_DIR, OTHER), { recursive: true, force: true });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopboard-journal-"));
  process.env["JIRA_BASE_URL"] = "https://x.atlassian.net";
  process.env["JIRA_EMAIL"] = "x@example.com";
  process.env["JIRA_API_TOKEN"] = "t";
  process.env["JIRA_PO_BOARD_ID"] = "1";
  process.env["JIRA_DEV_BOARD_ID"] = "2";
  process.env["TASK_HELPER_FILE"] = path.join(dir, "users.json");
  resetConfigCache();
  cleanStores();
});

afterEach(() => {
  delete process.env["TASK_HELPER_FILE"];
  cleanStores();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("sprint journal — notes feed (ADR-058)", () => {
  it("starts empty", () => {
    expect(getSprintJournal(USER, SPRINT)).toEqual({ notes: [], todos: [] });
  });

  it("adds notes and returns them newest-first", async () => {
    addNote(USER, { sprintId: SPRINT, text: "first" });
    await new Promise((r) => setTimeout(r, 5)); // distinct createdAt
    addNote(USER, { sprintId: SPRINT, text: "second" });

    const { notes } = getSprintJournal(USER, SPRINT);
    expect(notes.map((n) => n.text)).toEqual(["second", "first"]);
    expect(notes[0]!.createdAt).toBeTruthy();
  });

  it("deletes a single note entry", () => {
    const n = addNote(USER, { sprintId: SPRINT, text: "throwaway" });
    expect(deleteNote(USER, n.id)).toBe(true);
    expect(getSprintJournal(USER, SPRINT).notes).toHaveLength(0);
    expect(deleteNote(USER, n.id)).toBe(false); // already gone
  });

  it("scopes notes per sprint", () => {
    addNote(USER, { sprintId: SPRINT, text: "in 501" });
    addNote(USER, { sprintId: 502, text: "in 502" });
    expect(getSprintJournal(USER, SPRINT).notes.map((n) => n.text)).toEqual(["in 501"]);
    expect(getSprintJournal(USER, 502).notes.map((n) => n.text)).toEqual(["in 502"]);
  });

  it("migrates v1.47 per-day notes into feed entries, once, with stable ids", () => {
    // Seed a legacy file: { notes: { "501": { "2026-07-10": "…" } }, todos: [] }
    const p = path.join(USER_STORES_DIR, USER, "journal.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      notes: { "501": { "2026-07-10": "legacy day note", "2026-07-09": "older" } },
      todos: [],
    }), "utf8");

    const first = getSprintJournal(USER, SPRINT);
    expect(first.notes.map((n) => n.text)).toEqual(["legacy day note", "older"]); // newest first
    // migration persisted → ids are stable across reads (so delete-by-id works)
    const second = getSprintJournal(USER, SPRINT);
    expect(second.notes.map((n) => n.id)).toEqual(first.notes.map((n) => n.id));
    expect(deleteNote(USER, first.notes[0]!.id)).toBe(true);
  });
});

describe("sprint journal — to-dos (ADR-057/058)", () => {
  it("adds a to-do, optionally tied to a ticket", () => {
    const t = addTodo(USER, { sprintId: SPRINT, text: "Write tests", ticketKey: "DEV-1" });
    expect(t.done).toBe(false);
    expect(t.ticketKey).toBe("DEV-1");
    expect(getSprintJournal(USER, SPRINT).todos).toHaveLength(1);
  });

  it("marks a to-do done (stamping doneAt) and undone again", () => {
    const t = addTodo(USER, { sprintId: SPRINT, text: "Ship it" });
    const done = updateTodo(USER, t.id, { done: true });
    expect(done!.done).toBe(true);
    expect(done!.doneAt).toBeTruthy();

    const undone = updateTodo(USER, t.id, { done: false });
    expect(undone!.done).toBe(false);
    expect(undone!.doneAt).toBeUndefined();
  });

  it("edits and deletes a to-do", () => {
    const t = addTodo(USER, { sprintId: SPRINT, text: "Old" });
    expect(updateTodo(USER, t.id, { text: "New" })!.text).toBe("New");
    expect(deleteTodo(USER, t.id)).toBe(true);
    expect(getSprintJournal(USER, SPRINT).todos).toHaveLength(0);
    expect(deleteTodo(USER, t.id)).toBe(false);
  });

  it("updateTodo returns null for an unknown id", () => {
    expect(updateTodo(USER, "nope", { done: true })).toBeNull();
  });

  it("scopes to-dos per sprint", () => {
    addTodo(USER, { sprintId: SPRINT, text: "in 501" });
    addTodo(USER, { sprintId: 502, text: "in 502" });
    expect(getSprintJournal(USER, SPRINT).todos.map((t) => t.text)).toEqual(["in 501"]);
    expect(getSprintJournal(USER, 502).todos.map((t) => t.text)).toEqual(["in 502"]);
  });
});

describe("sprint journal is PERSONAL", () => {
  it("one user's journal never leaks into another's", () => {
    addNote(USER, { sprintId: SPRINT, text: "mine" });
    addTodo(USER, { sprintId: SPRINT, text: "my task" });
    expect(getSprintJournal(OTHER, SPRINT)).toEqual({ notes: [], todos: [] });
  });
});
