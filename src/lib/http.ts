/**
 * Thin fetch wrapper with timeout, retry-with-backoff, and a sane User-Agent.
 *
 * Government endpoints occasionally 502/504 under load — three tries with
 * exponential backoff covers the vast majority of transient failures without
 * being abusive.
 */

const UA = "USCIS-MCP-Server/1.0 (+self-hosted; not affiliated with USCIS)";

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export async function httpGet(
  url: string,
  opts: HttpOptions = {},
): Promise<{ body: string; contentType: string; status: number }> {
  const { timeoutMs = 15_000, retries = 3, headers = {} } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        signal: ac.signal,
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/html, application/xml;q=0.9, */*;q=0.5",
          ...headers,
        },
      });

      clearTimeout(timer);

      if (res.status >= 500 && attempt < retries - 1) {
        // server-side hiccup — retry
        await sleep(backoff(attempt));
        continue;
      }

      const body = await res.text();
      return {
        body,
        contentType: res.headers.get("content-type") ?? "",
        status: res.status,
      };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries - 1) {
        await sleep(backoff(attempt));
      }
    }
  }

  throw new Error(
    `httpGet failed after ${retries} attempts for ${url}: ${String(lastErr)}`,
  );
}

export async function httpGetJson<T>(url: string, opts?: HttpOptions): Promise<T> {
  const { body, status } = await httpGet(url, opts);
  if (status >= 400) {
    throw new Error(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      `Expected JSON from ${url}, got: ${body.slice(0, 200)}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt: number): number {
  // 400ms, 1.2s, 3.6s ... plus jitter
  const base = 400 * Math.pow(3, attempt);
  return base + Math.floor(Math.random() * 300);
}
