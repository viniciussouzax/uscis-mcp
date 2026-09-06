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
 * Parse a citation like "8 CFR 214.2(h)(4)" into the bits eCFR needs.
 *
 * The paragraph designators used to be dropped here, which meant
 * "8 CFR 214.2(h)" and "8 CFR 214.2" returned byte-identical text — asking
 * for the H-1B rules handed back all of § 214.2, every nonimmigrant class
 * from A to V.
 */
export function parseCitation(citation: string): {
  title: string;
  part: string;
  section?: string;
  paragraphs: string[];
} {
  // Accept: "8 CFR 214.2", "8 CFR 214.2(h)", "8 CFR 214", "8 CFR §214.2"
  const cleaned = citation.replace(/§/g, "").replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^(\d+)\s*CFR\s*(\d+)(?:\.(\d+))?((?:\([A-Za-z0-9]{1,5}\))*)/i);
  if (!m) {
    throw new Error(
      `Could not parse CFR citation "${citation}". Expected format like "8 CFR 214.2".`,
    );
  }
  const [, title, part, sectionNum, paragraphTail] = m;
  const paragraphs = sectionNum
    ? [...(paragraphTail ?? "").matchAll(/\(([A-Za-z0-9]{1,5})\)/g)].map(
        (p) => p[1],
      )
    : [];

  return {
    title,
    part,
    section: sectionNum ? `${part}.${sectionNum}` : undefined,
    paragraphs,
  };
}

export interface SectionContent {
  citation: string;
  title_label: string;
  part_label: string;
  section_label?: string;
  /** Paragraph asked for, e.g. "(h)(4)". Absent when the citation had none. */
  paragraph_requested?: string;
  /**
   * Paragraph actually isolated. Shorter than `paragraph_requested` when a
   * deeper level could not be resolved — eCFR sometimes runs a level into the
   * middle of its parent (`—(i)(A)`) instead of giving it its own element, and
   * returning the parent is safer than guessing at a boundary.
   */
  paragraph_resolved?: string;
  text: string; // plain-text extraction
  /** Full length of the extracted text, whether or not it was cut. */
  char_count: number;
  /** True only when the caller passed maxChars and the text exceeded it. */
  truncated: boolean;
  effective_date: string;
}

/**
 * There is no built-in cap. The regulation is returned whole, because a fixed
 * ceiling cuts the law at an arbitrary point that has nothing to do with what
 * was asked for — and the honest way to get a smaller answer is a narrower
 * citation, not a truncated one. Cite the paragraph and the text shrinks by
 * itself: § 214.2 is ~700k characters, § 214.2(h) is 253k, § 214.2(h)(4) is 31k.
 *
 * Callers that genuinely need a ceiling (a small context window, a UI preview)
 * pass maxChars and get `truncated` back. That is their call to make, not this
 * module's.
 */
export interface GetSectionOptions {
  maxChars?: number;
}

/**
 * Fetch the current full text of a CFR section. We use the XML endpoint
 * (returns clean XML) and strip tags for readable text, while preserving
 * paragraph structure.
 */
// ── Latest issue date ────────────────────────────────────────────────────────

interface TitlesResp {
  titles?: Array<{ number: number | string; latest_issue_date?: string }>;
}

/**
 * eCFR titles have a publication lag — using "today" returns 404 when the
 * title hasn't been updated yet. This fetches the actual latest issue date.
 */
async function getLatestIssueDate(titleNumber: string): Promise<string> {
  const cacheKey = `ecfr:latest_date:${titleNumber}`;
  const cached = cache.get(cacheKey) as string | null;
  if (cached) return cached;

  const url = `${BASE}/api/versioner/v1/titles`;
  const json = await httpGetJson<TitlesResp>(url);
  const entry = (json.titles ?? []).find(
    (t) => String(t.number) === String(titleNumber),
  );

  const date =
    entry?.latest_issue_date ?? new Date().toISOString().slice(0, 10);
  cache.set(cacheKey, date, TTL.ONE_DAY);
  return date;
}

export async function getSection(
  citation: string,
  opts: GetSectionOptions = {},
): Promise<{ payload: SectionContent; sourceUrl: string }> {
  const { title, part, section, paragraphs } = parseCitation(citation);

  // Use the actual latest published date — eCFR has a multi-day publication
  // lag and returns 404 if you request a date past the latest issue date.
  const issueDate = await getLatestIssueDate(title);

  // We request the whole part as XML and then extract the section we want.
  // Pulling the whole part is cheap (most parts are <1MB) and we cache it.
  const url =
    `${BASE}/api/versioner/v1/full/${issueDate}/title-${title}.xml?part=${part}`;

  // The paragraph must be part of the key. Without it every paragraph of a
  // section shares one entry, so the first one fetched is served for all.
  const paragraphKey = paragraphs.length ? paragraphs.join("|") : "whole";
  const cacheKey = `ecfr:section:${title}:${part}:${section ?? "all"}:${paragraphKey}`;
  // The cache always holds the untruncated text; maxChars is applied to the
  // copy handed back, so two callers asking with different limits cannot
  // poison each other's result.
  const cached = cache.get(cacheKey) as SectionContent | null;
  if (cached) return { payload: applyLimit(cached, opts.maxChars), sourceUrl: url };

  const { body, status } = await httpGet(url);
  if (status >= 400) {
    throw new Error(
      `eCFR returned ${status} for ${citation}. Body: ${body.slice(0, 200)}`,
    );
  }

  const { text, resolved } = extractSectionFromXml(body, {
    title,
    part,
    section,
    paragraphs,
  });

  const payload: SectionContent = {
    citation,
    title_label: `Title ${title}`,
    part_label: `Part ${part}`,
    section_label: section ? `§ ${section}` : undefined,
    paragraph_requested: paragraphs.length
      ? paragraphs.map((p) => `(${p})`).join("")
      : undefined,
    paragraph_resolved: resolved.length
      ? resolved.map((p) => `(${p})`).join("")
      : undefined,
    text,
    char_count: text.length,
    truncated: false,
    effective_date: issueDate,
  };

  cache.set(cacheKey, payload, TTL.SIX_HOURS);
  return { payload: applyLimit(payload, opts.maxChars), sourceUrl: url };
}

/** Return a view of `payload` cut to `limit`, or `payload` itself when uncapped. */
function applyLimit(
  payload: SectionContent,
  limit: number | undefined,
): SectionContent {
  if (typeof limit !== "number" || payload.char_count <= limit) return payload;
  return { ...payload, text: payload.text.slice(0, limit), truncated: true };
}

/**
 * Extract a section's text from eCFR XML.
 * We don't pull in a full XML parser; a targeted regex + tag-strip is enough
 * given the predictable eCFR document structure.
 */
function extractSectionFromXml(
  xml: string,
  ref: {
    title: string;
    part: string;
    section?: string;
    paragraphs: string[];
  },
): { text: string; resolved: string[] } {
  let chunk = xml;
  const resolved: string[] = [];

  if (ref.section) {
    // eCFR sections are wrapped in <DIV8 N="214.2" TYPE="SECTION">…</DIV8>
    const re = new RegExp(
      `<DIV8[^>]*N="${ref.section.replace(/\./g, "\\.")}"[^>]*TYPE="SECTION"[\\s\\S]*?<\\/DIV8>`,
      "i",
    );
    const m = xml.match(re);
    if (m) chunk = m[0];

    // Narrow one level at a time, stopping at the first level we cannot
    // prove. A wrong slice would return confident, wrong law; the parent is
    // always a safe answer.
    for (const designator of ref.paragraphs) {
      const narrowed = sliceParagraph(chunk, designator);
      if (!narrowed) break;
      chunk = narrowed;
      resolved.push(designator);
    }
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
    return {
      text: "(Section text could not be extracted. The citation may be valid but require manual lookup at the source URL.)",
      resolved,
    };
  }
  return { text, resolved };
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const ROMANS = [
  "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
  "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx",
];
const UPPER = LETTERS.map((l) => l.toUpperCase());
const NUMBERS = Array.from({ length: 60 }, (_, i) => String(i + 1));

/**
 * The sequence a designator belongs to. CFR nests as
 * (a) → (1) → (i) → (A) → (1) → (i), so case carries meaning: a lowercase
 * letter is level 1, an uppercase letter is level 4. Matching
 * case-insensitively makes "(h)" collide with the "(H)" of an unrelated
 * sub-list — in § 214.2 that is the difference between the H visa rules and
 * a clause about commercial transactions under the B visa.
 */
function sequenceFor(designator: string): string[] | null {
  if (/^\d+$/.test(designator)) return NUMBERS;
  if (UPPER.includes(designator)) return UPPER;
  // "i" is ambiguous between letter and roman numeral; treat it as a letter,
  // which is the level it occupies when it appears as a top-level paragraph.
  if (designator !== "i" && ROMANS.includes(designator)) return ROMANS;
  if (LETTERS.includes(designator)) return LETTERS;
  return null;
}

/**
 * Isolate one paragraph from an XML chunk.
 *
 * Designators cannot be matched by pattern alone: § 214.2 contains a nested
 * "(i) Spouse;" thousands of characters before its real top-level "(i)". So we
 * walk designators in document order and only accept one that is the next
 * expected in its sequence, which pins each match to its level. Returns null
 * when the designator cannot be proven, leaving the caller with the parent.
 */
function sliceParagraph(chunk: string, designator: string): string | null {
  const order = sequenceFor(designator);
  if (!order) return null;

  const targetIdx = order.indexOf(designator);
  if (targetIdx < 0) return null;

  const re = /<P[^>]*>\s*\(([A-Za-z0-9]{1,5})\)/g;
  let expected = 0;
  let startOffset = -1;
  let m: RegExpExecArray | null;

  while ((m = re.exec(chunk)) !== null) {
    if (m[1] !== order[expected]) continue;

    if (expected === targetIdx) {
      startOffset = m.index;
      expected++;
      continue;
    }
    if (startOffset >= 0 && expected === targetIdx + 1) {
      return chunk.slice(startOffset, m.index); // next sibling — stop here
    }
    expected++;
  }

  return startOffset >= 0 ? chunk.slice(startOffset) : null;
}
