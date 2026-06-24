// prsClient — Huddle pending-PR store (v1.16, ADR-027).
// Wraps get_pull_requests / set_pull_requests via the HTTP bridge.

import { callTool } from "./mcpClient";
import type { PullRequest } from "./types";

/** New/edited PR as sent to set_pull_requests (id/addedAt filled server-side). */
export type PullRequestInput = {
  id?: string;
  url: string;
  title?: string;
  ticketKey?: string;
  status?: string;
  addedAt?: string;
};

export async function getPullRequests(sprintId: number): Promise<PullRequest[]> {
  const res = await callTool<{ sprintId: number; pullRequests: PullRequest[] }>(
    "jira",
    "get_pull_requests",
    { sprintId }
  );
  return res.pullRequests;
}

export async function setPullRequests(
  sprintId: number,
  pullRequests: PullRequestInput[]
): Promise<PullRequest[]> {
  const res = await callTool<{ sprintId: number; pullRequests: PullRequest[] }>(
    "jira",
    "set_pull_requests",
    { sprintId, pullRequests }
  );
  return res.pullRequests;
}
