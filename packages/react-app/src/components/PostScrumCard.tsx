// PostScrumCard — Huddle post-scrum tracking (v1.20, ADR-031).
// Per-sprint, per-person "parking-lot" notes captured after the standup, so they're tracked.
// Backed by usePostScrum (set_* full-replace); person suggestions from the team roster.

import { useState, useMemo } from "react";
import { ClipboardList, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePostScrum, useTeamMembers } from "../hooks/useJira";
import type { PostScrumInput } from "../lib/postScrumClient";
import type { PostScrumNote } from "../lib/types";

export function PostScrumCard({ sprintId, boardId }: { sprintId: number | null; boardId?: number }) {
  const { data, loading, error, save } = usePostScrum(sprintId);
  const { data: roster } = useTeamMembers(boardId ?? null);
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const items = data ?? [];

  // Group notes by person for the "tracking" view.
  const grouped = useMemo(() => {
    const map = new Map<string, PostScrumNote[]>();
    for (const n of items) {
      const list = map.get(n.person) ?? [];
      list.push(n);
      map.set(n.person, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  async function persist(next: PostScrumInput[]) {
    setBusy(true);
    try { await save(next); } catch { /* hook reverts on error */ } finally { setBusy(false); }
  }

  async function add() {
    const p = person.trim();
    const t = note.trim();
    if (!p || !t || sprintId === null) return;
    const next: PostScrumInput[] = [...items, { person: p, note: t }];
    setNote("");
    await persist(next);
  }

  const remove = (id: string) => void persist(items.filter((n) => n.id !== id));

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-3 pt-3 pb-1.5">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <ClipboardList className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Post-scrum
          {items.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
          )}
        </h3>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {sprintId === null ? (
          <p className="text-sm text-muted-foreground">Select a sprint to track post-scrum notes.</p>
        ) : (
          <>
            {/* Add form */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="w-28">
                <label htmlFor="ps-person" className="sr-only">Person</label>
                <Input
                  id="ps-person"
                  list="ps-roster"
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                  placeholder="Who?"
                  className="h-8"
                  aria-label="Person"
                />
                <datalist id="ps-roster">
                  {(roster ?? []).map((m) => <option key={m.accountId} value={m.displayName} />)}
                </datalist>
              </div>
              <div className="flex-1 min-w-[120px]">
                <label htmlFor="ps-note" className="sr-only">Note</label>
                <Input
                  id="ps-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                  placeholder="Follow-up…"
                  className="h-8"
                  aria-label="Post-scrum note"
                />
              </div>
              <Button type="button" size="sm" className="h-8" onClick={() => void add()} disabled={busy || !person.trim() || !note.trim()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Add post-scrum note</span>
              </Button>
            </div>

            {error && <p className="text-xs text-destructive" role="alert">{error.message}</p>}
            {loading && items.length === 0 && <p className="text-xs text-muted-foreground">Loading…</p>}

            {/* Grouped list */}
            {items.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">No post-scrum notes yet.</p>
            ) : (
              <ul className="space-y-2" role="list">
                {grouped.map(([who, notes]) => (
                  <li key={who}>
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">{who}</p>
                    <ul className="mt-0.5 space-y-1" role="list">
                      {notes.map((n) => (
                        <li key={n.id} className="flex items-start gap-1.5 text-sm">
                          <span className="flex-1 min-w-0 text-foreground">{n.note}</span>
                          <button
                            type="button"
                            onClick={() => remove(n.id)}
                            className="text-muted-foreground hover:text-destructive focus:outline-none focus:ring-1 focus:ring-ring rounded flex-shrink-0"
                            aria-label={`Remove note "${n.note}"`}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
