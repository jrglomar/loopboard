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
