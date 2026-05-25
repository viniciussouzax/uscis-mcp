/**
 * eCFR (Electronic Code of Federal Regulations) source.
 *
 * Base URL: https://www.ecfr.gov
 * Auth:     none
 * Title 8 = Aliens and Nationality (USCIS regulations live here)
 *
 * Two endpoints we care about:
 *   1. /api/search/v1/results        — full-text search
 *   2. /api/versioner/v1/full/<date>/title-8.xml + structure JSON
 *
 * eCFR data is XML; the versioner returns either XML or JSON depending on
 * the endpoint. We use the search API (JSON) and the structure JSON to
 * navigate hierarchies, then fall back to XML extraction for full text.
 */
import { httpGet, httpGetJson } from "../lib/http.js";
import { cache, TTL } from "../lib/cache.js";
const BASE = "https://www.ecfr.gov";
export async function searchRegulations(args) {
    const params = new URLSearchParams({
        query: args.query,
        per_page: String(Math.min(args.maxResults ?? 10, 50)),
        "hierarchy[title]": "8", // restrict to Title 8
    });
    if (args.cfrPart) {
        params.append("hierarchy[part]", args.cfrPart);
    }
    const url = `${BASE}/api/search/v1/results?${params.toString()}`;
    const cacheKey = `ecfr:search:${args.query}:${args.maxResults ?? 10}:${args.cfrPart ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return { payload: cached, sourceUrl: url };
    const payload = await httpGetJson(url);
    cache.set(cacheKey, payload, TTL.SIX_HOURS);
    return { payload, sourceUrl: url };
}
// ── Section retrieval ────────────────────────────────────────────────────────
/**
 * Parse a citation like "8 CFR 214.2(h)" into the bits eCFR needs.
 * Returns { title, part, section } — we ignore paragraph for now since
 * the versioner returns whole sections anyway.
 */
export function parseCitation(citation) {
    // Accept: "8 CFR 214.2", "8 CFR 214.2(h)", "8 CFR 214", "8 CFR §214.2"
    const cleaned = citation.replace(/§/g, "").replace(/\s+/g, " ").trim();
    const m = cleaned.match(/^(\d+)\s*CFR\s*(\d+)(?:\.(\d+))?/i);
    if (!m) {
        throw new Error(`Could not parse CFR citation "${citation}". Expected format like "8 CFR 214.2".`);
    }
    const [, title, part, sectionNum] = m;
    return {
        title,
        part,
        section: sectionNum ? `${part}.${sectionNum}` : undefined,
    };
}
/**
 * eCFR titles have a publication lag — using "today" returns 404 when the
 * title hasn't been updated yet. This fetches the actual latest issue date.
 */
async function getLatestIssueDate(titleNumber) {
    const cacheKey = `ecfr:latest_date:${titleNumber}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${BASE}/api/versioner/v1/titles`;
    const json = await httpGetJson(url);
    const entry = (json.titles ?? []).find((t) => String(t.number) === String(titleNumber));
    const date = entry?.latest_issue_date ?? new Date().toISOString().slice(0, 10);
    cache.set(cacheKey, date, TTL.ONE_DAY);
    return date;
}
export async function getSection(citation) {
    const { title, part, section } = parseCitation(citation);
    // Use the actual latest published date — eCFR has a multi-day publication
    // lag and returns 404 if you request a date past the latest issue date.
    const issueDate = await getLatestIssueDate(title);
    // We request the whole part as XML and then extract the section we want.
    // Pulling the whole part is cheap (most parts are <1MB) and we cache it.
    const url = `${BASE}/api/versioner/v1/full/${issueDate}/title-${title}.xml?part=${part}`;
    const cacheKey = `ecfr:section:${title}:${part}:${section ?? "all"}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return { payload: cached, sourceUrl: url };
    const { body, status } = await httpGet(url);
    if (status >= 400) {
        throw new Error(`eCFR returned ${status} for ${citation}. Body: ${body.slice(0, 200)}`);
    }
    const extracted = extractSectionFromXml(body, { title, part, section });
    const payload = {
        citation,
        title_label: `Title ${title}`,
        part_label: `Part ${part}`,
        section_label: section ? `§ ${section}` : undefined,
        text: extracted,
        effective_date: issueDate,
    };
    cache.set(cacheKey, payload, TTL.SIX_HOURS);
    return { payload, sourceUrl: url };
}
/**
 * Extract a section's text from eCFR XML.
 * We don't pull in a full XML parser; a targeted regex + tag-strip is enough
 * given the predictable eCFR document structure.
 */
function extractSectionFromXml(xml, ref) {
    let chunk = xml;
    if (ref.section) {
        // eCFR sections are wrapped in <DIV8 N="214.2" TYPE="SECTION">…</DIV8>
        const re = new RegExp(`<DIV8[^>]*N="${ref.section.replace(/\./g, "\\.")}"[^>]*TYPE="SECTION"[\\s\\S]*?<\\/DIV8>`, "i");
        const m = xml.match(re);
        if (m)
            chunk = m[0];
    }
    // Strip tags but keep paragraph breaks
    const text = chunk
        .replace(/<HEAD>([\s\S]*?)<\/HEAD>/gi, "\n\n## $1\n\n")
        .replace(/<P>/gi, "\n\n")
        .replace(/<\/P>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+/g, " ")
        .trim();
    if (!text) {
        return "(Section text could not be extracted. The citation may be valid but require manual lookup at the source URL.)";
    }
    return text;
}
//# sourceMappingURL=ecfr.js.map