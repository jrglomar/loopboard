/**
 * set_post_scrum tool (v1.20, ADR-031) — full-replace the sprint's post-scrum notes.
 *
 * The client sends the whole list (mirrors set_impediments). Items may omit id/createdAt —
 * the tool fills them so the client can add a note with just person + text.
 */

import { z } from "zod";
import { randomUUID } from "crypto";
import type { ToolDef } from "../lib/toolDef.js";
import { readPostScrum, writePostScrum, type PostScrumNote } from "../lib/postScrumStore.js";

const itemSchema = z.object({
  id: z.string().optional(),
  person: z.string().min(1),
  note: z.string().min(1),
  createdAt: z.string().optional(),
  resolved: z.boolean().optional(),
});

const schema = z.object({
  sprintId: z.number().int().positive(),
  notes: z.array(itemSchema).max(200),
});

interface SetPostScrumOutput {
  sprintId: number;
  notes: PostScrumNote[];
}

async function handler(input: unknown): Promise<SetPostScrumOutput> {
  const args = schema.parse(input);
  const now = new Date().toISOString();
  const normalized: PostScrumNote[] = args.notes.map((n) => ({
    id: n.id ?? randomUUID(),
    person: n.person,
    note: n.note,
    createdAt: n.createdAt ?? now,
    ...(n.resolved !== undefined ? { resolved: n.resolved } : {}),
  }));

  const all = readPostScrum();
  all[String(args.sprintId)] = normalized;
  writePostScrum(all);
  return { sprintId: args.sprintId, notes: normalized };
}

export const setPostScrumTool: ToolDef = {
  name: "set_post_scrum",
  description:
    "Replace the stored post-scrum notes for a sprint with the given list (full replace). " +
    "Items may omit id/createdAt — the tool fills them. Persists to a bridge-side JSON store.",
  schema,
  handler,
};
