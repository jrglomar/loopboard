/**
 * set_draft_plan tool (v1.68, ADR-079; multi-developer point split v1.70, ADR-081) — full-replace
 * the PO sprint's DRAFT capacity plan.
 *
 * DRAFT ONLY: this tool NEVER writes to Jira — not the assignments, not the per-share points. It
 * persists a PO-side mapping of ticket keys onto an ARRAY of dev-team member shares, so one PO
 * ticket can be split across MULTIPLE developers, each carrying a DRAFT slice of the points (a
 * sanity check on ticket load per developer BEFORE real assignment). Real assignment remains
 * assign_issue from the Dev board's Planning/Linking flow; real points remain update_ticket.
 *
 * The client sends the whole assignments map (full replace, mirrors set_team_members). Every
 * key must match the same ticketKey format as get_ticket. Each key's share array is de-duped by
 * accountId (a developer appears at most once per ticket — last write wins) before storing.
 * Empty assignments with devSprintId null/omitted deletes the sprint's stored entry entirely.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { DraftShare } from "../lib/types.js";
import { readDraftPlans, writeDraftPlans } from "../lib/draftPlanStore.js";
import { TICKET_KEY_REGEX } from "./getTicket.js";

const MAX_ASSIGNMENTS = 300;
const MAX_SHARES_PER_TICKET = 50;

const shareSchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  points: z.number().min(0),
});

// The base shape — used by the MCP SDK for tool description and HTTP bridge shape info.
const baseSchema = z.object({
  sprintId: z.number().int().positive(),
  devSprintId: z.number().int().positive().nullable().optional(),
  assignments: z.record(
    z.string().regex(TICKET_KEY_REGEX, "ticketKey must match PROJECT-NUMBER format"),
    z.array(shareSchema)
  ),
});

// Full schema with the entry-count cap and per-ticket share-array bounds — used inside the
// handler for actual validation.
const fullSchema = baseSchema
  .refine((data) => Object.keys(data.assignments).length <= MAX_ASSIGNMENTS, {
    message: `assignments cannot contain more than ${MAX_ASSIGNMENTS} entries`,
    path: ["assignments"],
  })
  .refine((data) => Object.values(data.assignments).every((shares) => shares.length > 0), {
    message: "a ticket's share array cannot be empty — omit the key to leave a ticket undrafted",
    path: ["assignments"],
  })
  .refine(
    (data) =>
      Object.values(data.assignments).every((shares) => shares.length <= MAX_SHARES_PER_TICKET),
    {
      message: `a ticket's share array cannot contain more than ${MAX_SHARES_PER_TICKET} developer shares`,
      path: ["assignments"],
    }
  );

interface SetDraftPlanOutput {
  sprintId: number;
  devSprintId: number | null;
  assignments: Record<string, DraftShare[]>;
}

/** De-dupe one ticket's shares by accountId — a developer appears at most once; last write wins. */
function dedupeShares(shares: DraftShare[]): DraftShare[] {
  const byAccountId = new Map<string, DraftShare>();
  for (const share of shares) {
    byAccountId.set(share.accountId, share);
  }
  return [...byAccountId.values()];
}

async function handler(input: unknown): Promise<SetDraftPlanOutput> {
  // Use the full schema (with refinements) for actual validation
  const args = fullSchema.parse(input);
  const devSprintId = args.devSprintId ?? null;
  const key = String(args.sprintId);

  // De-dupe each ticket's shares by accountId (last write wins) before storing.
  const dedupedAssignments: Record<string, DraftShare[]> = {};
  for (const [issueKey, shares] of Object.entries(args.assignments)) {
    dedupedAssignments[issueKey] = dedupeShares(shares);
  }

  const all = readDraftPlans();

  // Empty assignments + no dev sprint selected → nothing worth keeping; delete the entry.
  const isEmpty = Object.keys(dedupedAssignments).length === 0 && devSprintId === null;
  if (isEmpty) {
    delete all[key];
  } else {
    all[key] = { devSprintId, assignments: dedupedAssignments };
  }
  writeDraftPlans(all);

  return {
    sprintId: args.sprintId,
    devSprintId,
    assignments: isEmpty ? {} : dedupedAssignments,
  };
}

export const setDraftPlanTool: ToolDef = {
  name: "set_draft_plan",
  description:
    "Replace the PO sprint's DRAFT capacity plan (full replace) — a mapping of ticket keys onto " +
    "an ARRAY of dev-team member shares (accountId + displayName + points), so one PO ticket can " +
    "be split across MULTIPLE developers, each carrying a DRAFT slice of the points. DRAFT ONLY: " +
    "this tool NEVER writes to Jira — not the assignments, not the points; use assign_issue for " +
    "real assignment and update_ticket for real points. Up to 300 ticket keys; every key must be " +
    "a valid ticket key (e.g. DEV-42); each key's share array holds 1-50 entries and is de-duped " +
    "by accountId (a developer appears at most once per ticket — last write wins); an empty " +
    "share array for a key is invalid — omit the key instead. devSprintId is optional — the " +
    "Dev-board sprint this draft targets — and is stored as null when omitted. Passing empty " +
    "assignments with devSprintId null/omitted deletes the sprint's saved draft. Persists to a " +
    "bridge-side JSON store (JIRA_DRAFT_PLAN_FILE).",
  schema: baseSchema,
  handler,
};
