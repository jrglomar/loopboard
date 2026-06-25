// Typed Jira hooks — CONTRACTS.md §6
import { useCallback, useEffect, useState, useRef } from "react";
import { callTool } from "../lib/mcpClient";
import { getIssuePullRequests } from "../lib/issuePrsClient";
import { getLeaves, setLeaves, type LeavesMap } from "../lib/leavesClient";
import { getAssignableUsers } from "../lib/assignClient";
import { getTeamMembers, setTeamMembers, getRecentAssignees } from "../lib/teamClient";
import { getImpediments, setImpediments, type ImpedimentInput } from "../lib/impedimentsClient";
import { getPullRequests, setPullRequests, type PullRequestInput } from "../lib/prsClient";
import { getPostScrum, setPostScrum, type PostScrumInput } from "../lib/postScrumClient";
import { getMeetingGoal, setMeetingGoal } from "../lib/meetingGoalClient";
import type { McpError } from "../lib/mcpClient";
import {
  type GetActiveSprintOutput,
  type GetDailyHuddleOutput,
  type GetTicketOutput,
  type CreatePoTicketOutput,
  type CreateDevTicketOutput,
  type UpdateTicketOutput,
  type SprintRef,
  type CreateSprintRequest,
  type ListSprintsResponse,
  type SprintReport,
  type VelocityData,
  type AssignableUser,
  type TeamMember,
  type RecentAssignee,
  type Impediment,
  type PullRequest,
  type PostScrumNote,
  type MeetingGoal,
  type LinkedPr,
} from "../lib/types";
import { useMCP, type UseMCPState } from "./useMCP";

// ── useActiveSprint ───────────────────────────────────────────────────────────

/**
 * Fetches the active sprint for the given boardId and optional sprintId.
 * Passes sprintId in tool input only when set.
 * Refetches when boardId or sprintId changes.
 *
 * CONTRACTS.md §4.3 v1.1
 */
export function useActiveSprint(boardId?: number, sprintId?: number | null): UseMCPState<GetActiveSprintOutput> {
  const fn = useCallback(
    () => {
      const input: Record<string, number> = {};
      if (boardId !== undefined) input.boardId = boardId;
      if (sprintId != null) input.sprintId = sprintId;
      return callTool<GetActiveSprintOutput>("jira", "get_active_sprint", input);
    },
    [boardId, sprintId]
  );

  const state = useMCP(fn);

  // Auto-fetch on mount and when sprintId/boardId change
  useEffect(() => {
    state.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, sprintId]);

  return state;
}

// ── useDailyHuddle ────────────────────────────────────────────────────────────

/**
 * Fetches the daily huddle digest for the given boardId and optional sprintId.
 * Passes sprintId in tool input only when set.
 * Refetches when boardId or sprintId changes.
 *
 * CONTRACTS.md §4.6 v1.1
 */
export function useDailyHuddle(boardId?: number, sprintId?: number | null): UseMCPState<GetDailyHuddleOutput> {
  const fn = useCallback(
    () => {
      const input: Record<string, number> = {};
      if (boardId !== undefined) input.boardId = boardId;
      if (sprintId != null) input.sprintId = sprintId;
      return callTool<GetDailyHuddleOutput>("jira", "get_daily_huddle", input);
    },
    [boardId, sprintId]
  );

  const state = useMCP(fn);

  useEffect(() => {
    state.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, sprintId]);

  return state;
}

// ── createTicketPair ──────────────────────────────────────────────────────────

export interface CreateTicketPairInput {
  po: { summary: string; description: string; storyPoints?: number; sprintId?: number };
  dev: { summary: string; description: string; sprintId?: number };
}

export interface CreateTicketPairResult {
  po: CreatePoTicketOutput;
  dev: CreateDevTicketOutput;
}

/**
 * Create ONLY a PO story (no Dev task) — v1.17, ADR-028 (PO-first ticket gen).
 * Used when the "Also create a linked Dev task" toggle is off.
 */
export async function createPoTicket(input: {
  summary: string;
  description: string;
  storyPoints?: number;
  sprintId?: number;
}): Promise<CreatePoTicketOutput> {
  return callTool<CreatePoTicketOutput>("jira", "create_po_ticket", {
    summary: input.summary,
    description: input.description,
    ...(input.storyPoints !== undefined ? { storyPoints: input.storyPoints } : {}),
    ...(input.sprintId !== undefined ? { sprintId: input.sprintId } : {}),
  });
}

/**
 * Creates a PO ticket, then a Dev ticket linked to it.
 * Returns both ticket outputs including optional sprintId/sprintWarning (v1.4).
 */
export async function createTicketPair(
  input: CreateTicketPairInput
): Promise<CreateTicketPairResult> {
  const po = await callTool<CreatePoTicketOutput>("jira", "create_po_ticket", {
    summary: input.po.summary,
    description: input.po.description,
    ...(input.po.storyPoints !== undefined ? { storyPoints: input.po.storyPoints } : {}),
    ...(input.po.sprintId !== undefined ? { sprintId: input.po.sprintId } : {}),
  });

  const dev = await callTool<CreateDevTicketOutput>("jira", "create_dev_ticket", {
    summary: input.dev.summary,
    description: input.dev.description,
    linkedPoTicketKey: po.key,
    ...(input.dev.sprintId !== undefined ? { sprintId: input.dev.sprintId } : {}),
  });

  return { po, dev };
}

// ── createLinkedDevTicket (v1.10, ADR-021) ───────────────────────────────────

/**
 * Create a single Dev Task linked to an EXISTING PO story (no new PO ticket),
 * optionally adding it to a Dev sprint. Wraps create_dev_ticket — link + sprint
 * are non-fatal (returned as linkWarning/sprintWarning).
 */
export async function createLinkedDevTicket(input: {
  summary: string;
  description: string;
  linkedPoTicketKey: string;
  sprintId?: number;
}): Promise<CreateDevTicketOutput> {
  return callTool<CreateDevTicketOutput>("jira", "create_dev_ticket", {
    summary: input.summary,
    description: input.description,
    linkedPoTicketKey: input.linkedPoTicketKey,
    ...(input.sprintId !== undefined ? { sprintId: input.sprintId } : {}),
  });
}

// ── setSprintGoal (v1.13, ADR-024) ───────────────────────────────────────────

/** Set (or clear) a sprint's goal via set_sprint_goal (a real Jira write). */
export async function setSprintGoal(
  sprintId: number,
  goal: string
): Promise<{ sprintId: number; goal: string | null }> {
  return callTool<{ sprintId: number; goal: string | null }>(
    "jira",
    "set_sprint_goal",
    { sprintId, goal }
  );
}

// ── enhanceTicket ─────────────────────────────────────────────────────────────

/** Fetches the ticket then updates it with new description notes */
export async function enhanceTicket(
  ticketKey: string,
  notes: string
): Promise<{ ticket: GetTicketOutput; updated: UpdateTicketOutput }> {
  const ticket = await callTool<GetTicketOutput>("jira", "get_ticket", { ticketKey });
  const updated = await callTool<UpdateTicketOutput>("jira", "update_ticket", {
    ticketKey,
    description: notes,
  });
  return { ticket, updated };
}

// ── createSprint ──────────────────────────────────────────────────────────────

/**
 * Creates a new future sprint on the board.
 * CONTRACTS.md §4.10 v1.4 (ADR-011)
 */
export async function createSprint(body: CreateSprintRequest): Promise<SprintRef> {
  return callTool<SprintRef>("jira", "create_sprint", body);
}

// ── useSprintReport ───────────────────────────────────────────────────────────

/**
 * Fetches the sprint report for a specific sprint ID.
 * Pass null to skip fetching (no-op until a sprint is selected).
 * Refetches when sprintId or boardId changes.
 *
 * boardId is optional — passes it to the tool when provided (v1.6, ADR-017).
 *
 * CONTRACTS.md §4.12 v1.4 (ADR-012)
 */
export function useSprintReport(
  sprintId: number | null,
  boardId?: number
): UseMCPState<SprintReport> {
  const fn = useCallback(() => {
    if (sprintId === null) {
      // Return a never-resolving promise — run() is called only when sprintId is set
      return new Promise<SprintReport>(() => undefined);
    }
    const input: Record<string, number> = { sprintId };
    if (boardId !== undefined) input.boardId = boardId;
    return callTool<SprintReport>("jira", "get_sprint_report", input);
  }, [sprintId, boardId]);

  const hookState = useMCP(fn);

  useEffect(() => {
    if (sprintId !== null) {
      hookState.run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintId, boardId]);

  return hookState;
}

// ── useVelocity ───────────────────────────────────────────────────────────────

/**
 * Fetches the velocity data for the given boardId (optional — defaults server-side to Dev).
 *
 * v1.5 (ADR-015): optional `beforeSprintId` — when provided, velocity is the N
 * sprints BEFORE that sprint. Reports passes the selected sprintId so the
 * velocity chart tracks the picker and refetches on sprint change.
 *
 * v1.10 (ADR-021): always sends `includeActive: true` so the pool includes active
 * sprints (not just closed) — the board rarely closes sprints, so closed-only
 * returned stale results. The current/selected sprint is still excluded server-side.
 *
 * v1.6 (ADR-017): optional `boardId` — thread to get_velocity for PO/Dev reports.
 *
 * CONTRACTS.md §4.13 v1.4/v1.5
 */
export function useVelocity(
  beforeSprintId?: number | null,
  boardId?: number
): UseMCPState<VelocityData> {
  const fn = useCallback(() => {
    const input: Record<string, number | boolean> = {};
    if (beforeSprintId != null) input.beforeSprintId = beforeSprintId;
    if (boardId !== undefined) input.boardId = boardId;
    // v1.10 (ADR-021): always pool active sprints too, so the chart reflects the
    // latest delivered work even on boards that rarely formally close sprints.
    input.includeActive = true;
    return callTool<VelocityData>("jira", "get_velocity", input);
  }, [beforeSprintId, boardId]);

  const hookState = useMCP(fn);

  useEffect(() => {
    hookState.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beforeSprintId, boardId]);

  return hookState;
}

// ── useSprintList ─────────────────────────────────────────────────────────────

/**
 * Lists sprints by state and optional boardId.
 * Pass state="all" to get active+future+closed.
 * boardId is optional — omitted = server default (Dev board). v1.6 (ADR-017).
 * Returns UseMCPState wrapping ListSprintsResponse.
 * CONTRACTS.md §4.11 v1.4 (ADR-011)
 */
export function useSprintList(
  state?: "active" | "future" | "closed" | "all",
  boardId?: number
): UseMCPState<ListSprintsResponse> {
  const fn = useCallback(() => {
    const input: Record<string, string | number> = {};
    if (state && state !== "all") input.state = state;
    // "all" → omit state param (backend default is "all")
    if (boardId !== undefined) input.boardId = boardId;
    return callTool<ListSprintsResponse>("jira", "list_sprints", input);
  }, [state, boardId]);

  const hookState = useMCP(fn);

  useEffect(() => {
    hookState.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, boardId]);

  return hookState;
}

// ── useLeaves ─────────────────────────────────────────────────────────────────

/**
 * Fetch and manage per-sprint leaves.
 *
 * v1.5 (ADR-016): CONTRACTS.md §4.14, §6.
 *
 * - `data`: the current LeavesMap (assignee → YYYY-MM-DD[]) or null before load
 * - `loading`: true while fetching/saving
 * - `error`: McpError (including BRIDGE_DOWN) or null
 * - `run`: manually refetch
 * - `save(assignee, dates)`: call set_leaves and update local state optimistically
 *
 * Loads automatically on mount and when sprintId changes.
 * Pass null to skip loading (e.g. no sprint selected yet).
 */
export interface UseLeavesState {
  data: LeavesMap | null;
  loading: boolean;
  error: McpError | null;
  run: () => void;
  save: (assignee: string, dates: string[]) => Promise<void>;
}

export function useLeaves(sprintId: number | null): UseLeavesState {
  const [data, setData] = useState<LeavesMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<McpError | null>(null);

  const run = useCallback(() => {
    if (sprintId === null) return;
    setLoading(true);
    setError(null);
    getLeaves(sprintId)
      .then((leaves) => {
        setData(leaves);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(
          err && typeof err === "object" && "code" in err && "message" in err
            ? (err as McpError)
            : { code: "UNKNOWN", message: String(err) }
        );
        setLoading(false);
      });
  }, [sprintId]);

  // Auto-load on mount and when sprintId changes
  useEffect(() => {
    if (sprintId !== null) {
      run();
    } else {
      // Reset when no sprint selected
      setData(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintId]);

  const save = useCallback(
    async (assignee: string, dates: string[]) => {
      if (sprintId === null) return;
      // Optimistic update: apply immediately, rollback on error
      const prev = data;
      setData((cur) => ({
        ...(cur ?? {}),
        [assignee]: dates,
      }));
      try {
        const updated = await setLeaves(sprintId, assignee, dates);
        setData(updated);
      } catch (err: unknown) {
        // Rollback
        setData(prev);
        throw err;
      }
    },
    [sprintId, data]
  );

  return { data, loading, error, run, save };
}

// ── useAssignableUsers ────────────────────────────────────────────────────────

export interface UseAssignableUsersOpts {
  projectKey?: string;
  boardId?: number;
}

export interface UseAssignableUsersState {
  data: AssignableUser[] | null;
  loading: boolean;
  error: McpError | null;
  run: () => void;
}

/**
 * Fetch assignable users for a project / board.
 * Pass null to skip loading (no sprint/project context yet).
 *
 * Loads when opts changes (by projectKey). Active-only, sorted by displayName.
 *
 * CONTRACTS.md §4.15 v1.7
 */
export function useAssignableUsers(
  opts: UseAssignableUsersOpts | null
): UseAssignableUsersState {
  const [data, setData] = useState<AssignableUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<McpError | null>(null);

  const run = useCallback(() => {
    if (opts === null) return;
    setLoading(true);
    setError(null);
    getAssignableUsers(opts)
      .then((users) => {
        setData(users);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(
          err && typeof err === "object" && "code" in err && "message" in err
            ? (err as McpError)
            : { code: "UNKNOWN", message: String(err) }
        );
        setLoading(false);
      });
    // perf: run is a stable reference per opts value; deps are resolved inside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.projectKey, opts?.boardId, opts === null]);

  // Auto-load when opts/projectKey changes
  useEffect(() => {
    if (opts !== null) {
      run();
    } else {
      setData(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.projectKey, opts?.boardId, opts === null]);

  return { data, loading, error, run };
}

// ── useTeamMembers (v1.8, ADR-019) ───────────────────────────────────────────

export interface UseTeamMembersState {
  /** Current roster ([] when empty, null before first load) */
  data: TeamMember[] | null;
  loading: boolean;
  error: McpError | null;
  /** Manually refetch the team roster */
  run: () => void;
  /**
   * Replace the full team roster and update local state optimistically.
   * add/remove = compute the new list, then call save(newList).
   */
  save: (members: TeamMember[]) => Promise<void>;
}

/**
 * Fetch and manage the curated per-board team roster.
 * Pass null to skip loading (no board context yet).
 *
 * Loads automatically when boardId changes.
 * `save(members)` calls set_team_members (full-replace) and updates local state.
 *
 * CONTRACTS.md §4.16 v1.8, ADR-019
 */
export function useTeamMembers(
  boardId: number | null | undefined
): UseTeamMembersState {
  const [data, setData] = useState<TeamMember[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<McpError | null>(null);

  const run = useCallback(() => {
    if (boardId == null) return;
    setLoading(true);
    setError(null);
    getTeamMembers(boardId)
      .then((members) => {
        setData(members);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(
          err && typeof err === "object" && "code" in err && "message" in err
            ? (err as McpError)
            : { code: "UNKNOWN", message: String(err) }
        );
        setLoading(false);
      });
    // perf: stable per boardId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // Auto-load on mount and when boardId changes
  useEffect(() => {
    if (boardId != null) {
      run();
    } else {
      setData(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const save = useCallback(
    async (members: TeamMember[]) => {
      // Optimistic: apply immediately, rollback on error
      const prev = data;
      setData(members);
      try {
        const updated = await setTeamMembers(boardId ?? undefined, members);
        setData(updated);
      } catch (err: unknown) {
        // Rollback
        setData(prev);
        throw err;
      }
    },
    [boardId, data]
  );

  return { data, loading, error, run, save };
}

// ── useRecentAssignees (v1.8, ADR-019) ───────────────────────────────────────

export interface UseRecentAssigneesState {
  /** Recent assignees (null before first load) */
  data: RecentAssignee[] | null;
  loading: boolean;
  error: McpError | null;
  /** Trigger a fetch — lazy/on-demand */
  run: () => void;
}

/**
 * Fetch distinct assignees from the last N sprints — the "usual members" for
 * seeding the team roster. Lazy/on-demand: does NOT auto-fetch on mount.
 * Call run() to trigger the fetch (e.g. when the user opens the team manager).
 *
 * CONTRACTS.md §4.16 v1.8, ADR-019
 */
export function useRecentAssignees(
  boardId: number | null | undefined
): UseRecentAssigneesState {
  const [data, setData] = useState<RecentAssignee[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<McpError | null>(null);

  const run = useCallback(() => {
    if (boardId == null) return;
    setLoading(true);
    setError(null);
    getRecentAssignees(boardId)
      .then((assignees) => {
        setData(assignees);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(
          err && typeof err === "object" && "code" in err && "message" in err
            ? (err as McpError)
            : { code: "UNKNOWN", message: String(err) }
        );
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // Reset when boardId changes (stale data from old board)
  useEffect(() => {
    setData(null);
    setError(null);
  }, [boardId]);

  return { data, loading, error, run };
}

// ── useImpediments / usePullRequests (v1.16, ADR-027) ─────────────────────────

function toMcpError(err: unknown): McpError {
  return err && typeof err === "object" && "code" in err && "message" in err
    ? (err as McpError)
    : { code: "UNKNOWN", message: String(err) };
}

export interface UseImpedimentsState {
  data: Impediment[] | null;
  loading: boolean;
  error: McpError | null;
  run: () => void;
  /** Full-replace the sprint's impediments (optimistic-ish: replaces with server result). */
  save: (impediments: ImpedimentInput[]) => Promise<void>;
}

/**
 * Per-sprint impediments/blockers (manual store). Loads on mount + when sprintId changes.
 * Pass null to skip loading. CONTRACTS.md §4.21 v1.16, ADR-027.
 */
export function useImpediments(sprintId: number | null): UseImpedimentsState {
  const [data, setData] = useState<Impediment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<McpError | null>(null);

  const run = useCallback(() => {
    if (sprintId === null) return;
    setLoading(true);
    setError(null);
    getImpediments(sprintId)
      .then((list) => { setData(list); setLoading(false); })
      .catch((err: unknown) => { setError(toMcpError(err)); setLoading(false); });
  }, [sprintId]);

  useEffect(() => {
    if (sprintId !== null) run();
    else { setData(null); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintId]);

  const save = useCallback(
    async (impediments: ImpedimentInput[]) => {
      if (sprintId === null) return;
      const prev = data;
      try {
        const updated = await setImpediments(sprintId, impediments);
        setData(updated);
      } catch (err: unknown) {
        setData(prev);
        throw err;
      }
    },
    [sprintId, data]
  );

  return { data, loading, error, run, save };
}

export interface UsePullRequestsState {
  data: PullRequest[] | null;
  loading: boolean;
  error: McpError | null;
  run: () => void;
  save: (pullRequests: PullRequestInput[]) => Promise<void>;
}

/**
 * Per-sprint pending-PR links (manual store). Loads on mount + when sprintId changes.
 * Pass null to skip loading. CONTRACTS.md §4.22 v1.16, ADR-027.
 */
export function usePullRequests(sprintId: number | null): UsePullRequestsState {
  const [data, setData] = useState<PullRequest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<McpError | null>(null);

  const run = useCallback(() => {
    if (sprintId === null) return;
    setLoading(true);
    setError(null);
    getPullRequests(sprintId)
      .then((list) => { setData(list); setLoading(false); })
      .catch((err: unknown) => { setError(toMcpError(err)); setLoading(false); });
  }, [sprintId]);

  useEffect(() => {
    if (sprintId !== null) run();
    else { setData(null); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintId]);

  const save = useCallback(
    async (pullRequests: PullRequestInput[]) => {
      if (sprintId === null) return;
      const prev = data;
      try {
        const updated = await setPullRequests(sprintId, pullRequests);
        setData(updated);
      } catch (err: unknown) {
        setData(prev);
        throw err;
      }
    },
    [sprintId, data]
  );

  return { data, loading, error, run, save };
}

// ── usePostScrum / useMeetingGoal (v1.20, ADR-031) ────────────────────────────

export interface UsePostScrumState {
  data: PostScrumNote[] | null;
  loading: boolean;
  error: McpError | null;
  run: () => void;
  /** Full-replace the sprint's post-scrum notes (replaces with the server result). */
  save: (notes: PostScrumInput[]) => Promise<void>;
}

/**
 * Per-sprint post-scrum notes (manual store). Loads on mount + when sprintId changes.
 * Pass null to skip loading. CONTRACTS.md §4.23 v1.20, ADR-031.
 */
export function usePostScrum(sprintId: number | null): UsePostScrumState {
  const [data, setData] = useState<PostScrumNote[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<McpError | null>(null);

  const run = useCallback(() => {
    if (sprintId === null) return;
    setLoading(true);
    setError(null);
    getPostScrum(sprintId)
      .then((list) => { setData(list); setLoading(false); })
      .catch((err: unknown) => { setError(toMcpError(err)); setLoading(false); });
  }, [sprintId]);

  useEffect(() => {
    if (sprintId !== null) run();
    else { setData(null); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintId]);

  const save = useCallback(
    async (notes: PostScrumInput[]) => {
      if (sprintId === null) return;
      const prev = data;
      try {
        const updated = await setPostScrum(sprintId, notes);
        setData(updated);
      } catch (err: unknown) {
        setData(prev);
        throw err;
      }
    },
    [sprintId, data]
  );

  return { data, loading, error, run, save };
}

export interface UseMeetingGoalState {
  data: MeetingGoal | null;
  loading: boolean;
  error: McpError | null;
  run: () => void;
  /** Set (or clear, when empty) the meeting goal; updates local state with the server result. */
  save: (goal: string) => Promise<void>;
}

/**
 * Per-sprint meeting goal (standup focus; manual store). Loads on mount + when sprintId changes.
 * Pass null to skip loading. CONTRACTS.md §4.24 v1.20, ADR-031.
 */
export function useMeetingGoal(sprintId: number | null): UseMeetingGoalState {
  const [data, setData] = useState<MeetingGoal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<McpError | null>(null);

  const run = useCallback(() => {
    if (sprintId === null) return;
    setLoading(true);
    setError(null);
    getMeetingGoal(sprintId)
      .then((mg) => { setData(mg); setLoading(false); })
      .catch((err: unknown) => { setError(toMcpError(err)); setLoading(false); });
  }, [sprintId]);

  useEffect(() => {
    if (sprintId !== null) run();
    else { setData(null); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintId]);

  const save = useCallback(
    async (goal: string) => {
      if (sprintId === null) return;
      const prev = data;
      try {
        const updated = await setMeetingGoal(sprintId, goal);
        setData(updated);
      } catch (err: unknown) {
        setData(prev);
        throw err;
      }
    },
    [sprintId, data]
  );

  return { data, loading, error, run, save };
}

// ── useIssuePullRequests (v1.22, ADR-034) ─────────────────────────────────────

/**
 * Linked PRs (across all repos) for a set of issue keys, from Jira's Development panel.
 * Refetches when the SET of keys changes (order-independent), request-guarded. Failures
 * resolve to {} so the caller renders nothing. CONTRACTS.md §4.25.
 */
export function useIssuePullRequests(keys: string[]): {
  data: Record<string, LinkedPr[]>;
  loading: boolean;
} {
  const [data, setData] = useState<Record<string, LinkedPr[]>>({});
  const [loading, setLoading] = useState(false);
  const key = [...keys].sort().join(",");
  const reqId = useRef(0);

  useEffect(() => {
    if (keys.length === 0) { setData({}); return; }
    const myReq = ++reqId.current;
    setLoading(true);
    getIssuePullRequests(keys)
      .then((prs) => { if (myReq === reqId.current) { setData(prs); setLoading(false); } })
      .catch(() => { if (myReq === reqId.current) { setData({}); setLoading(false); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading };
}
