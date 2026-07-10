// Sprint journal (v1.47/v1.48, ADR-057/058) — the signed-in user's notes and to-do checklist for
// the selected sprint. Private to them (never shared with a credential owner, ADR-056).
//
// v1.48: notes are a QUICK-ADD FEED. Type a line, press Enter, it's saved with a timestamp and
// appears at the top. No date navigator, no Save button, no per-day bucket.

import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { NotebookPen, Plus, Trash2, Loader2, AlertCircle, ListTodo } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { isAuthApiError } from "../../lib/authClient";
import {
  getJournal, addNote, deleteNote, addTodo, updateTodo, deleteTodo,
  type JournalNote, type JournalTodo, type SprintJournal,
} from "../../lib/journalClient";
import type { MyIssue } from "../../lib/taskHelperClient";

function errMsg(err: unknown): string {
  return isAuthApiError(err) ? err.message : "Something went wrong";
}

/** "Today, 14:32" / "Mon 7 Jul, 09:05" — short, local, and unambiguous. */
export function formatStamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `Today, ${time}`;
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${time}`;
}

function NoteRow({ note, busy, onDelete }: { note: JournalNote; busy: boolean; onDelete: (n: JournalNote) => void }) {
  return (
    <li className="group flex items-start gap-2 py-1.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground whitespace-pre-wrap break-words">{note.text}</p>
        <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{formatStamp(note.createdAt)}</p>
      </div>
      <Button
        type="button" variant="ghost" size="sm" disabled={busy}
        aria-label={`Delete note "${note.text.slice(0, 40)}"`}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 px-1.5 flex-shrink-0"
        onClick={() => onDelete(note)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

function TodoRow({
  todo, busy, onToggle, onDelete,
}: {
  todo: JournalTodo;
  busy: boolean;
  onToggle: (t: JournalTodo) => void;
  onDelete: (t: JournalTodo) => void;
}) {
  return (
    <li className="flex items-center gap-2 py-1 group">
      <input
        type="checkbox"
        checked={todo.done}
        disabled={busy}
        onChange={() => onToggle(todo)}
        aria-label={`Mark "${todo.text}" as ${todo.done ? "not done" : "done"}`}
        className="h-4 w-4 flex-shrink-0 accent-[hsl(var(--primary))]"
      />
      <span className={cn("text-sm flex-1 min-w-0 break-words", todo.done && "line-through text-muted-foreground")}>
        {todo.text}
      </span>
      {todo.ticketKey && (
        <span className="text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary whitespace-nowrap">
          {todo.ticketKey}
        </span>
      )}
      <Button
        type="button" variant="ghost" size="sm" disabled={busy}
        aria-label={`Delete "${todo.text}"`}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 px-1.5"
        onClick={() => onDelete(todo)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

export function SprintJournalCard({ sprintId, issues }: { sprintId: number; issues: MyIssue[] }) {
  const [journal, setJournal] = useState<SprintJournal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null);

  const [newTodo, setNewTodo] = useState("");
  const [newTicket, setNewTicket] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyTodoId, setBusyTodoId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setJournal(await getJournal(sprintId));
    } catch (err) { setError(errMsg(err)); }
    finally { setLoading(false); }
  }, [sprintId]);

  useEffect(() => { void load(); }, [load]);

  async function submitNote(e?: FormEvent) {
    e?.preventDefault();
    const text = noteText.trim();
    if (!text) return;
    setSavingNote(true); setError(null);
    try {
      const created = await addNote(sprintId, text);
      setJournal((j) => (j ? { ...j, notes: [created, ...j.notes] } : j)); // newest first
      setNoteText("");
    } catch (err) { setError(errMsg(err)); }
    finally { setSavingNote(false); }
  }

  /** Enter saves; Shift+Enter keeps a newline (notes can be multi-line). */
  function onNoteKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitNote();
    }
  }

  async function removeNote(note: JournalNote) {
    setBusyNoteId(note.id); setError(null);
    try {
      await deleteNote(note.id);
      setJournal((j) => (j ? { ...j, notes: j.notes.filter((n) => n.id !== note.id) } : j));
    } catch (err) { setError(errMsg(err)); }
    finally { setBusyNoteId(null); }
  }

  async function submitTodo(e: FormEvent) {
    e.preventDefault();
    const text = newTodo.trim();
    if (!text) return;
    setAdding(true); setError(null);
    try {
      const created = await addTodo({ sprintId, text, ...(newTicket ? { ticketKey: newTicket } : {}) });
      setJournal((j) => (j ? { ...j, todos: [...j.todos, created] } : j));
      setNewTodo(""); setNewTicket("");
    } catch (err) { setError(errMsg(err)); }
    finally { setAdding(false); }
  }

  async function toggle(todo: JournalTodo) {
    setBusyTodoId(todo.id); setError(null);
    try {
      const updated = await updateTodo(todo.id, { done: !todo.done });
      setJournal((j) => (j ? { ...j, todos: j.todos.map((t) => (t.id === updated.id ? updated : t)) } : j));
    } catch (err) { setError(errMsg(err)); }
    finally { setBusyTodoId(null); }
  }

  async function removeTodo(todo: JournalTodo) {
    setBusyTodoId(todo.id); setError(null);
    try {
      await deleteTodo(todo.id);
      setJournal((j) => (j ? { ...j, todos: j.todos.filter((t) => t.id !== todo.id) } : j));
    } catch (err) { setError(errMsg(err)); }
    finally { setBusyTodoId(null); }
  }

  const notes = journal?.notes ?? [];
  const todos = journal?.todos ?? [];
  const open = todos.filter((t) => !t.done).length;
  const done = todos.length - open;

  if (loading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="px-4 py-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your notes…
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* ── Notes feed ── */}
      <Card className="shadow-sm">
        <CardHeader className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <NotebookPen className="h-4 w-4 text-primary" aria-hidden="true" /> Notes
            {notes.length > 0 && <span className="ml-auto text-xs font-normal text-muted-foreground">{notes.length}</span>}
          </h3>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <form onSubmit={(e) => void submitNote(e)} className="space-y-1.5">
            <Label htmlFor="journal-note" className="sr-only">Write a note</Label>
            <Textarea
              id="journal-note" rows={2} value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={onNoteKeyDown}
              placeholder="Write a note and press Enter…"
            />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={savingNote || !noteText.trim()}>
                {savingNote ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                  : <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />}
                Add note
              </Button>
              <span className="text-[0.6875rem] text-muted-foreground">Enter to save · Shift+Enter for a new line</span>
            </div>
          </form>

          {notes.length > 0 ? (
            <ul className="divide-y divide-border border-t border-border max-h-[320px] overflow-y-auto">
              {notes.map((n) => (
                <NoteRow key={n.id} note={n} busy={busyNoteId === n.id} onDelete={removeNote} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No notes yet for this sprint.</p>
          )}
        </CardContent>
      </Card>

      {/* ── To-do checklist ── */}
      <Card className="shadow-sm">
        <CardHeader className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <ListTodo className="h-4 w-4 text-primary" aria-hidden="true" /> To-do
            <span className="ml-auto text-xs font-normal text-muted-foreground">{open} open · {done} done</span>
          </h3>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <form onSubmit={(e) => void submitTodo(e)} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[160px]">
              <Label htmlFor="journal-todo" className="sr-only">New to-do</Label>
              <Input id="journal-todo" value={newTodo} onChange={(e) => setNewTodo(e.target.value)}
                placeholder="Add a to-do…" maxLength={500} />
            </div>
            <div className="min-w-[120px]">
              <Label htmlFor="journal-ticket" className="sr-only">Ticket (optional)</Label>
              <select
                id="journal-ticket"
                aria-label="Link to a ticket (optional)"
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={newTicket}
                onChange={(e) => setNewTicket(e.target.value)}
              >
                <option value="">No ticket</option>
                {issues.map((i) => <option key={i.key} value={i.key}>{i.key}</option>)}
              </select>
            </div>
            <Button type="submit" size="sm" disabled={adding || !newTodo.trim()}>
              {adding ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                : <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />}
              Add
            </Button>
          </form>

          {todos.length > 0 ? (
            <ul className="divide-y divide-border border-t border-border max-h-[320px] overflow-y-auto">
              {todos.map((t) => (
                <TodoRow key={t.id} todo={t} busy={busyTodoId === t.id} onToggle={toggle} onDelete={removeTodo} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing yet — add your first item.</p>
          )}
        </CardContent>
      </Card>

      {error && (
        <p className="lg:col-span-2 text-xs text-destructive flex items-center gap-1" role="alert">
          <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}
