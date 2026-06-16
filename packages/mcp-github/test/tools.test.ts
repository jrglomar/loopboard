import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetConfigCache } from "../src/lib/config.js";

// ---- Mock client modules BEFORE importing tools ----
vi.mock("../src/lib/githubClient.js", () => ({
  githubClient: {
    listPrs: vi.fn(),
    getPr: vi.fn(),
    listComments: vi.fn(),
    postComment: vi.fn(),
  },
  resetGithubClientCache: vi.fn(),
}));

vi.mock("../src/lib/jiraClient.js", () => ({
  createRemoteLink: vi.fn(),
  resetJiraClientCache: vi.fn(),
}));

import { githubClient } from "../src/lib/githubClient.js";
import { createRemoteLink } from "../src/lib/jiraClient.js";
import { listPrsTool } from "../src/tools/listPrs.js";
import { getPrTool } from "../src/tools/getPr.js";
import { linkPrToTicketTool } from "../src/tools/linkPrToTicket.js";
import { syncPrLinksTool } from "../src/tools/syncPrLinks.js";
import { UpstreamError, ValidationError } from "../src/lib/errors.js";

// Helper: set required env vars
function setRequiredEnv(): void {
  process.env["GITHUB_TOKEN"] = "gh_test";
  process.env["JIRA_BASE_URL"] = "https://acme.atlassian.net";
  process.env["JIRA_EMAIL"] = "test@example.com";
  process.env["JIRA_API_TOKEN"] = "jira_tok";
  process.env["GITHUB_REPO"] = "owner/repo";
  process.env["JIRA_PO_PROJECT_KEY"] = "PO";
  process.env["JIRA_DEV_PROJECT_KEY"] = "DEV";
  delete process.env["MCP_GITHUB_HTTP_PORT"];
}

function clearEnv(): void {
  delete process.env["GITHUB_TOKEN"];
  delete process.env["JIRA_BASE_URL"];
  delete process.env["JIRA_EMAIL"];
  delete process.env["JIRA_API_TOKEN"];
  delete process.env["GITHUB_REPO"];
  delete process.env["JIRA_PO_PROJECT_KEY"];
  delete process.env["JIRA_DEV_PROJECT_KEY"];
  delete process.env["MCP_GITHUB_HTTP_PORT"];
}

const MOCK_PR = {
  number: 42,
  title: "feat: DEV-99 implement login",
  body: "Closes DEV-99",
  state: "open" as const,
  merged_at: null,
  draft: false,
  html_url: "https://github.com/owner/repo/pull/42",
  user: { login: "devuser" },
  head: { ref: "feature/DEV-99-login", sha: "abc123" },
  base: { ref: "main" },
  mergeable: true,
};

describe("list_prs", () => {
  beforeEach(() => {
    setRequiredEnv();
    resetConfigCache();
    vi.clearAllMocks();
  });
  afterEach(() => {
    clearEnv();
    resetConfigCache();
  });

  it("happy path — returns repo and PR summaries", async () => {
    vi.mocked(githubClient.listPrs).mockResolvedValue([MOCK_PR]);

    const result = await listPrsTool.handler({ state: "open" }) as {
      repo: string;
      prs: Array<{ number: number; state: string; jiraKeys: string[] }>;
    };

    expect(result.repo).toBe("owner/repo");
    expect(result.prs).toHaveLength(1);
    expect(result.prs[0]!.number).toBe(42);
    expect(result.prs[0]!.state).toBe("open");
    expect(result.prs[0]!.jiraKeys).toContain("DEV-99");
  });

  it("merges state from merged_at", async () => {
    const mergedPr = { ...MOCK_PR, state: "closed" as const, merged_at: "2025-01-01T00:00:00Z" };
    vi.mocked(githubClient.listPrs).mockResolvedValue([mergedPr]);

    const result = await listPrsTool.handler({ state: "closed" }) as {
      prs: Array<{ state: string }>;
    };
    expect(result.prs[0]!.state).toBe("merged");
  });

  it("closed state without merged_at -> closed", async () => {
    const closedPr = { ...MOCK_PR, state: "closed" as const, merged_at: null };
    vi.mocked(githubClient.listPrs).mockResolvedValue([closedPr]);

    const result = await listPrsTool.handler({ state: "closed" }) as {
      prs: Array<{ state: string }>;
    };
    expect(result.prs[0]!.state).toBe("closed");
  });

  it("repo missing everywhere -> ValidationError", async () => {
    delete process.env["GITHUB_REPO"];
    resetConfigCache();

    await expect(listPrsTool.handler({ state: "open" })).rejects.toThrow(
      ValidationError,
    );
    await expect(listPrsTool.handler({ state: "open" })).rejects.toThrow(
      /GITHUB_REPO/,
    );
  });

  it("uses call-time repo arg over env var", async () => {
    vi.mocked(githubClient.listPrs).mockResolvedValue([]);

    const result = await listPrsTool.handler({
      repo: "other/org",
      state: "open",
    }) as { repo: string };
    expect(result.repo).toBe("other/org");
    expect(vi.mocked(githubClient.listPrs)).toHaveBeenCalledWith(
      "other",
      "org",
      "open",
    );
  });

  it("GitHub 401 -> UpstreamError with friendly message", async () => {
    vi.mocked(githubClient.listPrs).mockRejectedValue(
      new UpstreamError("GitHub authentication failed — check GITHUB_TOKEN", 401),
    );

    await expect(listPrsTool.handler({})).rejects.toThrow(UpstreamError);
    await expect(listPrsTool.handler({})).rejects.toThrow(
      /GitHub authentication failed/,
    );
  });
});

describe("get_pr", () => {
  beforeEach(() => {
    setRequiredEnv();
    resetConfigCache();
    vi.clearAllMocks();
  });
  afterEach(() => {
    clearEnv();
    resetConfigCache();
  });

  it("happy path — returns full PR details", async () => {
    vi.mocked(githubClient.getPr).mockResolvedValue(MOCK_PR);

    const result = await getPrTool.handler({ number: 42 }) as {
      number: number;
      headSha: string;
      mergeable: boolean | null;
      body: string | null;
    };
    expect(result.number).toBe(42);
    expect(result.headSha).toBe("abc123");
    expect(result.mergeable).toBe(true);
    expect(result.body).toBe("Closes DEV-99");
  });

  it("repo missing -> ValidationError", async () => {
    delete process.env["GITHUB_REPO"];
    resetConfigCache();

    await expect(getPrTool.handler({ number: 1 })).rejects.toThrow(
      ValidationError,
    );
  });

  it("404 -> UpstreamError", async () => {
    vi.mocked(githubClient.getPr).mockRejectedValue(
      new UpstreamError("PR #99 not found in owner/repo", 404),
    );

    await expect(getPrTool.handler({ number: 99 })).rejects.toThrow(
      UpstreamError,
    );
  });

  it("invalid input -> ValidationError", async () => {
    await expect(getPrTool.handler({ number: "not-a-number" })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("link_pr_to_ticket", () => {
  beforeEach(() => {
    setRequiredEnv();
    resetConfigCache();
    vi.clearAllMocks();
  });
  afterEach(() => {
    clearEnv();
    resetConfigCache();
  });

  it("happy path — explicit ticketKey, no existing comment", async () => {
    vi.mocked(githubClient.getPr).mockResolvedValue(MOCK_PR);
    vi.mocked(githubClient.listComments).mockResolvedValue([]);
    vi.mocked(githubClient.postComment).mockResolvedValue(undefined);
    vi.mocked(createRemoteLink).mockResolvedValue(undefined);

    const result = await linkPrToTicketTool.handler({
      number: 42,
      ticketKey: "DEV-99",
    }) as {
      prUrl: string;
      results: Array<{ ticketKey: string; remoteLinkCreated: boolean; commentPosted: boolean }>;
    };

    expect(result.prUrl).toBe(MOCK_PR.html_url);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.ticketKey).toBe("DEV-99");
    expect(result.results[0]!.remoteLinkCreated).toBe(true);
    expect(result.results[0]!.commentPosted).toBe(true);
  });

  it("auto-detect keys from PR when ticketKey omitted", async () => {
    vi.mocked(githubClient.getPr).mockResolvedValue(MOCK_PR);
    vi.mocked(githubClient.listComments).mockResolvedValue([]);
    vi.mocked(githubClient.postComment).mockResolvedValue(undefined);
    vi.mocked(createRemoteLink).mockResolvedValue(undefined);

    const result = await linkPrToTicketTool.handler({ number: 42 }) as {
      results: Array<{ ticketKey: string }>;
    };
    const keys = result.results.map((r) => r.ticketKey);
    expect(keys).toContain("DEV-99");
  });

  it("zero auto-detected keys -> ValidationError with PR number", async () => {
    const noKeyPr = {
      ...MOCK_PR,
      title: "refactor: unrelated",
      head: { ...MOCK_PR.head, ref: "refactor/no-key" },
      body: "no ticket here",
    };
    vi.mocked(githubClient.getPr).mockResolvedValue(noKeyPr);

    await expect(linkPrToTicketTool.handler({ number: 42 })).rejects.toThrow(
      ValidationError,
    );
    await expect(linkPrToTicketTool.handler({ number: 42 })).rejects.toThrow(
      /No Jira ticket key found in PR #42/,
    );
  });

  it("comment dedupe — skips if browse URL already in existing comment", async () => {
    vi.mocked(githubClient.getPr).mockResolvedValue(MOCK_PR);
    vi.mocked(githubClient.listComments).mockResolvedValue([
      { id: 1, body: "🔗 Linked to Jira: https://acme.atlassian.net/browse/DEV-99" },
    ]);
    vi.mocked(createRemoteLink).mockResolvedValue(undefined);

    const result = await linkPrToTicketTool.handler({
      number: 42,
      ticketKey: "DEV-99",
    }) as {
      results: Array<{ commentPosted: boolean }>;
    };

    expect(result.results[0]!.commentPosted).toBe(false);
    expect(vi.mocked(githubClient.postComment)).not.toHaveBeenCalled();
  });

  it("per-key Jira failure captured in error field, other keys continue", async () => {
    vi.mocked(githubClient.getPr).mockResolvedValue(MOCK_PR);
    vi.mocked(githubClient.listComments).mockResolvedValue([]);
    vi.mocked(githubClient.postComment).mockResolvedValue(undefined);

    // First key fails, second succeeds
    vi.mocked(createRemoteLink)
      .mockRejectedValueOnce(new UpstreamError("Jira 404", 404))
      .mockResolvedValueOnce(undefined);

    const result = await linkPrToTicketTool.handler({
      number: 42,
      ticketKey: "DEV-99",
    }) as {
      results: Array<{ ticketKey: string; remoteLinkCreated: boolean; error?: string }>;
    };

    expect(result.results[0]!.remoteLinkCreated).toBe(false);
    expect(result.results[0]!.error).toBeDefined();
  });

  it("repo missing -> ValidationError", async () => {
    delete process.env["GITHUB_REPO"];
    resetConfigCache();

    await expect(
      linkPrToTicketTool.handler({ number: 42, ticketKey: "DEV-1" }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("sync_pr_links", () => {
  beforeEach(() => {
    setRequiredEnv();
    resetConfigCache();
    vi.clearAllMocks();
  });
  afterEach(() => {
    clearEnv();
    resetConfigCache();
  });

  it("happy path — links PRs with keys, skips those without", async () => {
    const prWithKeys = MOCK_PR;
    const prWithoutKeys = {
      ...MOCK_PR,
      number: 99,
      title: "refactor: no keys",
      head: { ...MOCK_PR.head, ref: "refactor/no-keys" },
      body: "no ticket",
    };

    vi.mocked(githubClient.listPrs).mockResolvedValue([prWithKeys, prWithoutKeys]);
    vi.mocked(githubClient.getPr).mockResolvedValue(prWithKeys);
    vi.mocked(githubClient.listComments).mockResolvedValue([]);
    vi.mocked(githubClient.postComment).mockResolvedValue(undefined);
    vi.mocked(createRemoteLink).mockResolvedValue(undefined);

    const result = await syncPrLinksTool.handler({}) as {
      repo: string;
      linked: Array<{ number: number; ticketKeys: string[] }>;
      skipped: Array<{ number: number; reason: string }>;
    };

    expect(result.repo).toBe("owner/repo");
    expect(result.linked.some((l) => l.number === 42)).toBe(true);
    expect(result.skipped.some((s) => s.number === 99)).toBe(true);
    expect(result.skipped.find((s) => s.number === 99)?.reason).toBe(
      "no Jira keys detected",
    );
  });

  it("repo missing -> ValidationError", async () => {
    delete process.env["GITHUB_REPO"];
    resetConfigCache();

    await expect(syncPrLinksTool.handler({})).rejects.toThrow(ValidationError);
  });
});

describe("state derivation", () => {
  it("merged_at non-null -> merged regardless of state field", async () => {
    // Import derivePrState directly
    const { derivePrState } = await import("../src/tools/listPrs.js");
    expect(derivePrState({ state: "closed", merged_at: "2025-01-01T00:00:00Z" })).toBe("merged");
    expect(derivePrState({ state: "open", merged_at: "2025-01-01T00:00:00Z" })).toBe("merged");
  });

  it("merged_at null + state open -> open", async () => {
    const { derivePrState } = await import("../src/tools/listPrs.js");
    expect(derivePrState({ state: "open", merged_at: null })).toBe("open");
  });

  it("merged_at null + state closed -> closed", async () => {
    const { derivePrState } = await import("../src/tools/listPrs.js");
    expect(derivePrState({ state: "closed", merged_at: null })).toBe("closed");
  });
});
