// TaskHelper page (v1.44/v1.45/v1.46, ADR-054/055). Auth + required connections are handled by
// the app-wide gate, so this page just renders the workspace: manage connections (esp. your AI
// token), pick one of your sprint tickets, and get a refined spec + a coding-agent prompt.
//
// v1.46 (ADR-055 Phase F): the ticket list is scoped to the sprint SELECTED on the board — the
// page consumes App's shared board+sprint context (SharedSprintProps) like Dashboard/Reports do.

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles, Copy, Check, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SprintJournalCard } from "../components/task-helper/SprintJournalCard";
import { getMyIssues, runHelp, type MyIssue, type TaskHelpResult } from "../lib/taskHelperClient";
import { isAuthApiError } from "../lib/authClient";
import { useAuth } from "../context/AuthContext";
import { useBoards } from "../lib/boards";
import { useSprintList } from "../hooks/useJira";
import type { BoardKey, SharedSprintProps } from "../lib/types";

function errMsg(err: unknown): string {
  return isAuthApiError(err) ? err.message : "Something went wrong";
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
      {copied ? <Check className="h-3.5 w-3.5 mr-1.5 text-primary" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />}
      {copied ? "Copied!" : label}
    </Button>
  );
}

function Workspace({
  boardKey: boardKeyProp,
  sprintId: sprintIdProp,
  onSprintChange,
  projectIdx,
}: SharedSprintProps) {
  // v1.47: connections moved to their own page — read readiness from the app-wide auth context.
  const { context } = useAuth();
  const jiraConnected = !!context?.connections.jira;

  // ── Board + sprint context (v1.46, Phase F) ─────────────────────────────────
  const { boards } = useBoards();
  const selectedBoardKey: BoardKey = boardKeyProp ?? "dev";
  const selectedBoardId: number | undefined = boards
    ? boards[selectedBoardKey][projectIdx ?? 0]?.id
    : undefined;
  const sprintList = useSprintList("all", selectedBoardId);

  // localSprintId holds the page default + uncontrolled picks; a shared explicit pick wins.
  const [localSprintId, setLocalSprintId] = useState<number | null>(null);
  const selectedSprintId: number | null =
    onSprintChange && (sprintIdProp ?? null) !== null ? (sprintIdProp ?? null) : localSprintId;
  const setSprintSelection = (id: number) => {
    if (onSprintChange) onSprintChange(id);
    else setLocalSprintId(id);
  };

  // Default-select the ACTIVE sprint (this page is about current work), else future, else closed.
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (!sprintList.data || defaultedRef.current) return;
    defaultedRef.current = true;
    const { active, future, closed } = sprintList.data;
    const first = active[0] ?? future[0] ?? closed[0];
    if (first) setLocalSprintId(first.id);
  }, [sprintList.data]);

  const sprintsResolved = sprintList.data !== null || sprintList.error !== null;
  const noSprints =
    !!sprintList.data &&
    sprintList.data.active.length + sprintList.data.future.length + sprintList.data.closed.length === 0;
  // Only fetch once the sprint choice has settled, so we don't fire an unscoped request first.
  const sprintSettled = selectedSprintId !== null || (sprintsResolved && (noSprints || !!sprintList.error));

  const [issues, setIssues] = useState<MyIssue[] | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");

  const [extraContext, setExtraContext] = useState("");
  const [result, setResult] = useState<TaskHelpResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function loadIssues() {
    setIssuesLoading(true);
    setIssuesError(null);
    try {
      // Scope to the selected sprint; with no sprint the server falls back to open sprints.
      const data = await getMyIssues(selectedSprintId ?? undefined);
      setIssues(data.issues);
      setSelectedKey(data.issues[0]?.key ?? "");
    } catch (err) {
      setIssuesError(errMsg(err));
    } finally {
      setIssuesLoading(false);
    }
  }

  // Load once Jira is connected AND the sprint choice has settled; reload when the sprint changes.
  useEffect(() => {
    if (jiraConnected && sprintSettled) void loadIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jiraConnected, sprintSettled, selectedSprintId]);

  async function run() {
    if (!selectedKey) return;
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      setResult(await runHelp(selectedKey, extraContext.trim() || undefined));
    } catch (err) {
      setRunError(errMsg(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Ticket picker + run */}
      <Card className="shadow-sm">
        <CardHeader className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Pick a ticket &amp; build a prompt
          </h3>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {!jiraConnected ? (
            <p className="text-sm text-muted-foreground">
              Connect your Jira on the <span className="font-medium text-foreground">Connections</span> page to load your sprint tickets.
            </p>
          ) : (
            <>
              {/* v1.46 (Phase F): the ticket list is scoped to THIS sprint */}
              <div className="flex items-center gap-2">
                <Label htmlFor="th-sprint" className="text-xs font-semibold shrink-0">Sprint</Label>
                <select
                  id="th-sprint"
                  className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm min-w-0"
                  value={selectedSprintId ?? ""}
                  onChange={(e) => setSprintSelection(Number(e.target.value))}
                  disabled={sprintList.loading || !sprintList.data}
                >
                  {sprintList.data ? (
                    <>
                      {sprintList.data.active.length > 0 && (
                        <optgroup label="Active">
                          {sprintList.data.active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </optgroup>
                      )}
                      {sprintList.data.future.length > 0 && (
                        <optgroup label="Future">
                          {sprintList.data.future.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </optgroup>
                      )}
                      {sprintList.data.closed.length > 0 && (
                        <optgroup label="Closed">
                          {sprintList.data.closed.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </optgroup>
                      )}
                    </>
                  ) : (
                    <option value="">{sprintList.loading ? "Loading sprints…" : "No sprints"}</option>
                  )}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Label htmlFor="th-ticket" className="text-xs font-semibold shrink-0">My tickets</Label>
                <select
                  id="th-ticket"
                  className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm min-w-0"
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                  disabled={issuesLoading || !issues?.length}
                >
                  {issues?.length ? (
                    issues.map((i) => (
                      <option key={i.key} value={i.key}>{i.key} — {i.summary}</option>
                    ))
                  ) : (
                    <option value="">{issuesLoading ? "Loading…" : "No tickets assigned to you in this sprint"}</option>
                  )}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadIssues()} disabled={issuesLoading}>
                  <RefreshCw className={"h-3.5 w-3.5 " + (issuesLoading ? "animate-spin" : "")} aria-label="Refresh tickets" />
                </Button>
              </div>
              {issuesError && (
                <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                  <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {issuesError}
                </p>
              )}

              <div>
                <Label htmlFor="th-context" className="text-xs font-semibold">
                  Extra context <span className="font-normal text-muted-foreground">(optional — repo, stack, constraints)</span>
                </Label>
                <Textarea id="th-context" rows={2} value={extraContext} onChange={(e) => setExtraContext(e.target.value)}
                  placeholder="e.g. Next.js + Prisma app; follow the existing service pattern in src/lib/…" />
              </div>

              <Button type="button" onClick={() => void run()} disabled={running || !selectedKey}>
                {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4 mr-1.5" aria-hidden="true" />}
                {running ? "Refining & planning…" : "Refine & build prompt"}
              </Button>
              {runError && (
                <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                  <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {runError}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* v1.47 (ADR-057): personal day-by-day notes + to-dos for this sprint */}
      {jiraConnected && selectedSprintId !== null && (
        <SprintJournalCard sprintId={selectedSprintId} issues={issues ?? []} />
      )}

      {/* Results */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-sm">
            <CardHeader className="px-4 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                Refined ticket
                <span className="ml-auto"><CopyButton text={result.refinedText} label="Copy" /></span>
              </h3>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <pre className="text-sm text-foreground whitespace-pre-wrap break-words font-sans">{result.refinedText}</pre>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="px-4 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                Coding-agent prompt
                <span className="ml-auto"><CopyButton text={result.prompt} label="Copy prompt" /></span>
              </h3>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <pre className="text-sm text-foreground whitespace-pre-wrap break-words font-mono max-h-[480px] overflow-auto">{result.prompt}</pre>
            </CardContent>
          </Card>
        </div>
      )}

      <p className="text-[0.6875rem] text-muted-foreground">
        Paste the prompt into your coding agent (Copilot, Claude Code, Cursor). The ticket is read from{" "}
        <span className="inline-flex items-center gap-0.5">your Jira <ExternalLink className="h-3 w-3" aria-hidden="true" /></span>; nothing is written back.
      </p>
    </div>
  );
}

// v1.46 (Phase F): controlled by App's shared board+sprint context when props are present.
export function TaskHelper(props: SharedSprintProps = {}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Task Helper</h1>
        <p className="text-sm text-muted-foreground">Turn one of your Jira tickets into a ready-to-use coding-agent prompt.</p>
      </div>
      <Workspace {...props} />
    </div>
  );
}
