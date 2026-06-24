// PullRequestsCard — Huddle pending code-review PR list (v1.16, ADR-027).
// Manual, per-sprint list of PR links for daily visibility. Backed by usePullRequests.

import { useState } from "react";
import { GitPullRequest, Plus, X, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePullRequests } from "../hooks/useJira";
import type { PullRequestInput } from "../lib/prsClient";

/** Best-effort short label for a PR URL (…/owner/repo/pull/123 → repo#123). */
function prLabel(url: string): string {
  const m = url.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/i);
  if (m) return `${m[1]}#${m[2]}`;
  try { return new URL(url).pathname.replace(/^\//, "") || url; } catch { return url; }
}

export function PullRequestsCard({ sprintId }: { sprintId: number | null }) {
  const { data, loading, error, save } = usePullRequests(sprintId);
  const [url, setUrl] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [busy, setBusy] = useState(false);

  const items = data ?? [];

  async function persist(next: PullRequestInput[]) {
    setBusy(true);
    try { await save(next); } catch { /* hook reverts on error */ } finally { setBusy(false); }
  }

  async function add() {
    const u = url.trim();
    if (!u || sprintId === null) return;
    const next: PullRequestInput[] = [
      ...items,
      { url: u, ...(ticketKey.trim() ? { ticketKey: ticketKey.trim() } : {}) },
    ];
    setUrl("");
    setTicketKey("");
    await persist(next);
  }

  const remove = (id: string) => void persist(items.filter((p) => p.id !== id));

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-primary" aria-hidden="true" />
          Code review
          {items.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({items.length} pending)</span>
          )}
        </h3>
      </CardHeader>
      <CardContent className="space-y-3">
        {sprintId === null ? (
          <p className="text-sm text-muted-foreground">Select a sprint to track pending PRs.</p>
        ) : (
          <>
            {/* Add form */}
            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-[160px]">
                <label htmlFor="pr-url" className="sr-only">Pull request URL</label>
                <Input
                  id="pr-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                  placeholder="Paste a PR link…"
                  aria-label="Pull request URL"
                />
              </div>
              <div className="w-24">
                <label htmlFor="pr-key" className="sr-only">Related ticket key</label>
                <Input
                  id="pr-key"
                  value={ticketKey}
                  onChange={(e) => setTicketKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                  placeholder="KEY?"
                  aria-label="Related ticket key (optional)"
                />
              </div>
              <Button type="button" size="sm" onClick={() => void add()} disabled={busy || !url.trim()}>
                <Plus className="h-4 w-4 mr-1" aria-hidden="true" /> Add
              </Button>
            </div>

            {error && <p className="text-xs text-destructive" role="alert">{error.message}</p>}
            {loading && items.length === 0 && <p className="text-xs text-muted-foreground">Loading…</p>}

            {/* List */}
            {items.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">No pending PRs for this sprint.</p>
            ) : (
              <ul className="space-y-1.5" role="list">
                {items.map((pr) => (
                  <li key={pr.id} className="flex items-center gap-2 text-sm">
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0 truncate text-primary hover:underline inline-flex items-center gap-1"
                      aria-label={`Open pull request ${prLabel(pr.url)} in a new tab`}
                      title={pr.url}
                    >
                      <span className="font-mono text-xs truncate">{pr.title ?? prLabel(pr.url)}</span>
                      <ExternalLink className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                    </a>
                    {pr.ticketKey && (
                      <span className="font-mono text-[0.6875rem] text-muted-foreground flex-shrink-0">{pr.ticketKey}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(pr.id)}
                      className="text-muted-foreground hover:text-destructive focus:outline-none focus:ring-1 focus:ring-ring rounded flex-shrink-0"
                      aria-label={`Remove PR ${prLabel(pr.url)}`}
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
    </Card>
  );
}
