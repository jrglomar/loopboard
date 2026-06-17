// linkClient.ts — CONTRACTS.md §4.17 v1.11, ADR-022
// Wraps get_linked_issues via the HTTP bridge. Same McpError semantics as mcpClient.

import { callTool } from "./mcpClient";
import type { GetLinkedIssuesResponse } from "./types";

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
