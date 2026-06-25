/**
 * get_issue_pull_requests tool (v1.22, ADR-034).
 *
 * Read each issue's linked pull requests from Jira's Development panel — multi-repo, with
 * reviewer/approval data — instead of enumerating a single GitHub repo. The team links PRs to
 * Jira automatically by putting the issue key in the branch/commit/PR-title, which the
 * "GitHub for Jira" app surfaces in Development Information (the undocumented /rest/dev-status API).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import {
  getIssueNumericId,
  getDevStatusPullRequestsRaw,
  type DevStatusDetailRaw,
} from "../lib/jiraClient.js";

export type ReviewDecision = "approved" | "changes_requested" | "review_required";

export interface LinkedPr {
  url: string;
  title: string;
  repo: string; // "owner/name" or "" when not derivable
  status: "open" | "merged" | "declined" | "unknown";
  decision: ReviewDecision;
  approvals: number;
  reviewers: string[]; // approving reviewer display names
  lastUpdate?: string;
}

const schema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(50),
});

/** Map dev-status PR status string → our normalized status. */
function mapStatus(s: string | undefined): LinkedPr["status"] {
  switch ((s ?? "").toUpperCase()) {
    case "OPEN": return "open";
    case "MERGED": return "merged";
    case "DECLINED": return "declined";
    default: return "unknown";
  }
}

/** Best-effort "owner/repo" from a PR URL when repositoryName is absent. */
function repoFromUrl(url: string | undefined): string {
  if (!url) return "";
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/i);
  return m ? m[1]! : "";
}

/**
 * Reduce a dev-status detail payload to LinkedPr[]. Pure — no network.
 * Each reviewer's approvalStatus drives the decision:
 *   CHANGES_REQUESTED / NEEDS_WORK → changes_requested; else APPROVED → approved; else review_required.
 */
export function parseDevStatusPullRequests(raw: DevStatusDetailRaw): LinkedPr[] {
  const out: LinkedPr[] = [];
  for (const d of raw.detail ?? []) {
    for (const pr of d.pullRequests ?? []) {
      if (!pr.url) continue;
      let approvals = 0;
      let changesRequested = 0;
      const reviewers: string[] = [];
      for (const rv of pr.reviewers ?? []) {
        const st = (rv.approvalStatus ?? "").toUpperCase();
        if (st === "APPROVED") {
          approvals++;
          if (rv.name) reviewers.push(rv.name);
        } else if (st === "CHANGES_REQUESTED" || st === "NEEDS_WORK") {
          changesRequested++;
        }
      }
      const decision: ReviewDecision =
        changesRequested > 0 ? "changes_requested" : approvals > 0 ? "approved" : "review_required";

      out.push({
        url: pr.url,
        title: pr.name ?? pr.url,
        repo: pr.repositoryName ?? repoFromUrl(pr.url),
        status: mapStatus(pr.status),
        decision,
        approvals,
        reviewers,
        ...(pr.lastUpdate ? { lastUpdate: pr.lastUpdate } : {}),
      });
    }
  }
  return out;
}

interface GetIssuePullRequestsOutput {
  pullRequests: Record<string, LinkedPr[]>;
}

async function handler(input: unknown): Promise<GetIssuePullRequestsOutput> {
  const args = schema.parse(input);
  const appType = getConfig().JIRA_DEV_STATUS_APP_TYPE;

  const entries = await Promise.all(
    args.keys.map(async (key): Promise<[string, LinkedPr[]]> => {
      try {
        const id = await getIssueNumericId(key);
        if (!id) return [key, []];
        const raw = await getDevStatusPullRequestsRaw(id, appType);
        return [key, parseDevStatusPullRequests(raw)];
      } catch {
        // Resilient per key — one bad key never fails the batch.
        return [key, []];
      }
    })
  );

  const pullRequests: Record<string, LinkedPr[]> = {};
  for (const [key, prs] of entries) pullRequests[key] = prs;
  return { pullRequests };
}

export const getIssuePullRequestsTool: ToolDef = {
  name: "get_issue_pull_requests",
  description:
    "Return the pull requests linked to each Jira issue (across ALL repositories) from Jira's " +
    "Development panel, with review/approval status. Input { keys: string[] }; output maps each key " +
    "to its linked PRs. Reads dev information populated automatically from the issue key in the " +
    "branch/commit/PR title. Resilient per key (unknown keys → []). Read-only.",
  schema,
  handler,
};
