/**
 * Anti-corruption layer for Jira REST API v3 and Agile API 1.0.
 *
 * - Lazily creates the axios instance on first use.
 * - HTTP Basic auth from config (email + API token).
 * - Maps HTTP errors to UpstreamError with user-friendly messages.
 * - NEVER logs the token or Authorization header.
 */

import axios, {
  type AxiosInstance,
  type AxiosError,
} from "axios";
import { getConfig } from "./config.js";
import { UpstreamError } from "./errors.js";
import { adfToText, textToAdf } from "./adf.js";
import type { IssueSummary, AssignableUser } from "./types.js";

// ---- Lazy axios instance ----

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (_client !== null) return _client;

  const cfg = getConfig();

  // Build Basic auth token — never log this value
  const token = Buffer.from(`${cfg.JIRA_EMAIL}:${cfg.JIRA_API_TOKEN}`).toString(
    "base64"
  );

  _client = axios.create({
    baseURL: cfg.JIRA_BASE_URL,
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  return _client;
}

/** Reset the cached axios instance (for tests). */
export function resetClientCache(): void {
  _client = null;
}

// ---- Error mapping ----

function mapAxiosError(err: unknown, context?: string): UpstreamError {
  if (isAxiosError(err)) {
    const status = err.response?.status ?? 0;
    if (status === 401) {
      return new UpstreamError(
        "Jira authentication failed — check JIRA_EMAIL / JIRA_API_TOKEN",
        401
      );
    }
    if (status === 404) {
      return new UpstreamError(
        context ?? "Jira resource not found",
        404
      );
    }
    const message =
      (err.response?.data as { message?: string } | undefined)?.message ??
      err.message;
    return new UpstreamError(message, status);
  }
  const msg =
    err instanceof Error ? err.message : "Unknown Jira client error";
  return new UpstreamError(msg, 0);
}

function isAxiosError(err: unknown): err is AxiosError {
  return typeof err === "object" && err !== null && "isAxiosError" in err;
}

// ---- Jira API response types (internal, not exported) ----

interface JiraIssueCreateResponse {
  key: string;
  id: string;
}

interface JiraSprintIssuesResponse {
  issues: JiraIssueRaw[];
}

interface JiraIssueRaw {
  key: string;
  fields: {
    summary: string;
    status: {
      name: string;
      statusCategory: {
        key: string;
      };
    };
    assignee?: { accountId: string; displayName: string } | null;
    issuetype: { name: string };
    labels?: string[];
    description?: unknown;
    reporter?: { displayName: string } | null;
    created: string;
    updated: string;
    resolutiondate?: string | null; // v1.42 (ADR-052) — burndown input
    [key: string]: unknown;
  };
}

// ---- Blocked detection ----

/**
 * Determines whether a Jira issue is blocked per CONTRACTS.md §4:
 * - JIRA_FLAGGED_FIELD is set and truthy/non-empty on the issue, OR
 * - labels array includes "blocked" (case-insensitive), OR
 * - status name contains "block" (case-insensitive substring).
 */
export function isBlocked(
  fields: JiraIssueRaw["fields"],
  flaggedField: string
): boolean {
  // Flagged field check
  if (flaggedField !== "") {
    const flaggedValue = fields[flaggedField];
    if (flaggedValue !== undefined && flaggedValue !== null && flaggedValue !== false && flaggedValue !== "") {
      return true;
    }
  }

  // Label check (case-insensitive)
  const labels = fields.labels ?? [];
  if (labels.some((l) => l.toLowerCase() === "blocked")) {
    return true;
  }

  // Status name check (case-insensitive substring)
  const statusName = fields.status.name.toLowerCase();
  if (statusName.includes("block")) {
    return true;
  }

  return false;
}

// ---- Status category mapping ----

function mapStatusCategory(
  key: string
): "todo" | "inprogress" | "done" {
  switch (key) {
    case "done":
      return "done";
    case "indeterminate":
      return "inprogress";
    case "new":
    default:
      return "todo";
  }
}

// ---- Story points extraction ----

function extractStoryPoints(
  fields: JiraIssueRaw["fields"],
  storyPointsField: string
): number | null {
  const val = fields[storyPointsField];
  if (typeof val === "number") return val;
  return null;
}

// ---- Map raw issue to IssueSummary ----

export function mapIssue(
  raw: JiraIssueRaw,
  baseUrl: string,
  flaggedField: string,
  storyPointsField: string
): IssueSummary {
  return {
    key: raw.key,
    summary: raw.fields.summary,
    status: raw.fields.status.name,
    statusCategory: mapStatusCategory(
      raw.fields.status.statusCategory.key
    ),
    assignee: raw.fields.assignee?.displayName ?? null,
    assigneeAccountId: raw.fields.assignee?.accountId ?? null,
    storyPoints: extractStoryPoints(raw.fields, storyPointsField),
    issueType: raw.fields.issuetype.name,
    url: `${baseUrl}/browse/${raw.key}`,
    blocked: isBlocked(raw.fields, flaggedField),
    // v1.42 (ADR-052): resolution + last-update timestamps (burndown / staleness).
    resolvedAt: raw.fields.resolutiondate ?? null,
    updatedAt: raw.fields.updated ?? null,
  };
}

// ---- Public API ----

/** Create a Jira issue; returns the new key. */
export async function createIssue(payload: {
  projectKey: string;
  summary: string;
  description: string;
  issueType: "Story" | "Task";
  storyPointsField?: string;
  storyPoints?: number;
}): Promise<string> {
  const client = getClient();
  const cfg = getConfig();
  const baseUrl = cfg.JIRA_BASE_URL;

  const fields: Record<string, unknown> = {
    project: { key: payload.projectKey },
    summary: payload.summary,
    description: textToAdf(payload.description),
    issuetype: { name: payload.issueType },
  };

  if (
    payload.storyPoints !== undefined &&
    payload.storyPointsField !== undefined
  ) {
    fields[payload.storyPointsField] = payload.storyPoints;
  }

  try {
    const res = await client.post<JiraIssueCreateResponse>(
      "/rest/api/3/issue",
      { fields }
    );
    void baseUrl;
    return res.data.key;
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/** Create a Jira issue link between two tickets. */
export async function createIssueLink(payload: {
  linkTypeName: string;
  inwardKey: string;
  outwardKey: string;
}): Promise<void> {
  const client = getClient();
  try {
    await client.post("/rest/api/3/issueLink", {
      type: { name: payload.linkTypeName },
      inwardIssue: { key: payload.inwardKey },
      outwardIssue: { key: payload.outwardKey },
    });
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/**
 * Raw sprint as returned by the Jira board sprint endpoint.
 * (v1.4 hotfix — shared shape for the paginated fetcher.)
 */
interface JiraSprintRaw {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
}

interface JiraSprintPage {
  values?: JiraSprintRaw[];
  isLast?: boolean;
  startAt?: number;
  maxResults?: number;
}

/**
 * Fetch ALL sprints for a board matching `stateQuery`, following Jira's
 * pagination (default page size 50). Without this, boards with >50 sprints
 * silently truncate to the first page (oldest-id first) — which made
 * list_sprints/get_velocity miss every recent sprint. (v1.4 hotfix.)
 */
async function fetchAllSprintsRaw(
  boardId: number,
  stateQuery: string
): Promise<JiraSprintRaw[]> {
  const client = getClient();
  const pageSize = 50;
  const all: JiraSprintRaw[] = [];
  let startAt = 0;
  // Hard cap on pages to avoid an unbounded loop on a misbehaving API.
  for (let page = 0; page < 50; page++) {
    const res = await client.get<JiraSprintPage>(
      `/rest/agile/1.0/board/${boardId}/sprint?state=${stateQuery}&startAt=${startAt}&maxResults=${pageSize}`
    );
    const values = res.data.values ?? [];
    all.push(...values);
    // Stop on Jira's isLast, an empty page, or a short page (< pageSize ⇒ last page).
    // The short-page check also makes this terminate cleanly under test mocks that
    // return a fixed values array without isLast.
    if (res.data.isLast === true || values.length < pageSize) break;
    startAt += values.length;
  }
  return all;
}

/** Fetch the active sprint(s) for a board; returns the raw values array. */
export async function getActiveSprints(boardId: number): Promise<
  Array<{
    id: number;
    name: string;
    state: string;
    startDate: string | null;
    endDate: string | null;
    goal: string | null;
  }>
> {
  try {
    const values = await fetchAllSprintsRaw(boardId, "active");
    return values.map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate ?? null,
      endDate: s.endDate ?? null,
      goal: s.goal ?? null,
    }));
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/** Fetch active AND future sprints for a board, paginated (v1.4). */
export async function getActiveAndFutureSprints(boardId: number): Promise<
  Array<{
    id: number;
    name: string;
    state: string;
    startDate: string | null;
    endDate: string | null;
    goal: string | null;
  }>
> {
  try {
    const values = await fetchAllSprintsRaw(boardId, "active,future");
    return values.map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate ?? null,
      endDate: s.endDate ?? null,
      goal: s.goal ?? null,
    }));
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/** Fetch sprints for a board by state, paginated (v1.4 — list_sprints). */
export async function getSprintsByState(
  boardId: number,
  state: string
): Promise<
  Array<{
    id: number;
    name: string;
    state: string;
    startDate: string | null;
    endDate: string | null;
    completeDate: string | null;
    goal: string | null;
  }>
> {
  try {
    const values = await fetchAllSprintsRaw(boardId, state);
    return values.map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate ?? null,
      endDate: s.endDate ?? null,
      completeDate: s.completeDate ?? null,
      goal: s.goal ?? null,
    }));
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/** Fetch a single sprint's metadata (v1.4 — get_sprint_report). */
export async function getSprintMeta(sprintId: number): Promise<{
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  completeDate: string | null;
  goal: string | null;
  boardId: number;
}> {
  const client = getClient();
  try {
    const res = await client.get<{
      id: number;
      name: string;
      state: string;
      startDate?: string;
      endDate?: string;
      completeDate?: string;
      goal?: string;
      originBoardId?: number;
    }>(`/rest/agile/1.0/sprint/${sprintId}`);
    const s = res.data;
    return {
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate ?? null,
      endDate: s.endDate ?? null,
      completeDate: s.completeDate ?? null,
      goal: s.goal ?? null,
      boardId: s.originBoardId ?? 0,
    };
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/** Create a new sprint via the Agile API (v1.4 — create_sprint). */
export async function createSprint(payload: {
  name: string;
  originBoardId: number;
  goal?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  completeDate: string | null;
  goal: string | null;
  boardId: number;
}> {
  const client = getClient();
  try {
    const body: Record<string, unknown> = {
      name: payload.name,
      originBoardId: payload.originBoardId,
    };
    if (payload.goal !== undefined) body["goal"] = payload.goal;
    if (payload.startDate !== undefined) body["startDate"] = payload.startDate;
    if (payload.endDate !== undefined) body["endDate"] = payload.endDate;

    const res = await client.post<{
      id: number;
      name: string;
      state: string;
      startDate?: string;
      endDate?: string;
      completeDate?: string;
      goal?: string;
      originBoardId?: number;
    }>("/rest/agile/1.0/sprint", body);
    const s = res.data;
    return {
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate ?? null,
      endDate: s.endDate ?? null,
      completeDate: s.completeDate ?? null,
      goal: s.goal ?? null,
      boardId: s.originBoardId ?? payload.originBoardId,
    };
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/**
 * Set (or clear) an existing sprint's goal (v1.13, ADR-024).
 * POST /rest/agile/1.0/sprint/{id} is a PARTIAL update in the Agile API, so sending
 * only `{ goal }` changes the goal and leaves name/dates/state untouched.
 * 404 surfaces as UpstreamError so the tool can map it.
 */
export async function updateSprintGoal(
  sprintId: number,
  goal: string
): Promise<{ id: number; goal: string | null }> {
  const client = getClient();
  try {
    const res = await client.post<{ id: number; goal?: string | null }>(
      `/rest/agile/1.0/sprint/${sprintId}`,
      { goal }
    );
    return { id: res.data.id, goal: res.data.goal ?? null };
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      throw new UpstreamError(`Sprint ${sprintId} not found`, 404);
    }
    throw mapAxiosError(err);
  }
}

/**
 * Add issues to a sprint (v1.4 — add-to-sprint helper).
 * POST /rest/agile/1.0/sprint/{id}/issue { issues: [...keys] }
 * Callers must treat failures as NON-FATAL and catch themselves.
 */
export async function addIssuesToSprint(
  sprintId: number,
  issueKeys: string[]
): Promise<void> {
  const client = getClient();
  await client.post(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
    issues: issueKeys,
  });
}

/** Fetch issues in a sprint with raw fields for report computation (v1.4). */
export async function getSprintIssuesRaw(
  sprintId: number,
  maxResults: number
): Promise<Array<{
  key: string;
  statusCategory: "todo" | "inprogress" | "done";
  assignee: string | null;
  storyPoints: number | null;
  blocked: boolean;
  summary: string;
  status: string;
  issueType: string;
  url: string;
}>> {
  const client = getClient();
  const cfg = getConfig();

  try {
    const res = await client.get<JiraSprintIssuesResponse>(
      `/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=${maxResults}`
    );
    return (res.data.issues ?? []).map((raw) => {
      const issue = mapIssue(
        raw,
        cfg.JIRA_BASE_URL,
        cfg.JIRA_FLAGGED_FIELD,
        cfg.JIRA_STORY_POINTS_FIELD
      );
      return issue;
    });
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/** Fetch issues in a sprint. */
export async function getSprintIssues(
  sprintId: number,
  maxResults: number
): Promise<IssueSummary[]> {
  const client = getClient();
  const cfg = getConfig();

  try {
    const res = await client.get<JiraSprintIssuesResponse>(
      `/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=${maxResults}`
    );
    return (res.data.issues ?? []).map((raw) =>
      mapIssue(
        raw,
        cfg.JIRA_BASE_URL,
        cfg.JIRA_FLAGGED_FIELD,
        cfg.JIRA_STORY_POINTS_FIELD
      )
    );
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/**
 * Board-wide assignee scan (v1.9 — ADR-020).
 *
 * Pages `GET /rest/agile/1.0/board/{boardId}/issue` with the given JQL and
 * `fields=assignee`, returning each scanned issue's assignee (displayName +
 * accountId). Used by get_recent_assignees to derive the "usual members" across
 * the WHOLE board (active sprint + backlog + recent work), not just N sprints.
 *
 * `maxResults` caps the number of issues scanned (pages in chunks of 50).
 * Never logs the accountId.
 */
export async function getBoardAssigneesRaw(
  boardId: number,
  jql: string,
  maxResults: number
): Promise<Array<{ assignee: string | null; assigneeAccountId: string | null }>> {
  const client = getClient();
  const pageSize = 50;
  const collected: Array<{
    assignee: string | null;
    assigneeAccountId: string | null;
  }> = [];
  let startAt = 0;

  try {
    // Hard page guard; the real bound is maxResults (early-returns below).
    for (let page = 0; page < 200; page++) {
      const res = await client.get<{
        issues?: Array<{
          fields?: {
            assignee?: { accountId: string; displayName: string } | null;
          };
        }>;
        total?: number;
      }>(
        `/rest/agile/1.0/board/${boardId}/issue?jql=${encodeURIComponent(jql)}&fields=assignee&startAt=${startAt}&maxResults=${pageSize}`
      );
      const issues = res.data.issues ?? [];
      for (const raw of issues) {
        collected.push({
          assignee: raw.fields?.assignee?.displayName ?? null,
          assigneeAccountId: raw.fields?.assignee?.accountId ?? null,
        });
        if (collected.length >= maxResults) return collected;
      }
      const total = res.data.total ?? 0;
      startAt += issues.length;
      if (issues.length === 0 || startAt >= total) break;
    }
    return collected;
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/** Fetch a single Jira issue by key. Returns raw fields. */
export async function getIssue(ticketKey: string): Promise<{
  key: string;
  url: string;
  summary: string;
  description: string;
  status: string;
  statusCategory: "todo" | "inprogress" | "done";
  assignee: string | null;
  reporter: string | null;
  storyPoints: number | null;
  issueType: string;
  labels: string[];
  created: string;
  updated: string;
}> {
  const client = getClient();
  const cfg = getConfig();

  try {
    const res = await client.get<JiraIssueRaw>(`/rest/api/3/issue/${ticketKey}`);
    const raw = res.data;
    return {
      key: raw.key,
      url: `${cfg.JIRA_BASE_URL}/browse/${raw.key}`,
      summary: raw.fields.summary,
      description: adfToText(raw.fields.description),
      status: raw.fields.status.name,
      statusCategory: mapStatusCategory(raw.fields.status.statusCategory.key),
      assignee: raw.fields.assignee?.displayName ?? null,
      reporter: raw.fields.reporter?.displayName ?? null,
      storyPoints: extractStoryPoints(raw.fields, cfg.JIRA_STORY_POINTS_FIELD),
      issueType: raw.fields.issuetype.name,
      labels: raw.fields.labels ?? [],
      created: raw.fields.created,
      updated: raw.fields.updated,
    };
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      throw new UpstreamError(`Ticket ${ticketKey} not found`, 404);
    }
    throw mapAxiosError(err);
  }
}

/** A workflow transition available from an issue's current status (v1.15, ADR-026). */
export interface IssueTransition {
  id: string;
  name: string;
  to: { name: string; category: "todo" | "inprogress" | "done" };
}

/**
 * Fetch the transitions available from an issue's CURRENT status (v1.15, ADR-026).
 * GET /rest/api/3/issue/{key}/transitions. 404 → UpstreamError.
 */
export async function getTransitions(ticketKey: string): Promise<IssueTransition[]> {
  const client = getClient();
  try {
    const res = await client.get<{
      transitions?: Array<{
        id: string;
        name: string;
        to?: { name?: string; statusCategory?: { key?: string } };
      }>;
    }>(`/rest/api/3/issue/${ticketKey}/transitions`);
    return (res.data.transitions ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      to: {
        name: t.to?.name ?? "",
        category: mapStatusCategory(t.to?.statusCategory?.key ?? ""),
      },
    }));
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      throw new UpstreamError(`Ticket ${ticketKey} not found`, 404);
    }
    throw mapAxiosError(err);
  }
}

/**
 * Apply a transition to an issue, then re-read its new status (v1.15, ADR-026).
 * POST /rest/api/3/issue/{key}/transitions { transition: { id } }. 404 → UpstreamError.
 */
export async function transitionIssue(
  ticketKey: string,
  transitionId: string
): Promise<{ ticketKey: string; status: string; statusCategory: "todo" | "inprogress" | "done" }> {
  const client = getClient();
  try {
    await client.post(`/rest/api/3/issue/${ticketKey}/transitions`, {
      transition: { id: transitionId },
    });
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      throw new UpstreamError(`Ticket ${ticketKey} not found`, 404);
    }
    throw mapAxiosError(err);
  }
  // Re-read the issue to report the resulting status (a separate call so a read-back
  // failure is distinct from the transition write itself).
  const issue = await getIssue(ticketKey);
  return { ticketKey, status: issue.status, statusCategory: issue.statusCategory };
}

export interface LinkedIssueRef {
  key: string;
  summary: string;
  status: string;
  url: string;
}

/**
 * Fetch the issues linked to a Jira issue (v1.11, ADR-022).
 *
 * Returns ALL linked issues (the caller filters by project). Each Jira issue link
 * carries either an `inwardIssue` or an `outwardIssue` — we take whichever is
 * present. A 404 (key gone/typo) returns `[]` rather than throwing, so a bulk
 * caller stays resilient to one bad key.
 */
export async function getLinkedIssues(key: string): Promise<LinkedIssueRef[]> {
  const client = getClient();
  const cfg = getConfig();
  type LinkSide = {
    key: string;
    fields?: { summary?: string; status?: { name?: string } };
  };
  try {
    const res = await client.get<{
      fields?: {
        issuelinks?: Array<{ inwardIssue?: LinkSide; outwardIssue?: LinkSide }>;
      };
    }>(`/rest/api/3/issue/${key}?fields=issuelinks`);
    const links = res.data.fields?.issuelinks ?? [];
    const out: LinkedIssueRef[] = [];
    for (const link of links) {
      const other = link.inwardIssue ?? link.outwardIssue;
      if (!other) continue;
      out.push({
        key: other.key,
        summary: other.fields?.summary ?? "",
        status: other.fields?.status?.name ?? "",
        url: `${cfg.JIRA_BASE_URL}/browse/${other.key}`,
      });
    }
    return out;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      return [];
    }
    throw mapAxiosError(err);
  }
}

// ---- Development Information (linked PRs from the issue's Development panel; v1.22, ADR-034) ----

/** One reviewer entry inside a dev-status pull request (undocumented shape; all optional). */
export interface DevStatusReviewer {
  name?: string;
  approvalStatus?: string; // e.g. "APPROVED" | "UNAPPROVED" | "NEEDS_WORK"
}

/** One pull request inside the dev-status detail payload (undocumented shape; all optional). */
export interface DevStatusPr {
  id?: string;
  name?: string; // PR title
  url?: string;
  status?: string; // "OPEN" | "MERGED" | "DECLINED"
  lastUpdate?: string;
  reviewers?: DevStatusReviewer[];
  repositoryName?: string;
  repositoryUrl?: string;
}

/** dev-status detail response (undocumented). `detail[].pullRequests[]` is what we read. */
export interface DevStatusDetailRaw {
  detail?: Array<{ pullRequests?: DevStatusPr[] }>;
}

/**
 * Resolve a Jira issue key to its numeric id (needed by the dev-status endpoint).
 * GET /rest/api/3/issue/{key}?fields=*none. 404 → null (resilient for bulk callers).
 */
export async function getIssueNumericId(key: string): Promise<string | null> {
  const client = getClient();
  try {
    const res = await client.get<{ id?: string }>(`/rest/api/3/issue/${key}?fields=*none`);
    return res.data.id ?? null;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) return null;
    throw mapAxiosError(err);
  }
}

/**
 * Read an issue's linked pull requests from Jira's Development panel (v1.22, ADR-034).
 * GET /rest/dev-status/1.0/issue/detail?issueId={id}&applicationType={appType}&dataType=pullrequest.
 * This is an UNDOCUMENTED endpoint (the one powering the Development panel); parsed defensively.
 * 404 / no dev data → {} (resilient). The pure reducer lives in tools/getIssuePullRequests.ts.
 */
export async function getDevStatusPullRequestsRaw(
  issueId: string,
  appType: string
): Promise<DevStatusDetailRaw> {
  const client = getClient();
  const url =
    `/rest/dev-status/1.0/issue/detail?issueId=${encodeURIComponent(issueId)}` +
    `&applicationType=${encodeURIComponent(appType)}&dataType=pullrequest`;
  try {
    const res = await client.get<DevStatusDetailRaw>(url);
    return res.data ?? {};
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) return {};
    throw mapAxiosError(err);
  }
}

/**
 * Fetch users assignable to a Jira project (v1.7 — get_assignable_users).
 * GET /rest/api/3/user/assignable/search?project={projectKey}&maxResults={maxResults}
 * Never logs accountId or any PII beyond what Jira returns.
 */
export async function getAssignableUsers(
  projectKey: string,
  maxResults: number
): Promise<AssignableUser[]> {
  const client = getClient();
  try {
    const res = await client.get<
      Array<{ accountId: string; displayName: string; active: boolean }>
    >(
      `/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&maxResults=${maxResults}`
    );
    return (res.data ?? []).map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      active: u.active,
    }));
  } catch (err) {
    throw mapAxiosError(err);
  }
}

/**
 * Assign (or unassign) a Jira issue (v1.7 — assign_issue).
 * PUT /rest/api/3/issue/{ticketKey}/assignee  body: { accountId }
 * Jira returns 204 on success. 404 surfaces so the tool can map to UPSTREAM.
 * Never logs the accountId.
 */
export async function assignIssue(
  ticketKey: string,
  accountId: string | null
): Promise<void> {
  const client = getClient();
  try {
    await client.put(`/rest/api/3/issue/${ticketKey}/assignee`, { accountId });
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      throw new UpstreamError(`Ticket ${ticketKey} not found`, 404);
    }
    throw mapAxiosError(err);
  }
}

/** Update a Jira issue's fields. Returns 204 on success. */
export async function updateIssue(
  ticketKey: string,
  fields: { summary?: string; description?: string; storyPoints?: number }
): Promise<void> {
  const client = getClient();
  const cfg = getConfig();
  const payload: Record<string, unknown> = {};

  if (fields.summary !== undefined) {
    payload["summary"] = fields.summary;
  }
  if (fields.description !== undefined) {
    payload["description"] = textToAdf(fields.description);
  }
  // v1.19 (ADR-030): write story points to the configured custom field (same field the
  // create path uses), so the assistant can "update points of X to N".
  if (fields.storyPoints !== undefined) {
    payload[cfg.JIRA_STORY_POINTS_FIELD] = fields.storyPoints;
  }

  try {
    await client.put(`/rest/api/3/issue/${ticketKey}`, { fields: payload });
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      throw new UpstreamError(`Ticket ${ticketKey} not found`, 404);
    }
    throw mapAxiosError(err);
  }
}
