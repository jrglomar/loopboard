// get_pr tool — per CONTRACTS.md §5.2

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { githubClient } from "../lib/githubClient.js";
import { detectJiraKeys } from "../lib/jiraKeys.js";
import { ValidationError } from "../lib/errors.js";
import { derivePrState, resolveRepo } from "./listPrs.js";

const schema = z.object({
  repo: z
    .string()
    .optional()
    .describe('Repository as "owner/name". Defaults to GITHUB_REPO env var.'),
  number: z.number().int().positive().describe("PR number"),
});

export const getPrTool: ToolDef = {
  name: "get_pr",
  description: "Get details of a single GitHub pull request by number.",
  schema,
  async handler(input: unknown) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Invalid input", parsed.error.issues);
    }

    const { repo: argRepo, number } = parsed.data;
    const cfg = getConfig();
    const { owner, repo } = resolveRepo(argRepo, cfg.GITHUB_REPO);

    const prefixFilter = [cfg.JIRA_PO_PROJECT_KEY, cfg.JIRA_DEV_PROJECT_KEY].filter(
      (k) => k.length > 0,
    );

    const pr = await githubClient.getPr(owner, repo, number);

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
      body: pr.body,
      mergeable: pr.mergeable,
      headSha: pr.head.sha,
    };
  },
};
