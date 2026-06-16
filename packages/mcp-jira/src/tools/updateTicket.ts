import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { updateIssue } from "../lib/jiraClient.js";

// The base shape — used by the MCP SDK for tool description and HTTP bridge shape info.
const baseSchema = z.object({
  ticketKey: z
    .string()
    .regex(
      /^[A-Z][A-Z0-9]{1,9}-\d+$/,
      "ticketKey must match PROJECT-NUMBER format"
    ),
  summary: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
});

// Full schema with .refine — used inside the handler for actual validation.
const fullSchema = baseSchema.refine(
  (data) => data.summary !== undefined || data.description !== undefined,
  { message: "At least one of summary or description must be provided" }
);

interface UpdateOutput {
  key: string;
  url: string;
  updatedFields: string[];
}

async function handler(input: unknown): Promise<UpdateOutput> {
  // Use the full schema (with refine) for actual validation
  const args = fullSchema.parse(input);
  const cfg = getConfig();

  await updateIssue(args.ticketKey, {
    summary: args.summary,
    description: args.description,
  });

  const updatedFields: string[] = [];
  if (args.summary !== undefined) updatedFields.push("summary");
  if (args.description !== undefined) updatedFields.push("description");

  return {
    key: args.ticketKey,
    url: `${cfg.JIRA_BASE_URL}/browse/${args.ticketKey}`,
    updatedFields,
  };
}

export const updateTicket: ToolDef = {
  name: "update_ticket",
  description:
    "Update a Jira ticket's summary and/or description. At least one field must be provided. " +
    "Description is converted to ADF before saving. Returns which fields were updated.",
  // Use baseSchema (ZodObject) for the ToolDef.schema — the refine runs inside handler.
  schema: baseSchema,
  handler,
};
