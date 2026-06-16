// Error types for mcp-github — per CONTRACTS.md §2

export class UpstreamError extends Error {
  readonly code = "UPSTREAM" as const;

  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class ConfigError extends Error {
  readonly code = "CONFIG" as const;

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class ValidationError extends Error {
  readonly code = "VALIDATION" as const;
  readonly issues?: unknown[];

  constructor(message: string, issues?: unknown[]) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}
