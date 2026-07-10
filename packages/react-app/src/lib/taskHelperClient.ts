// Task Helper client (v1.44, ADR-054) — the signed-in user's own sprint tickets + the AI
// refine→prompt pipeline. Uses the shared credentialed fetch.

import { credFetch } from "./authClient";

export interface MyIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
}

export interface TaskHelpResult {
  refinedText: string;
  prompt: string;
}

/**
 * The signed-in user's assigned issues. v1.46 (ADR-055 Phase F): pass the board's selected
 * `sprintId` to scope the list to that sprint; omit it to fall back to all open sprints.
 */
export function getMyIssues(sprintId?: number): Promise<{ issues: MyIssue[] }> {
  const qs = sprintId === undefined ? "" : `?sprintId=${encodeURIComponent(sprintId)}`;
  return credFetch<{ issues: MyIssue[] }>(`/api/me/tasks/issues${qs}`, "GET");
}

export function runHelp(ticketKey: string, extraContext?: string): Promise<TaskHelpResult> {
  return credFetch<TaskHelpResult>("/api/me/tasks/help", "POST", { ticketKey, extraContext });
}
