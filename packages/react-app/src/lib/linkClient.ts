// linkClient.ts — CONTRACTS.md §4.17 v1.11, ADR-022
// Wraps get_linked_issues via the HTTP bridge. Same McpError semantics as mcpClient.

import { callTool } from "./mcpClient";
import type { GetLinkedIssuesResponse, GetIssueDescriptionsResponse } from "./types";

/**
 * For each PO key, fetch its existing linked Dev tickets (default projectKey = Dev).
 * Pass projectKey="" to return links to any project. Returns `{ links: { poKey: LinkedIssue[] } }`
 * with an entry for every input key ([] when none).
 */
export async function getLinkedIssues(
  keys: string[],
  projectKey?: string
): Promise<GetLinkedIssuesResponse> {
  const input: { keys: string[]; projectKey?: string } = { keys };
  if (projectKey !== undefined) input.projectKey = projectKey;
  return callTool<GetLinkedIssuesResponse>("jira", "get_linked_issues", input);
}

/**
 * For each issue key, fetch its description as plain text (v1.14, ADR-025). Returns
 * `{ descriptions: { key: string } }` with an entry for every input key ("" when none).
 * Used by the Linking page to draft each Dev task from the PO story's real description.
 */
export async function getIssueDescriptions(
  keys: string[]
): Promise<GetIssueDescriptionsResponse> {
  return callTool<GetIssueDescriptionsResponse>("jira", "get_issue_descriptions", { keys });
}
