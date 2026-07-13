/**
 * add_offset_adjustment tool (v1.54, ADR-065).
 * Append a MANUAL offset adjustment to a developer's log — a signed, non-zero integer with an optional
 * note, on top of the auto-computed earned − spent and the one-time opening balance. The server assigns
 * the id + createdAt. Managed from the Offset History dialog.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readOffset, writeOffset, summarizeOffset, addAdjustment, type OffsetSummary } from "../lib/offsetStore.js";

// Tool-facing schema stays a plain ZodObject (needed for JSON-Schema generation); the non-zero rule is
// enforced by a refined variant in the handler (the updateTicket/setLeaves pattern).
// v1.55 (ADR-066): amount is a DECIMAL-capable number (teams credit half-points, e.g. 0.5), not an int.
const schema = z.object({
  assignee: z.string().min(1).max(120),
  amount: z.number(),
  note: z.string().max(200).optional(),
});
const validated = schema.refine((a) => a.amount !== 0, { message: "amount must be non-zero", path: ["amount"] });

interface AddOffsetAdjustmentOutput {
  entries: Record<string, OffsetSummary>;
}

async function handler(input: unknown): Promise<AddOffsetAdjustmentOutput> {
  const args = validated.parse(input);
  const data = addAdjustment(readOffset(), args.assignee, args.amount, args.note);
  writeOffset(data);
  return { entries: summarizeOffset(data) };
}

export const addOffsetAdjustmentTool: ToolDef = {
  name: "add_offset_adjustment",
  description:
    "Append a MANUAL offset adjustment to a developer's log: a signed, non-zero number (decimals allowed, " +
    "e.g. 0.5) with an optional note, added on top of the auto-computed earned − spent and the one-time " +
    "opening balance. Returns the updated per-developer ledger summary.",
  schema,
  handler,
};
