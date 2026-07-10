/**
 * Per-user Jira read client (v1.44, ADR-054) — builds an axios instance from EXPLICIT
 * credentials (not the global singleton config), so each teammate's Task Helper requests
 * use their own token. Only the handful of reads the Task Helper needs live here; the
 * shared `jiraClient.ts` singleton + the 40 tools are untouched. Never logs the token.
 */

import axios, { type AxiosInstance, type AxiosError } from "axios";
import { adfToText } from "./adf.js";

export interface JiraCreds {
  baseUrl: string;
  email: string;
  token: string;
}

export interface JiraIdentity {
  accountId: string;
  displayName: string;
}

/** One of the user's sprint issues (trimmed for the Task Helper list). */
export interface MyIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
}

/** A single issue's fetched detail, fed to the AI pipeline. */
export interface IssueDetail {
  key: string;
  summary: string;
  description: string; // plain text (ADF flattened)
  status: string;
  issueType: string;
  url: string;
}

function isAxiosError(err: unknown): err is AxiosError {
  return typeof err === "object" && err !== null && "isAxiosError" in err;
}

/** Friendly, token-free message for a failed Jira call. */
function friendly(err: unknown, context: string): Error {
  if (isAxiosError(err)) {
    const status = err.response?.status ?? 0;
    if (status === 401 || status === 403) return new Error("Jira rejected these credentials (check email + API token)");
    if (status === 404) return new Error(`${context}: not found`);
    if (status === 0) return new Error("Could not reach Jira — check the base URL");
    const msg = (err.response?.data as { message?: string } | undefined)?.message;
    return new Error(msg ?? `Jira error (${status})`);
  }
  return new Error(err instanceof Error ? err.message : context);
}

/** Build a per-user axios client. Trailing slashes trimmed; 15s timeout. */
export function makeUserJira(creds: JiraCreds): AxiosInstance {
  const auth = Buffer.from(`${creds.email}:${creds.token}`).toString("base64");
  return axios.create({
    baseURL: creds.baseUrl.replace(/\/+$/, ""),
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
}

/** Verify the credentials via GET /myself. Throws a friendly error on failure. */
export async function validateJira(creds: JiraCreds): Promise<JiraIdentity> {
  const client = makeUserJira(creds);
  try {
    const res = await client.get<{ accountId?: string; displayName?: string }>("/rest/api/3/myself");
    if (!res.data.accountId) throw new Error("Jira did not return an account for these credentials");
    return { accountId: res.data.accountId, displayName: res.data.displayName ?? creds.email };
  } catch (err) {
    throw friendly(err, "validate Jira");
  }
}

/**
 * The signed-in user's issues, `assignee = currentUser()`.
 *
 * v1.46 (ADR-055 Phase F): when `sprintId` is given, scope to THAT sprint — the one selected on
 * the board — instead of every open sprint. Falls back to `openSprints()` when no sprint is
 * selected (e.g. the board has none), preserving the v1.44 behavior.
 */
export async function fetchMySprintIssues(creds: JiraCreds, sprintId?: number): Promise<MyIssue[]> {
  const client = makeUserJira(creds);
  const scope = sprintId !== undefined ? `sprint = ${sprintId}` : "sprint in openSprints()";
  const jql = `assignee = currentUser() AND ${scope} ORDER BY updated DESC`;
  try {
    // v1.44.1: Atlassian REMOVED the classic GET /rest/api/3/search (now 410 Gone); the
    // replacement is /rest/api/3/search/jql (same issue shape, token-paginated). `fields`
    // must be given explicitly here. We take the first page (up to maxResults) — plenty for
    // one person's open-sprint tickets.
    const res = await client.get<{
      issues?: Array<{ key: string; fields?: { summary?: string; status?: { name?: string } } }>;
    }>("/rest/api/3/search/jql", { params: { jql, maxResults: 50, fields: "summary,status" } });
    const base = creds.baseUrl.replace(/\/+$/, "");
    return (res.data.issues ?? []).map((i) => ({
      key: i.key,
      summary: i.fields?.summary ?? "",
      status: i.fields?.status?.name ?? "",
      url: `${base}/browse/${i.key}`,
    }));
  } catch (err) {
    throw friendly(err, "fetch sprint issues");
  }
}

/** One issue's detail (summary + flattened description) for the AI pipeline. */
export async function fetchIssueDetail(creds: JiraCreds, key: string): Promise<IssueDetail> {
  const client = makeUserJira(creds);
  try {
    const res = await client.get<{
      key: string;
      fields?: {
        summary?: string;
        description?: unknown;
        status?: { name?: string };
        issuetype?: { name?: string };
      };
    }>(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
      params: { fields: "summary,description,status,issuetype" },
    });
    const f = res.data.fields ?? {};
    return {
      key: res.data.key,
      summary: f.summary ?? "",
      description: f.description ? adfToText(f.description) : "",
      status: f.status?.name ?? "",
      issueType: f.issuetype?.name ?? "",
      url: `${creds.baseUrl.replace(/\/+$/, "")}/browse/${res.data.key}`,
    };
  } catch (err) {
    throw friendly(err, `fetch issue ${key}`);
  }
}
