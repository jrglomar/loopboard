/**
 * get_issue_descriptions tool (v1.14, ADR-025).
 *
 * For each input issue key, return the issue's description flattened to plain text
 * (reuses getIssue → adfToText). Used by the Linking page so the Dev-task plan is
 * drafted from each PO story's real description, not just its one-line summary.
 *
 * Fetches run in parallel; a missing/unreadable key contributes "" rather than
 * throwing, so a bulk caller stays resilient to one bad key. Read-only.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getIssue } from "../lib/jiraClient.js";

const schema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(50),
});

interface GetIssueDescriptionsOutput {
  descriptions: Record<string, string>;
}

async function handler(input: unknown): Promise<GetIssueDescriptionsOutput> {
  const args = schema.parse(input);

  const results = await Promise.all(
    args.keys.map(async (key) => {
      try {
        const issue = await getIssue(key);
        return [key, issue.description ?? ""] as const;
      } catch {
        // Missing/unreadable key → empty description (non-fatal for the batch).
        return [key, ""] as const;
      }
    })
  );

  const descriptions: Record<string, string> = {};
  for (const [key, text] of results) descriptions[key] = text;
  return { descriptions };
}

export const getIssueDescriptionsTool: ToolDef = {
  name: "get_issue_descriptions",
  description:
    "For each input issue key, return its description as plain text (Atlassian Document " +
    "Format flattened). Fetches run in parallel; a missing/unreadable key contributes an " +
    "empty string (never throws for one bad key). Read-only. Used by the Linking page to " +
    "draft each Dev task from the PO story's real description, not just its summary.",
  schema,
  handler,
};
