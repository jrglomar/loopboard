// Minimal Jira REST client for remote link creation — per CONTRACTS.md §5.3
// HTTP Basic auth (email:token). Never logs credentials.

import axios, { type AxiosInstance, type AxiosError } from "axios";
import { getConfig } from "./config.js";
import { UpstreamError } from "./errors.js";

let _instance: AxiosInstance | null = null;

function getInstance(): AxiosInstance {
  if (_instance !== null) return _instance;

  const cfg = getConfig();
  const token = Buffer.from(`${cfg.JIRA_EMAIL}:${cfg.JIRA_API_TOKEN}`).toString(
    "base64",
  );

  _instance = axios.create({
    baseURL: cfg.JIRA_BASE_URL,
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
    },
  });

  _instance.interceptors.response.use(
    (r) => r,
    (err: AxiosError) => {
      const status = err.response?.status;
      let message: string;
      if (status === 401) {
        message =
          "Jira authentication failed — check JIRA_EMAIL / JIRA_API_TOKEN";
      } else if (status === 404) {
        message = "Jira resource not found";
      } else {
        message = `Jira API error: ${status ?? "network failure"}`;
      }
      return Promise.reject(new UpstreamError(message, status));
    },
  );

  return _instance;
}

export function resetJiraClientCache(): void {
  _instance = null;
}

/**
 * Create (or upsert) a remote link on a Jira issue.
 * globalId = prUrl makes this idempotent per CONTRACTS.md §5.3.
 */
export async function createRemoteLink(
  issueKey: string,
  prUrl: string,
  title: string,
): Promise<void> {
  await getInstance().post(
    `/rest/api/3/issue/${issueKey}/remotelink`,
    {
      globalId: prUrl,
      object: {
        url: prUrl,
        title,
      },
    },
  );
}
