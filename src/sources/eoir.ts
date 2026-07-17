/**
 * EOIR "Agency Decisions" source — precedential BIA / Attorney General
 * decisions published as Administrative Decisions Under Immigration and
 * Nationality Laws (I&N Dec.) on justice.gov/eoir.
 *
 * Two page generations exist and share one table-based markup pattern:
 *   - legacy volumes (8-26):  /eoir/vll/intdec/nfvolNN.html
 *   - modern volumes (27+):   /eoir/volume-NN
 * Each decision is a <table class="no-background"> (case name + citation in
 * the left cell, an "ID NNNN" PDF link in the right cell) followed by <p>
 * holding summaries up to an <hr> separator.
 *
 * Full decision text is PDF-only; we download and extract with pdf-parse.
 */
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { PDFParse } from "pdf-parse";
import { httpGet, httpGetBuffer } from "../lib/http.js";
import { cache, TTL } from "../lib/cache.js";

const BASE = "https://www.justice.gov";
export const LANDING_URL = `${BASE}/eoir/ag-bia-decisions`;

export interface BiaDecision {
  /** Interim Decision number, e.g. "4084" — unique across all volumes. */
  id: string;
  case_name: string;
  /** e.g. "28 I&N Dec. 883 (BIA 2025)" */
  citation: string;
  /** Deciding forum as printed in the citation, e.g. "BIA", "A.G." */
  forum: string;
  year: number | null;
  volume: number;
  pdf_url: string;
  /** Holding summary as published on the volume listing page. */
  summary: string;
}

export interface BiaDecisionText {
  decision: BiaDecision;
  pages: number;
  char_count: number;
  truncated: boolean;
  text: string;
}

interface VolumeRef {
  volume: number;
  url: string;
}

/** Extraction cap — keeps tool responses within a sane context budget. */
const MAX_TEXT_CHARS = 40_000;
const FETCH_CONCURRENCY = 6;

export async function getVolumeIndex(): Promise<VolumeRef[]> {
  const cacheKey = "eoir:bia:volumes";
  const cached = cache.get(cacheKey) as VolumeRef[] | null;
  if (cached) return cached;

  const { body, status } = await httpGet(LANDING_URL);
  if (status >= 400) {
    throw new Error(`EOIR decisions landing page returned HTTP ${status}`);
  }

  const $ = cheerio.load(body);
  const seen = new Map<number, VolumeRef>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    // OCAHO volumes live under /eoir/OcahoMain/ — different body, skip.
    if (href.includes("OcahoMain")) return;
    const m = $(el).text().match(/^\s*Volume\s+0?(\d{1,2})\s*\(/i);
    if (!m) return;
    const volume = Number(m[1]);
    if (!seen.has(volume)) {
      seen.set(volume, { volume, url: new URL(href, BASE).toString() });
    }
  });

  const volumes = [...seen.values()].sort((a, b) => a.volume - b.volume);
  if (volumes.length === 0) {
    throw new Error(
      `Found no I&N Dec. volume links on ${LANDING_URL} — page structure may have changed`,
    );
  }

  cache.set(cacheKey, volumes, TTL.SEVEN_DAYS);
  return volumes;
}

export async function getVolumeDecisions(ref: VolumeRef, latestVolume: number): Promise<BiaDecision[]> {
  const cacheKey = `eoir:bia:vol:${ref.volume}`;
  const cached = cache.get(cacheKey) as BiaDecision[] | null;
  if (cached) return cached;

  const { body, status } = await httpGet(ref.url);
  if (status >= 400) {
    throw new Error(`EOIR volume ${ref.volume} page returned HTTP ${status}`);
  }

  const $ = cheerio.load(body);
  const decisions: BiaDecision[] = [];

  // Three page generations share the same building block: a two-cell row
  // with the case name + citation on the left and a numeric PDF link on the
  // right. Modern pages wrap each decision in its own single-row table with
  // summary <p>s after it; the oldest pages stack every decision as rows of
  // one big table with no summaries. Parsing per-row covers both.
  $("table.no-background").each((_, tableEl) => {
    const $table = $(tableEl);
    const rows = $table.find("tr");
    const decisionRows: Array<{ row: AnyNode; decision: BiaDecision }> = [];

    rows.each((_, rowEl) => {
      const cells = $(rowEl).children("td");
      if (cells.length < 2) return; // separator rows (<td colspan=2><hr>)

      const $nameCell = $(cells[0]);
      const caseName = $nameCell
        .find("strong")
        .first()
        .text()
        .replace(/[,\s]+$/, "")
        .trim();
      if (!caseName) return;

      const cellText = $nameCell.text().replace(/\s+/g, " ").trim();
      const citation = cellText
        .slice(cellText.toLowerCase().indexOf(caseName.toLowerCase()) + caseName.length)
        .replace(/^[,\s]+/, "")
        .trim();

      // The PDF anchor's text is the interim decision number: "ID 4084" on
      // newer pages, bare "1901" on the oldest ones.
      let id = "";
      let pdfUrl = "";
      $(cells[1])
        .find("a[href]")
        .each((_, aEl) => {
          const idMatch = $(aEl).text().trim().match(/^(?:ID\s*)?(\d{3,5})$/i);
          if (idMatch && !id) {
            id = idMatch[1];
            pdfUrl = new URL($(aEl).attr("href")!, BASE).toString();
          }
        });
      if (!id) return;

      const forumMatch = citation.match(/\(([^)]*?)\s*(\d{4})\)/);

      decisionRows.push({
        row: rowEl,
        decision: {
          id,
          case_name: caseName,
          citation,
          forum: forumMatch ? forumMatch[1].trim() : "",
          year: forumMatch ? Number(forumMatch[2]) : null,
          volume: ref.volume,
          pdf_url: pdfUrl,
          summary: "",
        },
      });
    });

    // Single-decision table → the holding summary lives in the <p> siblings
    // that follow the table. Multi-decision tables (pre-vol-19 pages) don't
    // publish summaries at all.
    if (decisionRows.length === 1) {
      const summaryParts: string[] = [];
      $table.nextUntil("hr, table").each((_, sib: AnyNode) => {
        const t = $(sib).text().replace(/\s+/g, " ").trim();
        if (t) summaryParts.push(t);
      });
      decisionRows[0].decision.summary = summaryParts.join("\n\n");
    }

    for (const { decision } of decisionRows) decisions.push(decision);
  });

  // The newest volume gains decisions continuously; older ones are static.
  const ttl = ref.volume === latestVolume ? TTL.ONE_DAY : TTL.SEVEN_DAYS;
  cache.set(cacheKey, decisions, ttl);
  return decisions;
}

/** Load every decision, optionally restricted to a single volume. */
export async function loadDecisions(volume?: number): Promise<{
  decisions: BiaDecision[];
  volumesSearched: number[];
}> {
  const index = await getVolumeIndex();
  const latest = index[index.length - 1].volume;
  const refs = volume !== undefined ? index.filter((r) => r.volume === volume) : index;

  if (volume !== undefined && refs.length === 0) {
    const available = index.map((r) => r.volume).join(", ");
    throw new Error(`Volume ${volume} not found. Available volumes: ${available}`);
  }

  const all: BiaDecision[] = [];
  for (let i = 0; i < refs.length; i += FETCH_CONCURRENCY) {
    const chunk = refs.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(chunk.map((r) => getVolumeDecisions(r, latest)));
    for (const list of results) all.push(...list);
  }

  return { decisions: all, volumesSearched: refs.map((r) => r.volume) };
}

const STOPWORDS = new Set(["matter", "of", "in", "re", "the", "a", "an", "and", "or"]);

export interface BiaSearchResult {
  results: BiaDecision[];
  total_matches: number;
  volumes_searched: number[];
}

export async function searchBiaDecisions(
  query: string,
  opts: { volume?: number; maxResults?: number } = {},
): Promise<{ payload: BiaSearchResult; sourceUrl: string }> {
  const maxResults = opts.maxResults ?? 10;
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9&§-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

  if (terms.length === 0) {
    throw new Error(`Query "${query}" contains no searchable terms`);
  }

  const { decisions, volumesSearched } = await loadDecisions(opts.volume);

  const scored = decisions
    .map((d) => {
      const name = d.case_name.toLowerCase();
      const cite = d.citation.toLowerCase();
      const summary = d.summary.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (name.includes(term)) score += 3;
        if (cite.includes(term)) score += 2;
        if (summary.includes(term)) score += 1;
      }
      return { d, score };
    })
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.d.volume - a.d.volume ||
        Number(b.d.id) - Number(a.d.id),
    );

  return {
    payload: {
      results: scored.slice(0, maxResults).map((s) => s.d),
      total_matches: scored.length,
      volumes_searched: volumesSearched,
    },
    sourceUrl: LANDING_URL,
  };
}

/** Look a decision up by interim decision number or I&N Dec. citation. */
export async function getBiaDecisionText(query: {
  id?: string;
  citation?: string;
}): Promise<{ payload: BiaDecisionText; sourceUrl: string }> {
  let match: BiaDecision | undefined;

  if (query.id) {
    const id = query.id.replace(/^ID\s*/i, "").trim();
    const { decisions } = await loadDecisions();
    match = decisions.find((d) => d.id === id);
    if (!match) {
      throw new Error(
        `No decision found with interim decision number "${id}". ` +
          `Use search_bia_decisions to find valid IDs.`,
      );
    }
  } else if (query.citation) {
    // Volume prefix ("28 I&N Dec. 883") lets us fetch a single volume page.
    const volMatch = query.citation.match(/^\s*(\d{1,2})\s+I\s*&\s*N/i);
    const pageMatch = query.citation.match(/I\s*&\s*N\s*(?:Dec\.?)?\s*(?:at\s+)?(\d+)/i);
    if (!volMatch || !pageMatch) {
      throw new Error(
        `Could not parse citation "${query.citation}". Expected a form like "28 I&N Dec. 883".`,
      );
    }
    const volume = Number(volMatch[1]);
    const page = pageMatch[1];
    const { decisions } = await loadDecisions(volume);
    match = decisions.find((d) =>
      new RegExp(`I\\s*&\\s*N\\s*(Dec\\.?)?\\s*${page}(\\D|$)`, "i").test(d.citation),
    );
    if (!match) {
      throw new Error(
        `No decision matching "${query.citation}" found in volume ${volume}. ` +
          `Use search_bia_decisions to locate it.`,
      );
    }
  } else {
    throw new Error(`Provide either "id" or "citation".`);
  }

  const cacheKey = `eoir:bia:text:${match.id}`;
  const cached = cache.get(cacheKey) as BiaDecisionText | null;
  if (cached) return { payload: cached, sourceUrl: match.pdf_url };

  const { body, status, contentType } = await httpGetBuffer(match.pdf_url);
  if (status >= 400) {
    throw new Error(`PDF download failed with HTTP ${status} for ${match.pdf_url}`);
  }
  if (!contentType.includes("pdf") && !body.subarray(0, 5).toString().startsWith("%PDF")) {
    throw new Error(
      `Expected a PDF at ${match.pdf_url} but got content-type "${contentType}"`,
    );
  }

  const parser = new PDFParse({ data: body });
  try {
    const result = await parser.getText();
    const fullText = result.text.trim();
    const truncated = fullText.length > MAX_TEXT_CHARS;

    const payload: BiaDecisionText = {
      decision: match,
      pages: result.pages?.length ?? 0,
      char_count: fullText.length,
      truncated,
      text: truncated ? fullText.slice(0, MAX_TEXT_CHARS) : fullText,
    };

    cache.set(cacheKey, payload, TTL.SEVEN_DAYS);
    return { payload, sourceUrl: match.pdf_url };
  } finally {
    await parser.destroy();
  }
}
