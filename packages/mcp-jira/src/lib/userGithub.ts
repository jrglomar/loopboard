/**
 * Per-user GitHub validation (v1.44, ADR-054) — verifies a pasted PAT via GET /user.
 * The connection is stored + validated; deeper GitHub use (repo context in the prompt)
 * is a future add. Uses global fetch; never logs the token.
 */

export interface GithubIdentity {
  login: string;
}

const GITHUB_API = "https://api.github.com";

/** Verify a GitHub personal access token. Throws a friendly error on failure. */
export async function validateGithub(token: string): Promise<GithubIdentity> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "invokeboard-task-helper",
      },
    });
  } catch {
    throw new Error("Could not reach GitHub");
  }
  if (res.status === 401) throw new Error("GitHub rejected this token (check scopes + expiry)");
  if (!res.ok) throw new Error(`GitHub error (${res.status})`);
  const data = (await res.json().catch(() => null)) as { login?: string } | null;
  if (!data?.login) throw new Error("GitHub did not return a user for this token");
  return { login: data.login };
}
