// ImpedimentsCard — Huddle blockers/impediments log (v1.16, ADR-027).
// Manual, per-sprint list for daily visibility. Backed by useImpediments (set_* full-replace).

import { useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useImpediments } from "../hooks/useJira";
import { useCollapse } from "../hooks/useCollapse";
import { CollapseToggle } from "./CollapseToggle";
import type { ImpedimentInput } from "../lib/impedimentsClient";

export function ImpedimentsCard({ sprintId }: { sprintId: number | null }) {
  const { data, loading, error, save } = useImpediments(sprintId);
  const [text, setText] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapse("impediments");

  const items = data ?? [];

  async function persist(next: ImpedimentInput[]) {
    setBusy(true);
    try { await save(next); } catch { /* hook reverts on error */ } finally { setBusy(false); }
  }

  async function add() {
    const t = text.trim();
    if (!t || sprintId === null) return;
    const next: ImpedimentInput[] = [
      ...items,
      { text: t, ...(ticketKey.trim() ? { ticketKey: ticketKey.trim() } : {}) },
    ];
    setText("");
    setTicketKey("");
    await persist(next);
  }

  const toggleResolved = (id: string) =>
    void persist(items.map((i) => (i.id === id ? { ...i, resolved: !i.resolved } : i)));
  const remove = (id: string) => void persist(items.filter((i) => i.id !== id));

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-3 pt-3 pb-1.5">
        <h3 className="text-sm font-semibold text-foreground">
          <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} className="w-full">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden="true" />
            Impediments
            {items.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({items.filter((i) => !i.resolved).length} open)
              </span>
            )}
          </CollapseToggle>
        </h3>
      </CardHeader>
      {!collapsed && (
      <CardContent className="px-3 pb-3 space-y-2">
        {sprintId === null ? (
          <p className="text-sm text-muted-foreground">Select a sprint to track impediments.</p>
        ) : (
          <>
            {/* Add form */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex-1 min-w-[120px]">
                <label htmlFor="imp-text" className="sr-only">New impediment</label>
                <Input
                  id="imp-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                  placeholder="Describe a blocker…"
                  className="h-8"
                  aria-label="New impediment text"
                />
              </div>
              <div className="w-20">
                <label htmlFor="imp-key" className="sr-only">Related ticket key</label>
                <Input
                  id="imp-key"
                  value={ticketKey}
                  onChange={(e) => setTicketKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                  placeholder="KEY?"
                  className="h-8"
                  aria-label="Related ticket key (optional)"
                />
              </div>
              <Button type="button" size="sm" className="h-8" onClick={() => void add()} disabled={busy || !text.trim()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Add impediment</span>
              </Button>
            </div>

            {error && <p className="text-xs text-destructive" role="alert">{error.message}</p>}
            {loading && items.length === 0 && <p className="text-xs text-muted-foreground">Loading…</p>}

            {/* List */}
            {items.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">No impediments logged for this sprint.</p>
            ) : (
              <ul className="space-y-1" role="list">
                {items.map((imp) => (
                  <li key={imp.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!imp.resolved}
                      onChange={() => toggleResolved(imp.id)}
                      className="mt-1 h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--primary))]"
                      aria-label={`Mark "${imp.text}" ${imp.resolved ? "unresolved" : "resolved"}`}
                    />
                    <span className={"flex-1 min-w-0 " + (imp.resolved ? "line-through text-muted-foreground" : "text-foreground")}>
                      {imp.text}
                      {imp.ticketKey && (
                        <span className="ml-1.5 font-mono text-[0.6875rem] text-primary">{imp.ticketKey}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(imp.id)}
                      className="text-muted-foreground hover:text-destructive focus:outline-none focus:ring-1 focus:ring-ring rounded"
                      aria-label={`Remove impediment "${imp.text}"`}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
      )}
    </Card>
  );
}
