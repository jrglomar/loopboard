/**
 * Personal sprint journal (v1.47/v1.48, ADR-057/058) — the signed-in user's notes and to-do list
 * for a sprint. Host-local JSON, one file per user, mirroring the §4 store pattern
 * (tolerant read → {}, mkdir + write).
 *
 * v1.48 (ADR-058): notes are a **quick-add feed** of timestamped entries, not one note per day.
 * To-dos are sprint-scoped (no per-day bucket).
 *
 * ⚠ Keyed by the user's REAL id, never the credential-source id (ADR-056). Unlike the team
 * stores (leaves/retro/notes), a journal is PERSONAL: a shared-credential viewer keeps their own
 * notes rather than writing into the token owner's.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { USER_STORES_DIR } from "./config.js";

/** One note entry in the feed. */
export interface JournalNote {
  id: string;
  sprintId: number;
  text: string;
  createdAt: string; // ISO
}

/** One checklist item. `ticketKey` optionally ties it to a sprint ticket. */
export interface JournalTodo {
  id: string;
  sprintId: number;
  text: string;
  done: boolean;
  ticketKey?: string;
  createdAt: string; // ISO
  doneAt?: string; // ISO, set when marked done
}

/** Everything for one sprint: notes newest-first, to-dos oldest-first. */
export interface SprintJournal {
  notes: JournalNote[];
  todos: JournalTodo[];
}

interface JournalFile {
  notes: JournalNote[];
  todos: JournalTodo[];
}

function filePath(userId: string): string {
  return path.join(USER_STORES_DIR, userId, "journal.json");
}

/**
 * v1.47 stored notes as `{ [sprintId]: { [YYYY-MM-DD]: text } }`. Convert each day's note into a
 * feed entry (dated midday UTC so the ordering is stable). Migrated once, then persisted, so ids
 * stay stable across reads.
 */
function migrateLegacyNotes(raw: unknown): { notes: JournalNote[]; migrated: boolean } {
  if (Array.isArray(raw)) return { notes: raw as JournalNote[], migrated: false };
  if (raw === null || typeof raw !== "object") return { notes: [], migrated: false };

  const notes: JournalNote[] = [];
  for (const [sprintId, byDate] of Object.entries(raw as Record<string, unknown>)) {
    if (byDate === null || typeof byDate !== "object") continue;
    for (const [date, text] of Object.entries(byDate as Record<string, unknown>)) {
      if (typeof text !== "string" || text.trim() === "") continue;
      notes.push({
        id: crypto.randomUUID(),
        sprintId: Number(sprintId),
        text,
        createdAt: new Date(`${date}T12:00:00.000Z`).toISOString(),
      });
    }
  }
  return { notes, migrated: true };
}

function read(userId: string): JournalFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath(userId), "utf8"));
  } catch {
    return { notes: [], todos: [] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { notes: [], todos: [] };
  }
  const obj = parsed as { notes?: unknown; todos?: unknown };
  const { notes, migrated } = migrateLegacyNotes(obj.notes ?? []);
  const data: JournalFile = {
    notes,
    todos: Array.isArray(obj.todos) ? (obj.todos as JournalTodo[]) : [],
  };
  if (migrated) write(userId, data); // persist the converted entries so their ids are stable
  return data;
}

function write(userId: string, data: JournalFile): void {
  const p = filePath(userId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

/** Notes (newest first) + to-dos (oldest first) for one sprint. */
export function getSprintJournal(userId: string, sprintId: number): SprintJournal {
  const data = read(userId);
  return {
    notes: data.notes
      .filter((n) => n.sprintId === sprintId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    todos: data.todos
      .filter((t) => t.sprintId === sprintId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

export function addNote(userId: string, input: { sprintId: number; text: string }): JournalNote {
  const data = read(userId);
  const note: JournalNote = {
    id: crypto.randomUUID(),
    sprintId: input.sprintId,
    text: input.text,
    createdAt: new Date().toISOString(),
  };
  data.notes.push(note);
  write(userId, data);
  return note;
}

/** Remove a note entry. Returns false when it doesn't exist. */
export function deleteNote(userId: string, noteId: string): boolean {
  const data = read(userId);
  const next = data.notes.filter((n) => n.id !== noteId);
  if (next.length === data.notes.length) return false;
  data.notes = next;
  write(userId, data);
  return true;
}

export function addTodo(
  userId: string,
  input: { sprintId: number; text: string; ticketKey?: string }
): JournalTodo {
  const data = read(userId);
  const todo: JournalTodo = {
    id: crypto.randomUUID(),
    sprintId: input.sprintId,
    text: input.text,
    done: false,
    ...(input.ticketKey ? { ticketKey: input.ticketKey } : {}),
    createdAt: new Date().toISOString(),
  };
  data.todos.push(todo);
  write(userId, data);
  return todo;
}

/** Patch a to-do. Toggling `done` stamps/clears `doneAt`. Returns null when not found. */
export function updateTodo(
  userId: string,
  todoId: string,
  patch: { text?: string; done?: boolean; ticketKey?: string | null }
): JournalTodo | null {
  const data = read(userId);
  const todo = data.todos.find((t) => t.id === todoId);
  if (!todo) return null;
  if (patch.text !== undefined) todo.text = patch.text;
  if (patch.ticketKey !== undefined) {
    if (patch.ticketKey === null || patch.ticketKey === "") delete todo.ticketKey;
    else todo.ticketKey = patch.ticketKey;
  }
  if (patch.done !== undefined && patch.done !== todo.done) {
    todo.done = patch.done;
    if (patch.done) todo.doneAt = new Date().toISOString();
    else delete todo.doneAt;
  }
  write(userId, data);
  return todo;
}

/** Remove a to-do. Returns false when it doesn't exist. */
export function deleteTodo(userId: string, todoId: string): boolean {
  const data = read(userId);
  const next = data.todos.filter((t) => t.id !== todoId);
  if (next.length === data.todos.length) return false;
  data.todos = next;
  write(userId, data);
  return true;
}
