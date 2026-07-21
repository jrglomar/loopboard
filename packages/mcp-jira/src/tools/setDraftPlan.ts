/**
 * set_draft_plan tool (v1.68, ADR-079) — full-replace the PO sprint's DRAFT capacity plan.
 *
 * DRAFT ONLY: this tool NEVER writes to Jira. It persists a PO-side mapping of ticket keys onto
 * dev-team members (a sanity check on ticket load per developer BEFORE real assignment). Real
 * assignment remains assign_issue from the Dev board's Planning/Linking flow.
 *
 * The client sends the whole assignments map (full replace, mirrors set_team_members). Every
 * key must match the same ticketKey format as get_ticket. Empty assignments with devSprintId
 * null/omitted deletes the sprint's stored entry entirely.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { DraftAssignment } from "../lib/types.js";
import { readDraftPlans, writeDraftPlans } from "../lib/draftPlanStore.js";
import { TICKET_KEY_REGEX } from "./getTicket.js";

const MAX_ASSIGNMENTS = 300;

const assignmentSchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().min(1),
});

// The base shape — used by the MCP SDK for tool description and HTTP bridge shape info.
const baseSchema = z.object({
  sprintId: z.number().int().positive(),
  devSprintId: z.number().int().positive().nullable().optional(),
  assignments: z.record(
    z.string().regex(TICKET_KEY_REGEX, "ticketKey must match PROJECT-NUMBER format"),
    assignmentSchema
  ),
});

// Full schema with the ≤300 cap — used inside the handler for actual validation.
const fullSchema = baseSchema.refine(
  (data) => Object.keys(data.assignments).length <= MAX_ASSIGNMENTS,
  {
    message: `assignments cannot contain more than ${MAX_ASSIGNMENTS} entries`,
    path: ["assignments"],
  }
);

interface SetDraftPlanOutput {
  sprintId: number;
  devSprintId: number | null;
  assignments: Record<string, DraftAssignment>;
}

async function handler(input: unknown): Promise<SetDraftPlanOutput> {
  // Use the full schema (with refine) for actual validation
  const args = fullSchema.parse(input);
  const devSprintId = args.devSprintId ?? null;
  const key = String(args.sprintId);

  const all = readDraftPlans();

  // Empty assignments + no dev sprint selected → nothing worth keeping; delete the entry.
  const isEmpty = Object.keys(args.assignments).length === 0 && devSprintId === null;
  if (isEmpty) {
    delete all[key];
  } else {
    all[key] = { devSprintId, assignments: args.assignments };
  }
  writeDraftPlans(all);

  return { sprintId: args.sprintId, devSprintId, assignments: isEmpty ? {} : args.assignments };
}

export const setDraftPlanTool: ToolDef = {
  name: "set_draft_plan",
  description:
    "Replace the PO sprint's DRAFT capacity plan (full replace) — a mapping of ticket keys onto " +
    "dev-team members (accountId + displayName), used to sanity-check ticket load against " +
    "per-developer capacity BEFORE real assignment. DRAFT ONLY: this tool NEVER writes to Jira; " +
    "use assign_issue for real assignment. Up to 300 entries; every assignments key must be a " +
    "valid ticket key (e.g. DEV-42). devSprintId is optional — the Dev-board sprint this draft " +
    "targets — and is stored as null when omitted. Passing empty assignments with devSprintId " +
    "null/omitted deletes the sprint's saved draft. Persists to a bridge-side JSON store " +
    "(JIRA_DRAFT_PLAN_FILE).",
  schema: baseSchema,
  handler,
};
