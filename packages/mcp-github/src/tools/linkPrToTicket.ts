// link_pr_to_ticket tool — per CONTRACTS.md §5.3

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { githubClient } from "../lib/githubClient.js";
import { createRemoteLink } from "../lib/jiraClient.js";
import { detectJiraKeys } from "../lib/jiraKeys.js";
import { ValidationError } from "../lib/errors.js";
import { resolveRepo } from "./listPrs.js";

const schema = z.object({
  repo: z
    .string()
    .optional()
    .describe('Repository as "owner/name". Defaults to GITHUB_REPO env var.'),
  number: z.number().int().positive().describe("PR number"),
  ticketKey: z
    .string()
    .optional()
    .describe(
      "Jira ticket key (e.g. DEV-42). If omitted, auto-detected from PR title/branch/body.",
    ),
});

export interface LinkResult {
  ticketKey: string;
  remoteLinkCreated: boolean;
  commentPosted: boolean;
  error?: string;
}

export async function performLinking(opts: {
  owner: string;
  repo: string;
  number: number;
  prUrl: string;
  prTitle: string;
  ticketKeys: string[];
  jiraBaseUrl: string;
}): Promise<LinkResult[]> {
  const { owner, repo, number, prUrl, prTitle, ticketKeys, jiraBaseUrl } = opts;

  // Fetch existing comments once for all keys
  let existingComments: Array<{ body: string }> = [];
  try {
    existingComments = await githubClient.listComments(owner, repo, number);
  } catch {
    // If listing comments fails, we'll attempt to post anyway
  }

  const results: LinkResult[] = [];

  for (const ticketKey of ticketKeys) {
    const browseUrl = `${jiraBaseUrl}/browse/${ticketKey}`;
    const result: LinkResult = {
      ticketKey,
      remoteLinkCreated: false,
      commentPosted: false,
    };

    try {
      // Step 1: Create Jira remote link (idempotent via globalId)
      await createRemoteLink(ticketKey, prUrl, `GitHub PR #${number}: ${prTitle}`);
      result.remoteLinkCreated = true;
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      results.push(result);
      continue;
    }

    try {
      // Step 2: Post GitHub PR comment if not already present
      const alreadyLinked = existingComments.some((c) =>
        c.body.includes(browseUrl),
      );
      if (alreadyLinked) {
        result.commentPosted = false;
      } else {
        await githubClient.postComment(
          owner,
          repo,
          number,
          `🔗 Linked to Jira: ${browseUrl}`,
        );
        result.commentPosted = true;
      }
    } catch (e) {
      // Comment failure is captured but doesn't fail the overall result
      result.error = e instanceof Error ? e.message : String(e);
    }

    results.push(result);
  }

  return results;
}

export const linkPrToTicketTool: ToolDef = {
  name: "link_pr_to_ticket",
  description:
    "Link a GitHub PR to one or more Jira tickets. Creates a Jira remote link and posts a GitHub PR comment. Idempotent.",
  schema,
  async handler(input: unknown) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Invalid input", parsed.error.issues);
    }

    const { repo: argRepo, number, ticketKey } = parsed.data;
    const cfg = getConfig();
    const { owner, repo } = resolveRepo(argRepo, cfg.GITHUB_REPO);

    // Fetch the PR to get title, url, and fields for key detection
    const pr = await githubClient.getPr(owner, repo, number);
    const prUrl = pr.html_url;

    let ticketKeys: string[];
    if (ticketKey !== undefined) {
      ticketKeys = [ticketKey];
    } else {
      const prefixFilter = [
        cfg.JIRA_PO_PROJECT_KEY,
        cfg.JIRA_DEV_PROJECT_KEY,
      ].filter((k) => k.length > 0);

      ticketKeys = detectJiraKeys({
        title: pr.title,
        branch: pr.head.ref,
        body: pr.body,
        prefixFilter,
      });

      if (ticketKeys.length === 0) {
        throw new ValidationError(
          `No Jira ticket key found in PR #${number}. Pass ticketKey explicitly.`,
        );
      }
    }

    const results = await performLinking({
      owner,
      repo,
      number,
      prUrl,
      prTitle: pr.title,
      ticketKeys,
      jiraBaseUrl: cfg.JIRA_BASE_URL,
    });

    return { prUrl, results };
  },
};
