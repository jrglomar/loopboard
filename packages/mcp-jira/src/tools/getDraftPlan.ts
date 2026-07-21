/**
 * get_draft_plan tool (v1.68, ADR-079; multi-developer point split v1.70, ADR-081).
 *
 * Returns the PO sprint's saved DRAFT capacity plan — a mapping of ticket keys onto an ARRAY of
 * dev-team member shares (a ticket may be split across multiple developers, each carrying a
 * DRAFT slice of the points). DRAFT ONLY: this tool NEVER calls Jira, it only reads a
 * bridge-side JSON store. No saved draft for the sprint → the empty-but-valid shape
 * (devSprintId: null, assignments: {}), not an error.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { DraftShare } from "../lib/types.js";
import { readDraftPlans } from "../lib/draftPlanStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
});

interface GetDraftPlanOutput {
  sprintId: number;
  devSprintId: number | null;
  assignments: Record<string, DraftShare[]>;
}

async function handler(input: unknown): Promise<GetDraftPlanOutput> {
  const args = schema.parse(input);
  const all = readDraftPlans();
  const entry = all[String(args.sprintId)];

  return {
    sprintId: args.sprintId,
    devSprintId: entry?.devSprintId ?? null,
    assignments: entry?.assignments ?? {},
  };
}

export const getDraftPlanTool: ToolDef = {
  name: "get_draft_plan",
  description:
    "Return the PO sprint's saved DRAFT capacity plan — a mapping of ticket keys onto an ARRAY " +
    "of dev-team member shares (accountId + displayName + a DRAFT points figure), since one PO " +
    "ticket may be split across multiple developers. Used to sanity-check ticket load against " +
    "per-developer capacity BEFORE real assignment. DRAFT ONLY: this tool NEVER calls Jira, it " +
    "reads a bridge-side JSON store. No saved draft for the sprint returns " +
    "{ devSprintId: null, assignments: {} } — not an error. Use set_draft_plan to update it, " +
    "and assign_issue for real Jira assignment.",
  schema,
  handler,
};
