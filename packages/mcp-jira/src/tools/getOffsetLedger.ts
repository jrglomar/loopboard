/**
 * get_offset_ledger tool (v1.26, ADR-038).
 * Return each developer's computed offset standing (earned/spent/manualAdjust/balance).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readOffset, summarizeOffset, type OffsetSummary } from "../lib/offsetStore.js";

const schema = z.object({}).strict();

interface GetOffsetLedgerOutput {
  entries: Record<string, OffsetSummary>;
}

async function handler(input: unknown): Promise<GetOffsetLedgerOutput> {
  schema.parse(input ?? {});
  return { entries: summarizeOffset(readOffset()) };
}

export const getOffsetLedgerTool: ToolDef = {
  name: "get_offset_ledger",
  description:
    "Return each developer's offset-point standing — earned (Σ across sprints), spent (Σ Offset " +
    "leaves), manualAdjust, and balance (earned − spent + manualAdjust). Reads a bridge-side store.",
  schema,
  handler,
};
