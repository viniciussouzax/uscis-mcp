/**
 * One place where every tool turns a fetch into a tool result.
 *
 * The README advertises the stale envelope — `stale`, `stale_reason`,
 * `age_seconds` — as how this server behaves when an upstream is down. Only
 * search_regulations implemented it, and the way it did diverged from its own
 * success path: it cached the raw eCFR response but returned a slimmed shape,
 * so the same tool answered with two different schemas depending on whether
 * the upstream happened to be up, and reported `source_url: "cached"`, which
 * is not a URL.
 *
 * Caching the finished payload here fixes both. What comes back stale is
 * byte-for-byte what came back fresh, with the original source_url, plus the
 * three fields that say it is old.
 */
import { cache, TTL } from "./cache.js";
import { envelope, toolError, toolText, type ToolResult } from "./envelope.js";

interface ServedResult<T> {
  payload: T;
  sourceUrl: string;
}

/**
 * Run `fetcher`; on failure serve the last good result for the same arguments.
 *
 * Kept for seven days regardless of the source's own TTL: a week-old answer
 * clearly labelled as week-old is more useful than an error, and the caller
 * has `age_seconds` to decide.
 */
export async function serve<T>(
  toolName: string,
  args: unknown,
  fetcher: () => Promise<ServedResult<T>>,
): Promise<ToolResult> {
  const key = `tool:${toolName}:${stableKey(args)}`;

  try {
    const result = await fetcher();
    cache.set(key, result, TTL.SEVEN_DAYS);
    return toolText(envelope(result.payload, result.sourceUrl));
  } catch (err) {
    const stale = cache.getStale(key) as {
      value: ServedResult<T>;
      ageMs: number;
    } | null;

    if (stale) {
      return toolText(
        envelope(stale.value.payload, stale.value.sourceUrl, {
          stale: true,
          staleReason: `upstream_unavailable: ${(err as Error).message}`,
          ageSeconds: Math.floor(stale.ageMs / 1000),
        }),
      );
    }

    return toolError(`${toolName} failed: ${(err as Error).message}`);
  }
}

/** Key that does not shift with property order. */
function stableKey(args: unknown): string {
  if (args === null || typeof args !== "object") return String(args);
  const obj = args as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .map((k) => `${k}=${JSON.stringify(obj[k])}`)
    .join("&");
}
