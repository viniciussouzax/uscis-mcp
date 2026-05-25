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

// ── Search ───────────────────────────────────────────────────────────────────

export interface EcfrSearchResult {
  starts_on: string | null;
  ends_on: string | null;
  type: string;
  hierarchy: Record<string, string>;
  hierarchy_headings: Record<string, string>;
  headings: Record<string, string>;
  full_text_excerpt: string;
  score: number;
  structure_index: number;
  reserved: boolean;
  removed: boolean;
  change_types: string[];
}

export interface EcfrSearchResponse {
  results: EcfrSearchResult[];
  meta: {
    current_page: number;
    total_count: number;
    total_pages: number;
    description?: string;
  };
}

export async function searchRegulations(args: {
  query: string;
  maxResults?: number;
  cfrPart?: string;
}): Promise<{ payload: EcfrSearchResponse; sourceUrl: string }> {
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

  const cached = cache.get(cacheKey) as EcfrSearchResponse | null;
  if (cached) return { payload: cached, sourceUrl: url };

  const payload = await httpGetJson<EcfrSearchResponse>(url);
  cache.set(cacheKey, payload, TTL.SIX_HOURS);

  return { payload, sourceUrl: url };
}

// ── Section retrieval ────────────────────────────────────────────────────────

/**
 * Parse a citation like "8 CFR 214.2(h)" into the bits eCFR needs.
 * Returns { title, part, section } — we ignore paragraph for now since
 * the versioner returns whole sections anyway.
 */
export function parseCitation(citation: string): {
  title: string;
  part: string;
  section?: string;
} {
  // Accept: "8 CFR 214.2", "8 CFR 214.2(h)", "8 CFR 214", "8 CFR §214.2"
  const cleaned = citation.replace(/§/g, "").replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^(\d+)\s*CFR\s*(\d+)(?:\.(\d+))?/i);
  if (!m) {
    throw new Error(
      `Could not parse CFR citation "${citation}". Expected format like "8 CFR 214.2".`,
    );
  }
  const [, title, part, sectionNum] = m;
  return {
    title,
    part,
    section: sectionNum ? `${part}.${sectionNum}` : undefined,
  };
}

export interface SectionContent {
  citation: string;
  title_label: string;
  part_label: string;
  section_label?: string;
  text: string; // plain-text extraction
  effective_date: string;
}

/**
 * Fetch the current full text of a CFR section. We use the XML endpoint
 * (returns clean XML) and strip tags for readable text, while preserving
 * paragraph structure.
 */
export async function getSection(
  citation: string,
): Promise<{ payload: SectionContent; sourceUrl: string }> {
  const { title, part, section } = parseCitation(citation);

  // eCFR versioner needs a date. "current" isn't a date — use today.
  const today = new Date().toISOString().slice(0, 10);

  // We request the whole part as XML and then extract the section we want.
  // Pulling the whole part is cheap (most parts are <1MB) and we cache it.
  const url =
    `${BASE}/api/versioner/v1/full/${today}/title-${title}.xml?part=${part}`;

  const cacheKey = `ecfr:section:${title}:${part}:${section ?? "all"}`;
  const cached = cache.get(cacheKey) as SectionContent | null;
  if (cached) return { payload: cached, sourceUrl: url };

  const { body, status } = await httpGet(url);
  if (status >= 400) {
    throw new Error(
      `eCFR returned ${status} for ${citation}. Body: ${body.slice(0, 200)}`,
    );
  }

  const extracted = extractSectionFromXml(body, { title, part, section });
  const payload: SectionContent = {
    citation,
    title_label: `Title ${title}`,
    part_label: `Part ${part}`,
    section_label: section ? `§ ${section}` : undefined,
    text: extracted,
    effective_date: today,
  };

  cache.set(cacheKey, payload, TTL.SIX_HOURS);
  return { payload, sourceUrl: url };
}

/**
 * Extract a section's text from eCFR XML.
 * We don't pull in a full XML parser; a targeted regex + tag-strip is enough
 * given the predictable eCFR document structure.
 */
function extractSectionFromXml(
  xml: string,
  ref: { title: string; part: string; section?: string },
): string {
  let chunk = xml;

  if (ref.section) {
    // eCFR sections are wrapped in <DIV8 N="214.2" TYPE="SECTION">…</DIV8>
    const re = new RegExp(
      `<DIV8[^>]*N="${ref.section.replace(/\./g, "\\.")}"[^>]*TYPE="SECTION"[\\s\\S]*?<\\/DIV8>`,
      "i",
    );
    const m = xml.match(re);
    if (m) chunk = m[0];
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
