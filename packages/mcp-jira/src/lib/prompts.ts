/**
 * MCP prompt templates for mcp-jira.
 *
 * Each exported function is a pure template — it takes arguments and returns
 * the prompt text string. These are registered via server.registerPrompt() in
 * src/index.ts, and are also directly unit-testable.
 *
 * Per ADR-004: no LLM calls here — these are instructions *to* Claude.
 */

// ---- Template functions ----

/**
 * Instructs Claude to draft a PO story + Dev task with Given/When/Then ACs,
 * then call create_po_ticket and create_dev_ticket (passing the new PO key).
 */
export function draftTicketsPrompt(featureDescription: string): string {
  return `You are an Agile assistant helping a Product Owner create well-structured Jira tickets.

Feature description:
${featureDescription}

Please do the following:

1. Draft a PO Story with:
   - A concise summary (max 255 chars)
   - A description written in user-story format: "As a [role], I want [goal], so that [benefit]"
   - Acceptance criteria in Given/When/Then format (at least 3 criteria)
   - Suggested story points (1, 2, 3, 5, 8, or 13)

2. Draft a Dev Task linked to the PO Story with:
   - A concise technical summary (max 255 chars)
   - A description with technical implementation details
   - Acceptance criteria covering implementation checklist

3. Call create_po_ticket with the PO Story fields.

4. Call create_dev_ticket with the Dev Task fields and pass the PO ticket key as linkedPoTicketKey.

Present the created ticket keys and URLs to the user.`;
}

/**
 * Instructs Claude to get_ticket, rewrite the description with context/scope/ACs,
 * then update_ticket.
 */
export function enhanceTicketPrompt(ticketKey: string): string {
  return `You are an Agile assistant helping improve a Jira ticket.

Ticket key: ${ticketKey}

Please do the following:

1. Call get_ticket to retrieve the current ticket content.

2. Rewrite the description to include:
   - Context: why this work is needed
   - Scope: what is and is not included
   - Acceptance criteria in Given/When/Then format (at least 3 criteria)
   Keep the original intent intact while adding structure and clarity.

3. Call update_ticket with the improved description (and optionally a clearer summary if needed).

Report what was changed and show the updated ticket URL.`;
}

/**
 * Instructs Claude to call get_daily_huddle and present a crisp standup briefing.
 */
export function dailyHuddlePrompt(boardId?: string): string {
  const boardArg = boardId ? ` with boardId ${boardId}` : "";
  return `You are an Agile assistant facilitating a daily standup.

Please do the following:

1. Call get_daily_huddle${boardArg} to get the current sprint status.

2. Present a crisp standup briefing in this format:
   - Sprint name and dates
   - What's in progress (list assignees and tasks)
   - Any blockers (highlight these clearly — they need immediate attention)
   - What's done recently
   - What's up next

Keep it concise — a standup should take 15 minutes, not 30.
If there are blockers, ask who can help unblock them.`;
}
