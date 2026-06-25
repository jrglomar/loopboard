// get_pr_reviews tool — per CONTRACTS.md §5.6 (v1.21, ADR-033).
// Returns the aggregated review/approval status for a batch of PRs (linked from Jira).

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { githubClient, type GithubReview } from "../lib/githubClient.js";
import { ValidationError, UpstreamError } from "../lib/errors.js";
import { resolveRepo } from "./listPrs.js";
import type { PrReviewStatus } from "../lib/types.js";

const schema = z.object({
  repo: z
    .string()
    .optional()
    .describe('Repository as "owner/name". Defaults to GITHUB_REPO env var.'),
  numbers: z
    .array(z.number().int().positive())
    .min(1)
    .max(50)
    .describe("PR numbers to fetch review status for (1–50)."),
});

/**
 * Reduce a PR's reviews (chronological) to an approval decision.
 *
 * Each reviewer's *latest meaningful* vote wins: APPROVED / CHANGES_REQUESTED /
 * DISMISSED override earlier votes; COMMENTED and PENDING are ignored (a reviewer can
 * comment and still have an active approval). DISMISSED clears that reviewer's vote.
 *
 * decision = changes_requested if any active CHANGES_REQUESTED, else approved if any
 * active APPROVED, else review_required. Pure — no network.
 */
export function summarizeReviews(
  reviews: Array<Pick<GithubReview, "user" | "state">>,
): PrReviewStatus {
  const latestByUser = new Map<string, "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED">();
  for (const r of reviews) {
    const login = r.user?.login;
    if (!login) continue;
    if (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED" || r.state === "DISMISSED") {
      latestByUser.set(login, r.state);
    }
    // COMMENTED / PENDING do not change a reviewer's standing.
  }

  const reviewers: string[] = [];
  let approvals = 0;
  let changesRequested = 0;
  for (const [login, state] of latestByUser) {
    if (state === "APPROVED") { approvals++; reviewers.push(login); }
    else if (state === "CHANGES_REQUESTED") changesRequested++;
  }

  const decision =
    changesRequested > 0 ? "changes_requested" : approvals > 0 ? "approved" : "review_required";

  return { decision, approvals, changesRequested, reviewers };
}

export const getPrReviewsTool: ToolDef = {
  name: "get_pr_reviews",
  description:
    "Return the review/approval status (approved / changes_requested / review_required, with " +
    "approval count + approving reviewers) for a batch of pull requests — e.g. the open PRs " +
    "linked to the current sprint's Jira tickets. Unknown PR numbers are omitted from the result.",
  schema,
  async handler(input: unknown) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Invalid input", parsed.error.issues);
    }

    const { repo: argRepo, numbers } = parsed.data;
    const cfg = getConfig();
    const { owner, repo } = resolveRepo(argRepo, cfg.GITHUB_REPO);

    // Fetch each PR's reviews in parallel; a missing PR (404) is omitted, not fatal.
    const entries = await Promise.all(
      numbers.map(async (n): Promise<[number, PrReviewStatus] | null> => {
        try {
          const reviews = await githubClient.listReviews(owner, repo, n);
          return [n, summarizeReviews(reviews)];
        } catch (err: unknown) {
          if (err instanceof UpstreamError && err.statusCode === 404) return null;
          throw err;
        }
      }),
    );

    const reviews: Record<number, PrReviewStatus> = {};
    for (const e of entries) {
      if (e) reviews[e[0]] = e[1];
    }

    return { repo: `${owner}/${repo}`, reviews };
  },
};
