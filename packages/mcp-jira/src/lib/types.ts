export interface TicketRef {
  key: string;
  url: string;
  board: "PO" | "DEV";
}

export interface ActiveSprintRef {
  id: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  goal: string | null;
}

/** Shared type for sprint references across list_sprints, create_sprint, etc. (v1.4) */
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

export interface IssueSummary {
  key: string;
  summary: string;
  status: string; // e.g. "In Progress"
  statusCategory: "todo" | "inprogress" | "done";
  assignee: string | null; // display name
  assigneeAccountId: string | null; // v1.8 — Jira accountId (for assignment + roster derivation)
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

/** Output shape for the get_active_sprint tool (v1.4). */
export interface GetActiveSprintOutput {
  sprint: {
    id: number;
    name: string;
    state: string; // "active" | "future"
    startDate: string | null;
    endDate: string | null;
    goal: string | null;
  };
  activeSprints: ActiveSprintRef[];
  futureSprints: ActiveSprintRef[]; // v1.4 — earliest-first (next-up first)
  issuesByStatus: {
    todo: IssueSummary[];
    inprogress: IssueSummary[];
    codereview: IssueSummary[];
    done: IssueSummary[];
  };
  totals: {
    total: number;
    todo: number;
    inprogress: number;
    codereview: number;
    done: number;
    blocked: number;
    storyPointsTotal: number;
    storyPointsDone: number;
    storyPointsCodeReview: number; // v1.5 (ADR-014) — sum of code-review bucket points
  };
}

/** Represents a Jira user who can be assigned to tickets (v1.7, ADR-018). */
export interface AssignableUser {
  accountId: string;
  displayName: string;
  active: boolean;
}

/** A curated team roster member (v1.8, ADR-019). Persisted to JIRA_TEAM_FILE. */
export interface TeamMember {
  accountId: string;
  displayName: string;
}

/** Output shape for the get_daily_huddle tool (v1.2). */
export interface GetDailyHuddleOutput {
  sprintName: string;
  sprintId: number;
  boardId: number;
  generatedAt: string;
  inProgress: HuddleItem[];
  codeReview: HuddleItem[];
  blocked: HuddleItem[];
  done: HuddleItem[];
  upNext: HuddleItem[];
  summaryText: string;
}
