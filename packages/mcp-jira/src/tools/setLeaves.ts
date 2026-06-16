/**
 * set_leaves tool (v1.5, ADR-016).
 *
 * Replace an assignee's leave dates for a sprint.
 * Empty dates array clears the assignee's entry.
 * Dates are deduped and sorted before storing.
 *
 * Read-modify-write on JIRA_LEAVES_FILE.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readLeaves, writeLeaves } from "../lib/leavesStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
  assignee: z.string().min(1).max(120),
  dates: z.array(
    z.string().regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "Each date must be in YYYY-MM-DD format"
    )
  ),
});

interface SetLeavesOutput {
  sprintId: number;
  leaves: Record<string, string[]>;
}

async function handler(input: unknown): Promise<SetLeavesOutput> {
  const args = schema.parse(input);
  const sprintKey = String(args.sprintId);

  // Read-modify-write
  const data = readLeaves();
  const sprintMap: Record<string, string[]> = { ...(data[sprintKey] ?? {}) };

  if (args.dates.length === 0) {
    // Empty dates → clear the assignee's entry
    delete sprintMap[args.assignee];
  } else {
    // Dedupe + sort
    const deduped = [...new Set(args.dates)].sort();
    sprintMap[args.assignee] = deduped;
  }

  // If the sprint map becomes empty, we may drop it (contract allows this)
  if (Object.keys(sprintMap).length === 0) {
    delete data[sprintKey];
  } else {
    data[sprintKey] = sprintMap;
  }

  writeLeaves(data);

  // Return the updated sprint leaves (or {} when all entries were cleared)
  const updatedLeaves = data[sprintKey] ?? {};
  return { sprintId: args.sprintId, leaves: updatedLeaves };
}

export const setLeavesTool: ToolDef = {
  name: "set_leaves",
  description:
    "Set (replace) an assignee's leave dates for a specific sprint. " +
    "Dates are ISO strings (YYYY-MM-DD); they are deduped and sorted before storing. " +
    "Pass an empty dates array to clear the assignee's leaves for the sprint. " +
    "Returns the updated assignee→dates map for the sprint. " +
    "Data is persisted to a local JSON file on the mcp-jira host (JIRA_LEAVES_FILE).",
  schema,
  handler,
};
