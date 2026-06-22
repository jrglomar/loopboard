// Verbatim copies of response types from CONTRACTS.md §4/§5 (ADR-005 sanctions this duplication)

// ── Board context types (CONTRACTS.md §2, ADR-017, v1.6) ─────────────────────

/** A single board reference from GET /api/health .boards (ADR-017) */
export interface BoardRef {
  id: number;
  projectKey: string;
}

/** Boards config from GET /api/health .boards — dev + po (ADR-017) */
export interface Boards {
  dev: BoardRef;
  po: BoardRef;
}

/** Which board is currently selected in the UI */
export type BoardKey = "dev" | "po";

/**
 * Shared board+sprint context props (v1.13, ADR-024). When App passes these, the
 * page is CONTROLLED (board + the "explicit pick" sprint live in App); when absent,
 * the page is uncontrolled and keeps its own state (standalone / tests). The shared
 * sprintId is an explicit pick (null = none → page applies its per-ceremony default).
 */
export interface SharedSprintProps {
  boardKey?: BoardKey;
  sprintId?: number | null;
  onBoardChange?: (key: BoardKey) => void;
  onSprintChange?: (id: number) => void;
}

// ── mcp-jira shared types (CONTRACTS.md §4) ──────────────────────────────────

/** ActiveSprintRef — one entry in the activeSprints list (CONTRACTS.md §4.3 v1.1) */
export interface ActiveSprintRef {
  id: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  goal: string | null;
}

/**
 * SprintRef — full sprint descriptor used by create_sprint / list_sprints /
 * get_sprint_report / get_velocity (CONTRACTS.md §4.10–§4.13 v1.4)
 */
export interface SprintRef {
  id: number;
  name: string;
  state: "active" | "future" | "closed";
  startDate: string | null;
  endDate: string | null;
  completeDate: string | null; // closed sprints only, else null
  goal: string | null;
  boardId: number;
}

/** create_sprint request body (CONTRACTS.md §4.10 v1.4) */
export interface CreateSprintRequest {
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  boardId?: number;
}

/** list_sprints response (CONTRACTS.md §4.11 v1.4) */
export interface ListSprintsResponse {
  boardId: number;
  active: SprintRef[];
  future: SprintRef[];
  closed: SprintRef[];
}

export interface TicketRef {
  key: string;
  url: string;
  board: "PO" | "DEV";
}

export interface IssueSummary {
  key: string;
  summary: string;
  status: string; // e.g. "In Progress"
  statusCategory: "todo" | "inprogress" | "done";
  assignee: string | null; // display name
  /** v1.8 — Jira accountId (for assignment pre-select + roster derivation) */
  assigneeAccountId: string | null;
  storyPoints: number | null;
  issueType: string; // "Story", "Task", "Bug", ...
  url: string; // browse URL
  blocked: boolean;
}

export interface HuddleItem {
  key: string;
  summary: string;
  assignee: string | null;
  status: string;
}

// ── mcp-jira tool outputs (CONTRACTS.md §4.1–§4.6) ───────────────────────────

/** create_po_ticket output (CONTRACTS.md §4.1 v1.4) */
export type CreatePoTicketOutput = TicketRef & {
  sprintId?: number;
  sprintWarning?: string;
  // board: "PO"
};

/** create_dev_ticket output (CONTRACTS.md §4.2 v1.4) */
export type CreateDevTicketOutput = TicketRef & {
  linkedTo?: string;
  linkWarning?: string;
  sprintId?: number;
  sprintWarning?: string;
  // board: "DEV"
};

/** get_active_sprint output */
export interface GetActiveSprintOutput {
  sprint: {
    id: number;
    name: string;
    state: "active" | "future"; // v1.4: may be future when no active sprint exists
    startDate: string | null;
    endDate: string | null;
    goal: string | null;
  };
  /** ALL active sprints on the board, latest-first (v1.1, CONTRACTS.md §4.3) */
  activeSprints: ActiveSprintRef[];
  /** ALL future sprints, earliest-first — next-up first (v1.4, CONTRACTS.md §4.3) */
  futureSprints: ActiveSprintRef[];
  issuesByStatus: {
    todo: IssueSummary[];
    inprogress: IssueSummary[];
    codereview: IssueSummary[]; // v1.2 (CONTRACTS.md §4.3)
    done: IssueSummary[];
  };
  totals: {
    total: number;
    todo: number;
    inprogress: number;
    codereview: number; // v1.2 (CONTRACTS.md §4.3)
    done: number;
    blocked: number;
    storyPointsTotal: number;
    storyPointsDone: number;
    storyPointsCodeReview: number; // v1.5 — sum of code-review bucket points (CONTRACTS.md §4.3)
  };
}

/** get_ticket output */
export interface GetTicketOutput {
  key: string;
  url: string;
  summary: string;
  description: string; // plain text extracted from ADF
  status: string;
  statusCategory: "todo" | "inprogress" | "done";
  assignee: string | null;
  reporter: string | null;
  storyPoints: number | null;
  issueType: string;
  labels: string[];
  created: string; // ISO 8601
  updated: string; // ISO 8601
}

/** update_ticket output */
export interface UpdateTicketOutput {
  key: string;
  url: string;
  updatedFields: string[];
}

/** get_daily_huddle output */
export interface GetDailyHuddleOutput {
  sprintName: string;
  sprintId: number; // added in v1.1 (CONTRACTS.md §4.6)
  boardId: number;
  generatedAt: string; // ISO timestamp
  inProgress: HuddleItem[];
  codeReview: HuddleItem[]; // v1.2 (CONTRACTS.md §4.6) — camelCase per contract
  blocked: HuddleItem[];
  done: HuddleItem[];
  upNext: HuddleItem[];
  summaryText: string;
}

// ── AI drafting types (CONTRACTS.md §4.9 v1.1) ───────────────────────────────

/** AI status from GET /api/health .ai field */
export interface AiStatus {
  enabled: boolean;
  provider: string | null;
  model: string | null;
}

/** Single message in an AI conversation */
export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

/** POST /api/ai/draft-tickets request body */
export interface DraftRequest {
  messages: AiMessage[];
  storyPoints?: number;
}

/** POST /api/ai/draft-tickets response */
export interface DraftResponse {
  assistantMessage: string;
  po: { summary: string; description: string; storyPoints: number | null };
  dev: { summary: string; description: string };
  provider: "anthropic" | "github";
  model: string;
}

/** POST /api/ai/enhance-ticket request body */
export interface EnhanceRequest {
  ticketKey: string;
  notes?: string;
  current: { summary: string; description: string };
}

/** POST /api/ai/enhance-ticket response */
export interface EnhanceResponse {
  assistantMessage: string;
  summary: string;
  description: string;
  provider: "anthropic" | "github";
  model: string;
}

// ── Phase 3 report types (CONTRACTS.md §4.12 / §4.13 / §4.9 v1.4) ──────────

/**
 * get_sprint_report output — CONTRACTS.md §4.12 v1.4
 * Committed/completed points, completion rate, completed vs carryover issue
 * lists, blocker count, and per-assignee breakdown.
 */
export interface SprintReport {
  sprint: SprintRef;
  committedPoints: number;
  completedPoints: number;
  completionRate: number; // completedPoints / committedPoints, 0 when committed=0
  totalCount: number;
  completedCount: number;
  carryoverCount: number;
  blockedCount: number;
  completed: IssueSummary[];
  notCompleted: IssueSummary[];
  byAssignee: Array<{
    name: string; // "Unassigned" for null
    donePoints: number;
    totalPoints: number;
    doneCount: number;
    totalCount: number;
  }>;
}

/**
 * get_velocity output — CONTRACTS.md §4.13 v1.4
 * Last N closed sprints (chronological) + average + heuristic forecast.
 */
export interface VelocityData {
  boardId: number;
  sprintCount: number;
  sprints: Array<{
    id: number;
    name: string;
    committedPoints: number;
    completedPoints: number;
    completeDate: string | null;
  }>;
  averageCompleted: number;
  forecastNext: number; // = averageCompleted (heuristic, not a commitment)
}

/**
 * POST /api/ai/sprint-summary request body — CONTRACTS.md §4.9 v1.4
 */
export interface SprintSummaryRequest {
  sprintName: string;
  state: string;
  startDate?: string;
  endDate?: string;
  goal?: string | null;
  committedPoints: number;
  completedPoints: number;
  completedCount: number;
  totalCount: number;
  carryoverCount: number;
  blockedCount: number;
  byAssignee: Array<{
    name: string;
    donePoints: number;
    totalPoints: number;
    doneCount: number;
    totalCount: number;
  }>;
}

/**
 * POST /api/ai/sprint-summary response — CONTRACTS.md §4.9 v1.4
 */
export interface SprintSummaryResponse {
  summary: string;
  provider: "anthropic" | "github";
  model: string;
}

// ── Linking types (CONTRACTS.md §4.17 + §4.9 plan-dev-tickets, v1.11, ADR-022) ─

/** A single issue linked to another (from get_linked_issues). */
export interface LinkedIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
}

/** get_linked_issues output — keyed by the input (PO) key. */
export interface GetLinkedIssuesResponse {
  links: Record<string, LinkedIssue[]>;
}

/** POST /api/ai/plan-dev-tickets input. */
export interface PlanDevTicketsRequest {
  poStories: Array<{ key: string; summary: string; description?: string }>;
  instructions?: string;
}

/** One planned Dev draft for a PO story. */
export interface PlanDevTicketItem {
  poKey: string;
  devSummary: string;
  devDescription: string;
}

/** POST /api/ai/plan-dev-tickets output. */
export interface PlanDevTicketsResponse {
  assistantMessage: string;
  items: PlanDevTicketItem[];
  provider: "anthropic" | "github";
  model: string;
}

// ── Assignment types (CONTRACTS.md §4.15 v1.7, ADR-018) ─────────────────────

/**
 * A user who can be assigned to Jira issues.
 * From get_assignable_users — active users only, sorted by displayName.
 */
export interface AssignableUser {
  accountId: string;
  displayName: string;
  active: boolean;
}

// ── Team roster types (CONTRACTS.md §4.16 v1.8, ADR-019) ────────────────────

/**
 * A member of the curated per-board team roster.
 * From get_team_members / set_team_members.
 */
export interface TeamMember {
  accountId: string;
  displayName: string;
}

/**
 * A distinct assignee from recent sprints — used to seed the team roster.
 * From get_recent_assignees (sorted by ticketCount desc).
 */
export interface RecentAssignee extends TeamMember {
  ticketCount: number;
}

// ── mcp-github types (CONTRACTS.md §5) ───────────────────────────────────────

export interface PrSummary {
  number: number;
  title: string;
  author: string;
  branch: string;
  baseBranch: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  url: string; // html_url
  jiraKeys: string[];
}

/** list_prs output */
export interface ListPrsOutput {
  repo: string;
  prs: PrSummary[];
}

/** get_pr output */
export type GetPrOutput = PrSummary & {
  body: string | null;
  mergeable: boolean | null;
  headSha: string;
};

/** link_pr_to_ticket output */
export interface LinkPrOutput {
  prUrl: string;
  results: Array<{
    ticketKey: string;
    remoteLinkCreated: boolean;
    commentPosted: boolean;
    error?: string;
  }>;
}

/** sync_pr_links output */
export interface SyncPrLinksOutput {
  repo: string;
  linked: Array<{ number: number; ticketKeys: string[] }>;
  skipped: Array<{ number: number; reason: string }>;
}
