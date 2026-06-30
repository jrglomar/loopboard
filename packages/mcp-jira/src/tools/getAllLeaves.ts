/**
 * get_all_leaves tool (v1.29, ADR-041).
 *
 * Return the ENTIRE typed leaves store — every sprint's leaves in one read — so the
 * forward, multi-sprint leave planner can render recent + active + upcoming sprints
 * without one get_leaves call per sprint. Legacy untyped dates are normalized to "VL".
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readLeaves, type LeavesFile } from "../lib/leavesStore.js";

const schema = z.object({}).strict();

interface GetAllLeavesOutput {
  // sprintId (string) → assignee → { "YYYY-MM-DD": LeaveType }
  leaves: LeavesFile;
}

async function handler(input: unknown): Promise<GetAllLeavesOutput> {
  schema.parse(input ?? {});
  return { leaves: readLeaves() };
}

export const getAllLeavesTool: ToolDef = {
  name: "get_all_leaves",
  description:
    "Return the ENTIRE typed leaves store keyed by sprint id: " +
    "{ [sprintId]: { [assignee]: { 'YYYY-MM-DD': 'VL'|'EL'|'Holiday'|'Offset' } } }. " +
    "One read for the multi-sprint leave planner. Legacy untyped dates read as 'VL'. " +
    "Reads a bridge-side JSON file (JIRA_LEAVES_FILE); returns {} when none recorded.",
  schema,
  handler,
};
