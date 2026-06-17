/**
 * get_linked_issues tool (v1.11, ADR-022).
 *
 * For each input issue key, return the issues linked to it, filtered to a project
 * (default JIRA_DEV_PROJECT_KEY) — i.e. the Dev tickets already linked to each PO
 * story. Used by the Linking page so bulk creation doesn't duplicate.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { getLinkedIssues, type LinkedIssueRef } from "../lib/jiraClient.js";

const schema = z.object({
  keys: z.array(z.string().min(1)).min(1),
  // default = Dev project; pass "" to return links to ANY project.
  projectKey: z.string().optional(),
});

interface GetLinkedIssuesOutput {
  links: Record<string, LinkedIssueRef[]>;
}

async function handler(input: unknown): Promise<GetLinkedIssuesOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  // projectKey undefined → default Dev project; "" → no filter (any project).
  const filter = args.projectKey ?? cfg.JIRA_DEV_PROJECT_KEY;
  const prefix = filter ? `${filter}-` : "";

  const results = await Promise.all(
    args.keys.map(async (key) => {
      const all = await getLinkedIssues(key);
      const filtered = prefix ? all.filter((l) => l.key.startsWith(prefix)) : all;
      return [key, filtered] as const;
    })
  );

  const links: Record<string, LinkedIssueRef[]> = {};
  for (const [key, list] of results) links[key] = list;
  return { links };
}

export const getLinkedIssuesTool: ToolDef = {
  name: "get_linked_issues",
  description:
    "For each input issue key, return the issues linked to it, filtered to a project " +
    "(default JIRA_DEV_PROJECT_KEY — the Dev tickets linked to each PO story). Pass " +
    "projectKey='' to return links to any project. Fetches run in parallel; a missing/" +
    "unreadable key contributes an empty array (never throws for one bad key). Used by the " +
    "Linking page to show whether a PO story already has a linked Dev ticket.",
  schema,
  handler,
};
