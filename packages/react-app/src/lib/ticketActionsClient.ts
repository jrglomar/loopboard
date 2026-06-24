// ticketActionsClient — Planning ticket actions (v1.15, ADR-026).
// Wraps get_transitions / transition_issue / move_issue_to_sprint via the HTTP bridge.

import { callTool } from "./mcpClient";

export interface IssueTransition {
  id: string;
  name: string;
  to: { name: string; category: "todo" | "inprogress" | "done" };
}

/** List the workflow transitions available from a ticket's current status. */
export async function getTransitions(
  ticketKey: string
): Promise<{ ticketKey: string; transitions: IssueTransition[] }> {
  return callTool<{ ticketKey: string; transitions: IssueTransition[] }>(
    "jira",
    "get_transitions",
    { ticketKey }
  );
}

/** Apply a transition (a real Jira write) and get the resulting status. */
export async function transitionIssue(
  ticketKey: string,
  transitionId: string
): Promise<{ ticketKey: string; status: string; statusCategory: "todo" | "inprogress" | "done" }> {
  return callTool<{ ticketKey: string; status: string; statusCategory: "todo" | "inprogress" | "done" }>(
    "jira",
    "transition_issue",
    { ticketKey, transitionId }
  );
}

/** Move a ticket to another sprint (a real Jira write). */
export async function moveIssueToSprint(
  ticketKey: string,
  sprintId: number
): Promise<{ ticketKey: string; sprintId: number }> {
  return callTool<{ ticketKey: string; sprintId: number }>(
    "jira",
    "move_issue_to_sprint",
    { ticketKey, sprintId }
  );
}
