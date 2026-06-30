/**
 * set_leaves tool (v1.5, ADR-016; typed v1.26, ADR-038).
 *
 * Replace an assignee's TYPED leave days for a sprint (full replace per assignee).
 * Empty entries clears the assignee's entry. Read-modify-write on JIRA_LEAVES_FILE.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readLeaves, writeLeaves, LEAVE_TYPES, type AssigneeLeaves } from "../lib/leavesStore.js";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// v1.26: accept typed `entries` OR legacy `dates` (string[] → all "VL"). At least one is required;
// `dates` keeps the pre-v1.26 frontend working through the transition. `entries` wins if both sent.
const baseSchema = z.object({
  sprintId: z.number().int().positive(),
  assignee: z.string().min(1).max(120),
  entries: z
    .array(
      z.object({
        date: z.string().regex(dateRegex, "date must be YYYY-MM-DD"),
        type: z.enum(LEAVE_TYPES as unknown as [string, ...string[]]),
      })
    )
    .optional(),
  dates: z.array(z.string().regex(dateRegex, "date must be YYYY-MM-DD")).optional(),
});

// Full schema with the refine — used inside the handler (ToolDef.schema must be a ZodObject).
const fullSchema = baseSchema.refine((v) => v.entries !== undefined || v.dates !== undefined, {
  message: "Provide either entries (typed) or dates (legacy).",
});

interface SetLeavesOutput {
  sprintId: number;
  leaves: Record<string, AssigneeLeaves>;
}

async function handler(input: unknown): Promise<SetLeavesOutput> {
  const args = fullSchema.parse(input);
  const sprintKey = String(args.sprintId);

  // Normalize legacy `dates` → typed entries (all "VL") when `entries` is absent.
  const entries =
    args.entries ?? (args.dates ?? []).map((date) => ({ date, type: "VL" as const }));

  const data = readLeaves();
  const sprintMap: Record<string, AssigneeLeaves> = { ...(data[sprintKey] ?? {}) };

  if (entries.length === 0) {
    delete sprintMap[args.assignee];
  } else {
    // Build the date → type map (last write wins on duplicate dates).
    const typed: AssigneeLeaves = {};
    for (const e of entries) typed[e.date] = e.type as AssigneeLeaves[string];
    sprintMap[args.assignee] = typed;
  }

  if (Object.keys(sprintMap).length === 0) delete data[sprintKey];
  else data[sprintKey] = sprintMap;

  writeLeaves(data);
  return { sprintId: args.sprintId, leaves: data[sprintKey] ?? {} };
}

export const setLeavesTool: ToolDef = {
  name: "set_leaves",
  description:
    "Set (replace) an assignee's TYPED leave days for a sprint. Input entries are " +
    "{ date: 'YYYY-MM-DD', type: 'VL'|'EL'|'Holiday'|'Offset' }. Pass an empty entries array to " +
    "clear the assignee's leaves. Legacy `dates: string[]` is also accepted (→ all 'VL'). " +
    "Returns the updated assignee→{date:type} map for the sprint. " +
    "Persisted to a local JSON file on the mcp-jira host (JIRA_LEAVES_FILE).",
  schema: baseSchema,
  handler,
};
