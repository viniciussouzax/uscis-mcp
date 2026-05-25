/**
 * Every tool response gets wrapped in the same envelope so that consumers
 * (an LLM or a downstream app) can always reason about provenance and freshness.
 */
export interface ResponseEnvelope<T> {
  data: T;
  source_url: string;
  fetched_at: string; // ISO8601
  stale?: boolean;
  stale_reason?: string;
  age_seconds?: number;
}

export function envelope<T>(
  data: T,
  sourceUrl: string,
  opts: { stale?: boolean; staleReason?: string; ageSeconds?: number } = {},
): ResponseEnvelope<T> {
  return {
    data,
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
    ...(opts.stale ? { stale: true } : {}),
    ...(opts.staleReason ? { stale_reason: opts.staleReason } : {}),
    ...(opts.ageSeconds !== undefined ? { age_seconds: opts.ageSeconds } : {}),
  };
}

/** Convenience: wrap any object into the MCP tool result shape. */
export function toolText<T>(payload: ResponseEnvelope<T>): ToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function toolError(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}
