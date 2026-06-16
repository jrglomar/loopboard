// TeamManager — Curated per-board team roster editor (v1.8, ADR-019)
//
// Shows the current team roster with Remove (×) per member.
// "Add from recent sprints": shows get_recent_assignees list (name + ticketCount)
// with Add buttons. Already-on-team people are marked/disabled.
// First-run (empty team): a seed prompt with "Add all recent" + per-person Add.
// Persists via save() (set_team_members full-replace).
//
// a11y: labeled buttons "Remove <name>", "Add <name>"; role="list" for roster.
// perf: recent assignees are lazy — only fetched when the manager is open.

import React, { useState, useCallback, useMemo } from "react";
import { Users, X, Plus, UserCheck, AlertCircle, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useTeamMembers,
  useRecentAssignees,
  useAssignableUsers,
} from "../hooks/useJira";
import type { TeamMember } from "../lib/types";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TeamManagerProps {
  boardId: number | undefined;
  /** Called after the team is saved so parent can re-read useTeamMembers */
  onTeamChange?: () => void;
}

// ── TeamMemberChip — a single roster member with Remove button ────────────────

interface TeamMemberChipProps {
  member: TeamMember;
  onRemove: (member: TeamMember) => void;
  disabled?: boolean;
}

function TeamMemberChip({ member, onRemove, disabled }: TeamMemberChipProps) {
  // a11y: initials avatar (decorative); Remove button has descriptive aria-label
  const initials = member.displayName
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm">
      {/* a11y: avatar is decorative */}
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[0.625rem] font-bold text-primary"
      >
        {initials}
      </span>
      <span className="text-foreground">{member.displayName}</span>
      <button
        type="button"
        aria-label={`Remove ${member.displayName}`}
        disabled={disabled}
        onClick={() => onRemove(member)}
        className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus:outline-none focus:ring-2 focus:ring-ring transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

// ── RecentAssigneeRow — a candidate from get_recent_assignees ─────────────────

interface RecentAssigneeRowProps {
  accountId: string;
  displayName: string;
  ticketCount: number;
  alreadyOnTeam: boolean;
  onAdd: (accountId: string, displayName: string) => void;
  disabled?: boolean;
}

function RecentAssigneeRow({
  accountId,
  displayName,
  ticketCount,
  alreadyOnTeam,
  onAdd,
  disabled,
}: RecentAssigneeRowProps) {
  return (
    <li className="flex items-center gap-2 py-1.5 border-t border-border/40 first:border-0">
      <UserCheck
        className={`h-4 w-4 flex-shrink-0 ${alreadyOnTeam ? "text-success" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <span className="flex-1 text-sm text-foreground">{displayName}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {ticketCount} ticket{ticketCount !== 1 ? "s" : ""}
      </span>
      {alreadyOnTeam ? (
        <span className="text-xs text-muted-foreground font-medium px-2">
          ✓ Added
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Add ${displayName}`}
          disabled={disabled}
          onClick={() => onAdd(accountId, displayName)}
          className="h-7 text-xs"
        >
          <Plus className="h-3 w-3 mr-1" aria-hidden="true" />
          Add
        </Button>
      )}
    </li>
  );
}

// ── AssignablePersonRow — a candidate from the "Search all people" list ───────

interface AssignablePersonRowProps {
  accountId: string;
  displayName: string;
  alreadyOnTeam: boolean;
  onAdd: (accountId: string, displayName: string) => void;
  disabled?: boolean;
}

function AssignablePersonRow({
  accountId,
  displayName,
  alreadyOnTeam,
  onAdd,
  disabled,
}: AssignablePersonRowProps) {
  return (
    <li className="flex items-center gap-2 py-1.5 border-t border-border/40 first:border-0">
      <UserCheck
        className={`h-4 w-4 flex-shrink-0 ${alreadyOnTeam ? "text-success" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <span className="flex-1 text-sm text-foreground">{displayName}</span>
      {alreadyOnTeam ? (
        <span className="text-xs text-muted-foreground font-medium px-2">
          ✓ Added
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Add ${displayName}`}
          disabled={disabled}
          onClick={() => onAdd(accountId, displayName)}
          className="h-7 text-xs"
        >
          <Plus className="h-3 w-3 mr-1" aria-hidden="true" />
          Add
        </Button>
      )}
    </li>
  );
}

// ── TeamManagerDialog — the inner dialog content ──────────────────────────────

interface TeamManagerDialogProps {
  boardId: number | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTeamChange?: () => void;
}

function TeamManagerDialog({
  boardId,
  open,
  onOpenChange,
  onTeamChange,
}: TeamManagerDialogProps) {
  const {
    data: team,
    loading: teamLoading,
    error: teamError,
    run: teamRun,
    save,
  } = useTeamMembers(boardId ?? null);

  const {
    data: recent,
    loading: recentLoading,
    error: recentError,
    run: recentRun,
  } = useRecentAssignees(boardId ?? null);

  // v1.9 (ADR-020): "Search all people" — the FULL assignable list, fetched
  // lazily (only when the search section is opened) and filtered client-side by
  // name so ANY person can be added, not just recent assignees.
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const assignableOpts = showSearch && boardId != null ? { boardId } : null;
  const {
    data: allUsers,
    loading: usersLoading,
    error: usersError,
  } = useAssignableUsers(assignableOpts);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // perf: show the recent section collapsed by default; open when empty team
  const isFirstRun = team !== null && team.length === 0;
  const [showRecent, setShowRecent] = useState(false);

  // When the dialog opens, reset the recent-open state based on team size
  React.useEffect(() => {
    if (open) {
      setSaveError(null);
      // Auto-show recent for first-run (empty team)
      if (team !== null && team.length === 0) {
        setShowRecent(true);
        recentRun();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When showRecent becomes true and data hasn't been loaded, fetch
  React.useEffect(() => {
    if (showRecent && recent === null && !recentLoading) {
      recentRun();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecent]);

  const handleToggleRecent = () => {
    const next = !showRecent;
    setShowRecent(next);
    if (next && recent === null && !recentLoading) {
      recentRun();
    }
  };

  const handleRemove = useCallback(
    async (member: TeamMember) => {
      if (!team) return;
      const next = team.filter((m) => m.accountId !== member.accountId);
      setSaving(true);
      setSaveError(null);
      try {
        await save(next);
        onTeamChange?.();
      } catch (err: unknown) {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : "Failed to update team";
        setSaveError(msg);
      } finally {
        setSaving(false);
      }
    },
    [team, save, onTeamChange]
  );

  const handleAdd = useCallback(
    async (accountId: string, displayName: string) => {
      const current = team ?? [];
      // Dedupe by accountId
      if (current.some((m) => m.accountId === accountId)) return;
      const next = [...current, { accountId, displayName }];
      setSaving(true);
      setSaveError(null);
      try {
        await save(next);
        onTeamChange?.();
      } catch (err: unknown) {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : "Failed to update team";
        setSaveError(msg);
      } finally {
        setSaving(false);
      }
    },
    [team, save, onTeamChange]
  );

  const handleAddAllRecent = useCallback(async () => {
    if (!recent || recent.length === 0) return;
    const current = team ?? [];
    const existingIds = new Set(current.map((m) => m.accountId));
    const toAdd = recent.filter((r) => !existingIds.has(r.accountId));
    if (toAdd.length === 0) return;
    const next = [
      ...current,
      ...toAdd.map(({ accountId, displayName }) => ({ accountId, displayName })),
    ];
    setSaving(true);
    setSaveError(null);
    try {
      await save(next);
      onTeamChange?.();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to update team";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [recent, team, save, onTeamChange]);

  const teamSet = new Set((team ?? []).map((m) => m.accountId));

  // Client-side name filter over the full assignable list (v1.9)
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = allUsers ?? [];
    if (q === "") return list;
    return list.filter((u) => u.displayName.toLowerCase().includes(q));
  }, [allUsers, searchQuery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 text-primary" aria-hidden="true" />
            Manage Team
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {/* ── Save error ─────────────────────────────────────────────────── */}
          {saveError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p>{saveError}</p>
            </div>
          )}

          {/* ── Team error ─────────────────────────────────────────────────── */}
          {teamError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p>{teamError.message}</p>
            </div>
          )}

          {/* ── First-run callout ──────────────────────────────────────────── */}
          {isFirstRun && !teamLoading && !teamError && (
            <div className="rounded-lg border border-[hsl(var(--info-border))] bg-[hsl(var(--info-bg))] px-4 py-3 text-sm space-y-3">
              <p className="font-medium text-foreground">
                Set up your team
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Your team roster is empty. Add the usual members from recent
                sprints to get started — the leaves plotter and ticket
                assignment will use this list.
              </p>
              {recent !== null && recent.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleAddAllRecent()}
                  disabled={saving}
                  className="w-full"
                  aria-label="Add all from recent sprints"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  )}
                  Add all from recent sprints ({recent.filter((r) => !teamSet.has(r.accountId)).length})
                </Button>
              )}
              {recentLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Loading recent assignees…
                </div>
              )}
            </div>
          )}

          {/* ── Current team roster ───────────────────────────────────────── */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Current team
              {team !== null && team.length > 0 && (
                <span className="ml-1.5 font-normal normal-case">
                  ({team.length} member{team.length !== 1 ? "s" : ""})
                </span>
              )}
            </p>

            {teamLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Loading team roster…
              </div>
            ) : team !== null && team.length > 0 ? (
              // a11y: role="list" for the roster
              <ul role="list" className="space-y-1.5">
                {team.map((member) => (
                  <TeamMemberChip
                    key={member.accountId}
                    member={member}
                    onRemove={(m) => void handleRemove(m)}
                    disabled={saving}
                  />
                ))}
              </ul>
            ) : !teamError ? (
              <p className="text-xs text-muted-foreground py-2">
                No team members yet.
              </p>
            ) : null}

            {saving && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Saving…
              </div>
            )}
          </div>

          {/* ── Add from recent activity (board-wide, v1.9) ───────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Add from recent activity
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleToggleRecent}
                aria-expanded={showRecent}
                aria-controls="recent-assignees-list"
                aria-label={showRecent ? "Hide recent activity" : "Show recent activity"}
                className="h-6 text-xs"
              >
                {showRecent ? "Hide" : "Show"}
              </Button>
            </div>

            {showRecent && (
              <div id="recent-assignees-list">
                {recentLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Loading recent assignees…
                  </div>
                )}

                {recentError && (
                  <div role="alert" className="flex items-start gap-2 text-xs text-destructive py-1">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <p>{recentError.message}</p>
                  </div>
                )}

                {recent !== null && recent.length > 0 && (
                  <>
                    {/* Add all button (when team has members — first-run shows it in the callout) */}
                    {!isFirstRun && recent.some((r) => !teamSet.has(r.accountId)) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleAddAllRecent()}
                        disabled={saving}
                        className="mb-3 h-7 text-xs"
                        aria-label="Add all recent sprint assignees not yet on the team"
                      >
                        <Plus className="h-3 w-3 mr-1" aria-hidden="true" />
                        Add all not yet on team ({recent.filter((r) => !teamSet.has(r.accountId)).length})
                      </Button>
                    )}

                    {/* a11y: role="list" for candidates */}
                    <ul role="list">
                      {recent.map((r) => (
                        <RecentAssigneeRow
                          key={r.accountId}
                          accountId={r.accountId}
                          displayName={r.displayName}
                          ticketCount={r.ticketCount}
                          alreadyOnTeam={teamSet.has(r.accountId)}
                          onAdd={(id, name) => void handleAdd(id, name)}
                          disabled={saving}
                        />
                      ))}
                    </ul>
                  </>
                )}

                {recent !== null && recent.length === 0 && !recentLoading && !recentError && (
                  <p className="text-xs text-muted-foreground py-2">
                    No recent assignees found.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Search all people (v1.9, ADR-020) ─────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Search all people
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowSearch((s) => !s)}
                aria-expanded={showSearch}
                aria-controls="search-people-list"
                aria-label={showSearch ? "Hide all people search" : "Show all people search"}
                className="h-6 text-xs"
              >
                {showSearch ? "Hide" : "Show"}
              </Button>
            </div>

            {showSearch && (
              <div id="search-people-list" className="space-y-2">
                {/* a11y: labeled search input; icon is decorative */}
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name…"
                    aria-label="Search all assignable people by name"
                    className="h-8 pl-8 text-sm"
                  />
                </div>

                {usersLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Loading people…
                  </div>
                )}

                {usersError && (
                  <div role="alert" className="flex items-start gap-2 text-xs text-destructive py-1">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <p>{usersError.message}</p>
                  </div>
                )}

                {allUsers !== null && !usersLoading && !usersError && (
                  <>
                    {/* a11y: role="list"; live count for screen readers */}
                    <p className="sr-only" aria-live="polite">
                      {filteredUsers.length} matching{" "}
                      {filteredUsers.length === 1 ? "person" : "people"}
                    </p>
                    {filteredUsers.length > 0 ? (
                      <ul role="list" className="max-h-56 overflow-y-auto">
                        {filteredUsers.map((u) => (
                          <AssignablePersonRow
                            key={u.accountId}
                            accountId={u.accountId}
                            displayName={u.displayName}
                            alreadyOnTeam={teamSet.has(u.accountId)}
                            onAdd={(id, name) => void handleAdd(id, name)}
                            disabled={saving}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">
                        No people match "{searchQuery.trim()}".
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Retry + close footer ──────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-2">
          {teamError ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={teamRun}
              aria-label="Retry loading team roster"
            >
              Retry
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── TeamManager — the trigger button + dialog wrapper ─────────────────────────

/**
 * TeamManager renders a "Manage team" button that opens the team-roster dialog.
 * Mounts in the Planning header area near the board/sprint context.
 *
 * boardId controls which board's team is managed (Dev vs PO differ).
 *
 * v1.8 (ADR-019): the curated roster seeded from recent-sprint assignees.
 */
export function TeamManager({ boardId, onTeamChange }: TeamManagerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex items-center gap-1.5 h-9 text-xs"
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        Manage team
      </Button>

      <TeamManagerDialog
        boardId={boardId}
        open={open}
        onOpenChange={setOpen}
        onTeamChange={onTeamChange}
      />
    </>
  );
}

// ── TeamManagerInline — an inline card variant for first-run emphasis ─────────

/**
 * Compact inline card variant — shown directly in the Planning layout when the
 * team is empty, to make the first-run seeding prompt prominent.
 * Once team has members, callers can switch to the button/dialog variant.
 */
export function TeamManagerInlineCard({
  boardId,
  onTeamChange,
}: TeamManagerProps) {
  const { data: team, loading, error, run } = useTeamMembers(boardId ?? null);

  // Only show the inline card when the team is definitively empty
  if (loading || error || (team !== null && team.length > 0)) {
    return null;
  }

  return (
    <Card className="shadow-sm border-[hsl(var(--info-border))] bg-[hsl(var(--info-bg))]">
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" aria-hidden="true" />
          Set up your team
        </h3>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed">
          No team members found. Open "Manage team" to seed the roster from
          recent sprints — the leaves plotter and ticket assignment will use
          this list.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => { void run(); onTeamChange?.(); }}
          className="h-7 text-xs"
          aria-label="Open team manager"
        >
          <Users className="h-3 w-3 mr-1" aria-hidden="true" />
          Manage team
        </Button>
      </CardContent>
    </Card>
  );
}
