// Per CONTRACTS.md §5 — exact shape

export interface PrSummary {
  number: number;
  title: string;
  author: string;
  branch: string;
  baseBranch: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  url: string;        // html_url
  jiraKeys: string[]; // detected by jiraKeys.ts
}

/** Overall review/approval decision for a PR (v1.21, §5.6). */
export type ReviewDecision = "approved" | "changes_requested" | "review_required";

/** Aggregated reviewer/approval status for a PR (v1.21, §5.6). */
export interface PrReviewStatus {
  decision: ReviewDecision;
  approvals: number;          // distinct reviewers whose latest vote is APPROVED
  changesRequested: number;   // distinct reviewers whose latest vote is CHANGES_REQUESTED
  reviewers: string[];        // logins of approving reviewers (for tooltip)
}
