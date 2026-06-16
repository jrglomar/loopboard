// list_prs tool — per CONTRACTS.md §5.1

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { githubClient, type GithubPr } from "../lib/githubClient.js";
import { detectJiraKeys } from "../lib/jiraKeys.js";
import { ValidationError } from "../lib/errors.js";
import type { PrSummary } from "../lib/types.js";

const schema = z.object({
  repo: z
    .string()
    .optional()
    .describe('Repository as "owner/name". Defaults to GITHUB_REPO env var.'),
  state: z
    .enum(["open", "closed", "all"])
    .default("open")
    .describe("PR state filter"),
});

export function derivePrState(pr: {
  state: "open" | "closed";
  merged_at: string | null;
}): "open" | "closed" | "merged" {
  if (pr.merged_at != null) return "merged";
  if (pr.state === "open") return "open";
  return "closed";
}

export function toPrSummary(pr: GithubPr, prefixFilter: string[]): PrSummary {
  return {
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? "",
    branch: pr.head.ref,
    baseBranch: pr.base.ref,
    state: derivePrState(pr),
    draft: pr.draft,
    url: pr.html_url,
    jiraKeys: detectJiraKeys({
      title: pr.title,
      branch: pr.head.ref,
      body: pr.body,
      prefixFilter,
    }),
  };
}

/**
 * Resolves the repo string ("owner/name") from the call argument or fallback env.
 * Returns parsed owner/repo or throws ValidationError.
 */
export function resolveRepo(
  argRepo: string | undefined,
  envRepo: string | undefined,
): { owner: string; repo: string } {
  const repoStr = argRepo ?? envRepo;
  if (!repoStr) {
    throw new ValidationError(
      "repo is required when GITHUB_REPO env variable is not set",
    );
  }
  const parts = repoStr.split("/");
  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) {
    throw new ValidationError('repo must be in "owner/name" format');
  }
  return { owner, repo };
}

export const listPrsTool: ToolDef = {
  name: "list_prs",
  description:
    "List pull requests in a GitHub repository. Returns PR summaries with detected Jira keys.",
  schema,
  async handler(input: unknown) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Invalid input", parsed.error.issues);
    }

    const { repo: argRepo, state } = parsed.data;
    const cfg = getConfig();
    const { owner, repo } = resolveRepo(argRepo, cfg.GITHUB_REPO);

    const prefixFilter = [cfg.JIRA_PO_PROJECT_KEY, cfg.JIRA_DEV_PROJECT_KEY].filter(
      (k) => k.length > 0,
    );

    const prs = await githubClient.listPrs(owner, repo, state);

    return {
      repo: `${owner}/${repo}`,
      prs: prs.map((pr) => toPrSummary(pr, prefixFilter)),
    };
  },
};
