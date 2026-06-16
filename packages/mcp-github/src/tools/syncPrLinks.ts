// sync_pr_links tool — per CONTRACTS.md §5.4

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { githubClient } from "../lib/githubClient.js";
import { detectJiraKeys } from "../lib/jiraKeys.js";
import { ValidationError } from "../lib/errors.js";
import { derivePrState, resolveRepo } from "./listPrs.js";
import { performLinking } from "./linkPrToTicket.js";

const schema = z.object({
  repo: z
    .string()
    .optional()
    .describe('Repository as "owner/name". Defaults to GITHUB_REPO env var.'),
});

export const syncPrLinksTool: ToolDef = {
  name: "sync_pr_links",
  description:
    "Sync Jira remote links for all open PRs in a repository. Auto-detects Jira ticket keys and links each matching PR.",
  schema,
  async handler(input: unknown) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Invalid input", parsed.error.issues);
    }

    const { repo: argRepo } = parsed.data;
    const cfg = getConfig();
    const { owner, repo } = resolveRepo(argRepo, cfg.GITHUB_REPO);

    const prefixFilter = [cfg.JIRA_PO_PROJECT_KEY, cfg.JIRA_DEV_PROJECT_KEY].filter(
      (k) => k.length > 0,
    );

    const rawPrs = await githubClient.listPrs(owner, repo, "open");

    const linked: Array<{ number: number; ticketKeys: string[] }> = [];
    const skipped: Array<{ number: number; reason: string }> = [];

    for (const pr of rawPrs) {
      // Only process open PRs (derivation from merged_at)
      if (derivePrState(pr) !== "open") continue;

      const ticketKeys = detectJiraKeys({
        title: pr.title,
        branch: pr.head.ref,
        body: pr.body,
        prefixFilter,
      });

      if (ticketKeys.length === 0) {
        skipped.push({ number: pr.number, reason: "no Jira keys detected" });
        continue;
      }

      // Run linking logic for this PR
      await performLinking({
        owner,
        repo,
        number: pr.number,
        prUrl: pr.html_url,
        prTitle: pr.title,
        ticketKeys,
        jiraBaseUrl: cfg.JIRA_BASE_URL,
      });

      linked.push({ number: pr.number, ticketKeys });
    }

    return {
      repo: `${owner}/${repo}`,
      linked,
      skipped,
    };
  },
};
