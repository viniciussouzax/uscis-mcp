/**
 * Thin fetch wrapper with timeout, retry-with-backoff, and a sane User-Agent.
 *
 * Government endpoints occasionally 502/504 under load — three tries with
 * exponential backoff covers the vast majority of transient failures without
 * being abusive.
 */
const UA = "USCIS-MCP-Server/1.0 (+self-hosted; not affiliated with USCIS)";
export async function httpGet(url, opts = {}) {
    const { timeoutMs = 15_000, retries = 3, headers = {} } = opts;
    let lastErr;
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
        }
        catch (err) {
            clearTimeout(timer);
            lastErr = err;
            if (attempt < retries - 1) {
                await sleep(backoff(attempt));
            }
        }
    }
    throw new Error(`httpGet failed after ${retries} attempts for ${url}: ${String(lastErr)}`);
}
/** Like httpGet but returns raw bytes — for PDFs and other binary payloads. */
export async function httpGetBuffer(url, opts = {}) {
    const { timeoutMs = 30_000, retries = 3, headers = {} } = opts;
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt++) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                method: "GET",
                signal: ac.signal,
                headers: { "User-Agent": UA, Accept: "*/*", ...headers },
            });
            clearTimeout(timer);
            if (res.status >= 500 && attempt < retries - 1) {
                await sleep(backoff(attempt));
                continue;
            }
            const body = Buffer.from(await res.arrayBuffer());
            return {
                body,
                contentType: res.headers.get("content-type") ?? "",
                status: res.status,
            };
        }
        catch (err) {
            clearTimeout(timer);
            lastErr = err;
            if (attempt < retries - 1) {
                await sleep(backoff(attempt));
            }
        }
    }
    throw new Error(`httpGetBuffer failed after ${retries} attempts for ${url}: ${String(lastErr)}`);
}
export async function httpGetJson(url, opts) {
    const { body, status } = await httpGet(url, opts);
    if (status >= 400) {
        throw new Error(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
    }
    try {
        return JSON.parse(body);
    }
    catch {
        throw new Error(`Expected JSON from ${url}, got: ${body.slice(0, 200)}`);
    }
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function backoff(attempt) {
    // 400ms, 1.2s, 3.6s ... plus jitter
    const base = 400 * Math.pow(3, attempt);
    return base + Math.floor(Math.random() * 300);
}
//# sourceMappingURL=http.js.map