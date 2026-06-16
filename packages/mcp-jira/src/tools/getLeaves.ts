/**
 * get_leaves tool (v1.5, ADR-016).
 *
 * Returns the per-sprint leave dates for all assignees of a given sprint.
 * Reads from the JIRA_LEAVES_FILE JSON store (missing file → {}).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readLeaves } from "../lib/leavesStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
});

interface GetLeavesOutput {
  sprintId: number;
  leaves: Record<string, string[]>;
}

async function handler(input: unknown): Promise<GetLeavesOutput> {
  const args = schema.parse(input);
  const data = readLeaves();
  const sprintKey = String(args.sprintId);
  const leaves = data[sprintKey] ?? {};
  return { sprintId: args.sprintId, leaves };
}

export const getLeavesTool: ToolDef = {
  name: "get_leaves",
  description:
    "Get the per-sprint leave dates (days off) for all assignees of the given sprint. " +
    "Returns a map of assignee display name → ISO date strings (YYYY-MM-DD). " +
    "Returns an empty map when no leaves have been recorded for the sprint. " +
    "Data is persisted to a local JSON file on the mcp-jira host (JIRA_LEAVES_FILE).",
  schema,
  handler,
};
