/**
 * set_impediments tool (v1.16, ADR-027) — full-replace the sprint's impediment list.
 *
 * The client sends the whole list (mirrors set_team_members / set_leaves). Items may
 * omit id/createdAt — the tool fills them so the client can add a blocker with just text.
 */

import { z } from "zod";
import { randomUUID } from "crypto";
import type { ToolDef } from "../lib/toolDef.js";
import { readImpediments, writeImpediments, type Impediment } from "../lib/impedimentsStore.js";

const itemSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1),
  ticketKey: z.string().optional(),
  createdAt: z.string().optional(),
  resolved: z.boolean().optional(),
});

const schema = z.object({
  sprintId: z.number().int().positive(),
  impediments: z.array(itemSchema).max(200),
});

interface SetImpedimentsOutput {
  sprintId: number;
  impediments: Impediment[];
}

async function handler(input: unknown): Promise<SetImpedimentsOutput> {
  const args = schema.parse(input);
  const now = new Date().toISOString();
  const normalized: Impediment[] = args.impediments.map((i) => ({
    id: i.id ?? randomUUID(),
    text: i.text,
    ...(i.ticketKey ? { ticketKey: i.ticketKey } : {}),
    createdAt: i.createdAt ?? now,
    ...(i.resolved !== undefined ? { resolved: i.resolved } : {}),
  }));

  const all = readImpediments();
  all[String(args.sprintId)] = normalized;
  writeImpediments(all);
  return { sprintId: args.sprintId, impediments: normalized };
}

export const setImpedimentsTool: ToolDef = {
  name: "set_impediments",
  description:
    "Replace the stored impediments/blockers for a sprint with the given list (full replace). " +
    "Items may omit id/createdAt — the tool fills them. Persists to a bridge-side JSON store.",
  schema,
  handler,
};
