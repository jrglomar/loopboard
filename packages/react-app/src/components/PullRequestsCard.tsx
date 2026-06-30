// PullRequestsCard — Huddle code-review PR list.
// Auto (v1.22, ADR-034): PRs linked to the current sprint's tickets, read from Jira's Development
//   panel via get_issue_pull_requests — MULTI-REPO, ALL states (open/merged/closed), with approval
//   status; still-open sorted first, merged/closed labelled. (Supersedes the v1.20 single-repo
//   GitHub source.) Manual: a per-sprint list of PR links (usePullRequests).

import { useState, useMemo } from "react";
import { GitPullRequest, Plus, X, ExternalLink, Sparkles, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePullRequests, useIssuePullRequests } from "../hooks/useJira";
import type { PullRequestInput } from "../lib/prsClient";
import type { LinkedPr } from "../lib/types";

/** Small approval-status badge for a linked PR (v1.21/v1.22). */
function ReviewBadge({ status }: { status: Pick<LinkedPr, "decision" | "approvals" | "reviewers"> | undefined }) {
  if (!status) return null;
  if (status.decision === "approved") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[0.6875rem] font-medium text-success flex-shrink-0"
        title={status.reviewers.length ? `Approved by ${status.reviewers.join(", ")}` : "Approved"}>
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Approved{status.approvals > 1 ? ` ·${status.approvals}` : ""}
      </span>
    );
  }
  if (status.decision === "changes_requested") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[0.6875rem] font-medium text-destructive flex-shrink-0"
        title="Changes requested">
        <XCircle className="h-3 w-3" aria-hidden="true" />
        Changes
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[0.6875rem] font-medium text-warning flex-shrink-0"
      title="Review required">
      <Clock className="h-3 w-3" aria-hidden="true" />
      Review
    </span>
  );
}

/** Right-side status for a linked PR: approval badge while open, else a Merged/Closed pill. */
function StatusIndicator({ pr }: { pr: LinkedPr }) {
  if (pr.status === "merged") {
    return (
      <span className="inline-flex items-center text-[0.6875rem] font-medium px-1 rounded bg-muted text-muted-foreground flex-shrink-0" title="Merged">
        Merged
      </span>
    );
  }
  if (pr.status === "declined") {
    return (
      <span className="inline-flex items-center text-[0.6875rem] font-medium px-1 rounded bg-muted text-muted-foreground flex-shrink-0" title="Closed without merging">
        Closed
      </span>
    );
  }
  // open / unknown → show the approval status
  return <ReviewBadge status={pr} />;
}

/** Sort still-open PRs first, then merged, then declined — actionable ones on top. */
const STATUS_RANK: Record<LinkedPr["status"], number> = { open: 0, unknown: 1, merged: 2, declined: 3 };

/** Best-effort short label for a PR URL (…/owner/repo/pull/123 → repo#123). */
function prLabel(url: string): string {
  const m = url.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/i);
  if (m) return `${m[1]}#${m[2]}`;
  try { return new URL(url).pathname.replace(/^\//, "") || url; } catch { return url; }
}

export function PullRequestsCard({
  sprintId,
  sprintKeys,
  issuePrs: issuePrsProp,
}: {
  sprintId: number | null;
  /** Current sprint's ticket keys — auto-PRs are filtered to these (v1.20). */
  sprintKeys?: string[];
  /** v1.27 (ADR-039): linked PRs lifted by the parent (Dashboard) to skip a duplicate fetch. */
  issuePrs?: Record<string, LinkedPr[]>;
}) {
  const { data, loading, error, save } = usePullRequests(sprintId);
  // v1.22 (ADR-034): linked PRs across ALL repos, from Jira's Development panel.
  // v1.27: when the parent supplies the map, don't fetch again (pass [] to the hook).
  const hookPrs = useIssuePullRequests(issuePrsProp ? [] : (sprintKeys ?? []));
  const issuePrs = issuePrsProp ?? hookPrs.data;
  const [url, setUrl] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [busy, setBusy] = useState(false);

  const items = data ?? [];

  // Auto-PRs: flatten linked PRs across the sprint's tickets (ALL states — open, merged, closed),
  // dedupe by URL, drop any already tracked manually, and sort still-open ones first.
  const autoPrs = useMemo(() => {
    const manualUrls = new Set(items.map((p) => p.url));
    const seen = new Set<string>();
    const out: LinkedPr[] = [];
    for (const list of Object.values(issuePrs)) {
      for (const pr of list) {
        if (manualUrls.has(pr.url) || seen.has(pr.url)) continue;
        seen.add(pr.url);
        out.push(pr);
      }
    }
    return out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  }, [issuePrs, items]);

  const totalCount = autoPrs.length + items.length;

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
      <CardHeader className="px-3 pt-3 pb-1.5">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <GitPullRequest className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Code review
          {totalCount > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({totalCount})</span>
          )}
        </h3>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {sprintId === null ? (
          <p className="text-sm text-muted-foreground">Select a sprint to track pending PRs.</p>
        ) : (
          <>
            {/* Auto-linked PRs (current sprint, multi-repo via Jira Development panel) */}
            {autoPrs.length > 0 && (
              <ul className="space-y-1" role="list" aria-label="Linked pull requests">
                {autoPrs.map((pr) => (
                  <li key={pr.url} className="flex items-center gap-1.5 text-sm">
                    <Sparkles className="h-3 w-3 text-primary flex-shrink-0" aria-label="Linked to a sprint ticket" />
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0 truncate text-primary hover:underline inline-flex items-center gap-1"
                      title={pr.repo ? `${pr.repo} — ${pr.title}` : pr.title}
                    >
                      <span className="truncate">{pr.title}</span>
                      <ExternalLink className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                    </a>
                    <StatusIndicator pr={pr} />
                    {pr.repo && (
                      <span className="font-mono text-[0.6875rem] text-muted-foreground flex-shrink-0 truncate max-w-[80px]" title={pr.repo}>
                        {pr.repo.split("/").pop()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Add form (manual) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex-1 min-w-[140px]">
                <label htmlFor="pr-url" className="sr-only">Pull request URL</label>
                <Input
                  id="pr-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                  placeholder="Paste a PR link…"
                  className="h-8"
                  aria-label="Pull request URL"
                />
              </div>
              <div className="w-20">
                <label htmlFor="pr-key" className="sr-only">Related ticket key</label>
                <Input
                  id="pr-key"
                  value={ticketKey}
                  onChange={(e) => setTicketKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                  placeholder="KEY?"
                  className="h-8"
                  aria-label="Related ticket key (optional)"
                />
              </div>
              <Button type="button" size="sm" className="h-8" onClick={() => void add()} disabled={busy || !url.trim()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Add pull request</span>
              </Button>
            </div>

            {error && <p className="text-xs text-destructive" role="alert">{error.message}</p>}
            {loading && items.length === 0 && <p className="text-xs text-muted-foreground">Loading…</p>}

            {/* Manual list */}
            {items.length > 0 && (
              <ul className="space-y-1" role="list" aria-label="Manual pull requests">
                {items.map((pr) => (
                  <li key={pr.id} className="flex items-center gap-1.5 text-sm">
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

            {totalCount === 0 && !loading && (
              <p className="text-sm text-muted-foreground">No linked PRs for this sprint.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
