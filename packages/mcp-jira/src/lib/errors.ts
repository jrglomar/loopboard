/**
 * Represents a failure from the upstream Jira API.
 * The `message` field is a user-friendly string safe to surface in API error envelopes.
 * The HTTP status from Jira is captured in `status` for error mapping logic.
 */
export class UpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

/**
 * Thrown at startup when one or more required environment variables are missing.
 * The `message` field lists the missing variable names so they appear in the CONFIG
 * error envelope and in the startup failure log.
 */
export class ConfigError extends Error {
  readonly missingVars: string[];

  constructor(missingVars: string[]) {
    super(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
    this.name = "ConfigError";
    this.missingVars = missingVars;
  }
}
