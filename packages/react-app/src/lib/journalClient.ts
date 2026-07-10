// Personal sprint journal client (v1.47/v1.48, ADR-057/058) — the signed-in user's notes feed
// and to-do list for a sprint. Private to that user (never shared with a credential owner).

import { credFetch } from "./authClient";

/** One timestamped note entry in the feed. */
export interface JournalNote {
  id: string;
  sprintId: number;
  text: string;
  createdAt: string;
}

export interface JournalTodo {
  id: string;
  sprintId: number;
  text: string;
  done: boolean;
  ticketKey?: string;
  createdAt: string;
  doneAt?: string;
}

export interface SprintJournal {
  notes: JournalNote[]; // newest first
  todos: JournalTodo[]; // oldest first
}

export function getJournal(sprintId: number): Promise<SprintJournal> {
  return credFetch<SprintJournal>(`/api/me/journal?sprintId=${sprintId}`, "GET");
}

export function addNote(sprintId: number, text: string): Promise<JournalNote> {
  return credFetch<JournalNote>("/api/me/journal/notes", "POST", { sprintId, text });
}

export function deleteNote(id: string): Promise<{ deleted: boolean }> {
  return credFetch<{ deleted: boolean }>(`/api/me/journal/notes/${id}`, "DELETE");
}

export function addTodo(input: { sprintId: number; text: string; ticketKey?: string }): Promise<JournalTodo> {
  return credFetch<JournalTodo>("/api/me/journal/todos", "POST", input);
}

export function updateTodo(
  id: string,
  patch: { text?: string; done?: boolean; ticketKey?: string | null }
): Promise<JournalTodo> {
  return credFetch<JournalTodo>(`/api/me/journal/todos/${id}`, "PATCH", patch);
}

export function deleteTodo(id: string): Promise<{ deleted: boolean }> {
  return credFetch<{ deleted: boolean }>(`/api/me/journal/todos/${id}`, "DELETE");
}
