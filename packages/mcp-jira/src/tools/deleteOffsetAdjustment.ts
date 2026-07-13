/**
 * delete_offset_adjustment tool (v1.54, ADR-065).
 * Remove a MANUAL offset adjustment from a developer's log by its id. No-op if the assignee/id is absent.
 * Managed from the Offset History dialog.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readOffset, writeOffset, summarizeOffset, removeAdjustment, type OffsetSummary } from "../lib/offsetStore.js";

const schema = z.object({
  assignee: z.string().min(1).max(120),
  id: z.string().min(1),
});

interface DeleteOffsetAdjustmentOutput {
  entries: Record<string, OffsetSummary>;
}

async function handler(input: unknown): Promise<DeleteOffsetAdjustmentOutput> {
  const args = schema.parse(input);
  const data = removeAdjustment(readOffset(), args.assignee, args.id);
  writeOffset(data);
  return { entries: summarizeOffset(data) };
}

export const deleteOffsetAdjustmentTool: ToolDef = {
  name: "delete_offset_adjustment",
  description:
    "Remove a MANUAL offset adjustment from a developer's log by its id (no-op if absent). Returns the " +
    "updated per-developer ledger summary.",
  schema,
  handler,
};
