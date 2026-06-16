// Pure Jira key detection — per CONTRACTS.md §5.5
// Regex /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g over title + head branch + body.
// No side effects. No network calls.

const JIRA_KEY_REGEX = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

/**
 * Detect Jira ticket keys in a PR's title, head branch name, and body.
 * If prefixFilter is non-empty, keep only keys whose project prefix is in the set.
 * Dedupes, preserving first-seen order.
 */
export function detectJiraKeys(opts: {
  title: string;
  branch: string;
  body: string | null;
  prefixFilter?: string[];
}): string[] {
  const { title, branch, body, prefixFilter } = opts;
  const text = [title, branch, body ?? ""].join(" ");
  const matches = text.matchAll(JIRA_KEY_REGEX);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of matches) {
    const key = match[1];
    if (!key) continue;

    // Optional prefix filter
    if (prefixFilter && prefixFilter.length > 0) {
      const prefix = key.split("-")[0];
      if (!prefix || !prefixFilter.includes(prefix)) continue;
    }

    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }

  return result;
}
