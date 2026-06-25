// Lazy GitHub API client — per CONTRACTS.md §3
// Bearer auth, never logs token.

import axios, { type AxiosInstance, type AxiosError } from "axios";
import { getConfig } from "./config.js";
import { UpstreamError } from "./errors.js";

let _instance: AxiosInstance | null = null;

function getInstance(): AxiosInstance {
  if (_instance !== null) return _instance;

  const cfg = getConfig();

  _instance = axios.create({
    baseURL: "https://api.github.com",
    headers: {
      Authorization: `Bearer ${cfg.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  // Map HTTP errors to UpstreamError
  _instance.interceptors.response.use(
    (r) => r,
    (err: AxiosError) => {
      const status = err.response?.status;
      let message: string;
      if (status === 401) {
        message = "GitHub authentication failed — check GITHUB_TOKEN";
      } else if (status === 404) {
        message = "PR/repo not found";
      } else {
        message = `GitHub API error: ${status ?? "network failure"}`;
      }
      return Promise.reject(new UpstreamError(message, status));
    },
  );

  return _instance;
}

// Resets the instance (for tests that need to inject a mock)
export function resetGithubClientCache(): void {
  _instance = null;
}

export interface GithubPr {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged_at: string | null;
  draft: boolean;
  html_url: string;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  mergeable: boolean | null;
}

export interface GithubComment {
  id: number;
  body: string;
}

/** A single PR review from GET /pulls/{n}/reviews (chronological order). */
export interface GithubReview {
  id: number;
  user: { login: string } | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submitted_at: string | null;
}

export const githubClient = {
  listPrs(
    owner: string,
    repo: string,
    state: "open" | "closed" | "all",
  ): Promise<GithubPr[]> {
    return getInstance()
      .get<GithubPr[]>(`/repos/${owner}/${repo}/pulls`, {
        params: { state, per_page: 50 },
      })
      .then((r) => r.data);
  },

  getPr(owner: string, repo: string, number: number): Promise<GithubPr> {
    return getInstance()
      .get<GithubPr>(`/repos/${owner}/${repo}/pulls/${number}`)
      .then((r) => r.data)
      .catch((err: unknown) => {
        if (
          err instanceof UpstreamError &&
          err.statusCode === 404
        ) {
          throw new UpstreamError(
            `PR #${number} not found in ${owner}/${repo}`,
            404,
          );
        }
        throw err;
      });
  },

  listReviews(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GithubReview[]> {
    return getInstance()
      .get<GithubReview[]>(`/repos/${owner}/${repo}/pulls/${number}/reviews`, {
        params: { per_page: 100 },
      })
      .then((r) => r.data);
  },

  listComments(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GithubComment[]> {
    return getInstance()
      .get<GithubComment[]>(`/repos/${owner}/${repo}/issues/${number}/comments`)
      .then((r) => r.data);
  },

  postComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<void> {
    return getInstance()
      .post(`/repos/${owner}/${repo}/issues/${number}/comments`, { body })
      .then(() => undefined);
  },
};
