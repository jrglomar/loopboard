// issuePrsClient — linked PRs from Jira's Development panel (v1.22, ADR-034).
// Multi-repo: wraps get_issue_pull_requests via the HTTP bridge.

import { callTool } from "./mcpClient";
import type { GetIssuePullRequestsOutput, LinkedPr } from "./types";

/** Fetch each issue key's linked PRs (across all repos). Empty input → {}. */
export async function getIssuePullRequests(
  keys: string[]
): Promise<Record<string, LinkedPr[]>> {
  if (keys.length === 0) return {};
  const res = await callTool<GetIssuePullRequestsOutput>("jira", "get_issue_pull_requests", { keys });
  return res.pullRequests;
}
