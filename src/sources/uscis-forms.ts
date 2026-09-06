/**
 * USCIS.gov form pages — extract the filing checklist and instructions.
 *
 * URL pattern: https://www.uscis.gov/<form-slug>
 *   e.g. /i-485, /i-130, /n-400
 *
 * Page structure (verified across I-485, I-130, N-400, I-765, I-90, I-751,
 * I-129 and G-28 in 2026-09): the sections a filer needs are rendered as
 * accordion widgets — a `div.accordion__header` immediately followed by a
 * sibling `div.accordion__panel`. They are NOT h2/h3 headings. The only h2s
 * on the page are the site-wide nav ("Topics", "Forms", "Newsroom", …) plus a
 * single "Form Details" wrapper that contains every accordion at once.
 *
 * We still run a heading pass as a fallback, so a future template revert
 * degrades instead of breaking.
 *
 * The "Checklist of Required Initial Evidence" panel is often just a link to a
 * standalone checklist page — on I-765 the panel holds 48 characters while the
 * linked page holds the actual 134-item document list. We follow that link,
 * because that list is the whole point of the tool.
 */
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

/** What `$()` accepts: a raw node or an existing Cheerio selection. */
type Selectable = Parameters<CheerioAPI>[0];
import { httpGet } from "../lib/http.js";
import {
  FEE_SCHEDULE_URL,
  getFormFees,
  type FormFees,
} from "./uscis-fees.js";
import { cache, TTL } from "../lib/cache.js";

export interface FormRequirements {
  form_id: string;
  title: string;
  edition_date?: string;
  sections: {
    what_to_file?: string;
    where_to_file?: string;
    when_to_file?: string;
    filing_fees?: string;
    special_instructions?: string;
    form_filing_tips?: string;
    forms_and_documents?: string;
  };
  /** Set when the checklist lives on its own page and we followed the link. */
  checklist_url?: string;
  /**
   * Fees from the official G-1055 schedule. Null when the schedule has no block
   * for this form, or when fetching it failed — never a guess, and never a
   * number lifted from the form page, which does not publish one.
   */
  filing_fee?: FormFees | null;
  fee_source_url?: string;
  /** Sections cut by MAX_SECTION_CHARS — never truncate silently. */
  truncated_sections?: Array<{ section: string; returned: number; total: number }>;
  raw_text_length: number;
}

type SectionKey = keyof FormRequirements["sections"];

/**
 * Matched against the accordion header text, lowercased. First alias that
 * substring-matches wins.
 *
 * "what to file" is kept for older/other templates but no longer appears on
 * USCIS.gov — the section is now titled "Checklist of Required Initial
 * Evidence (for informational purposes only)".
 */
const SECTION_ALIASES: Record<SectionKey, string[]> = {
  what_to_file: [
    "checklist of required initial evidence",
    "what to file",
    "what you need to file",
  ],
  where_to_file: ["where to file"],
  when_to_file: ["when to file"],
  filing_fees: ["filing fee", "fees"],
  form_filing_tips: ["form filing tips", "filing tips"],
  special_instructions: ["special instructions", "instructions"],
  forms_and_documents: [
    "forms and document downloads",
    "forms and documents",
    "form details",
  ],
};

/**
 * Per-section cap. Generous enough to hold a full checklist page (the largest
 * measured is ~22k chars) — and whatever it does cut is reported in
 * `truncated_sections` rather than dropped in silence.
 */
const MAX_SECTION_CHARS = 25_000;

export async function getFormRequirements(
  formId: string,
): Promise<{ payload: FormRequirements; sourceUrl: string }> {
  const slug = normaliseSlug(formId);
  const url = `https://www.uscis.gov/${slug}`;

  const cacheKey = `uscis:form:${slug}`;
  const cached = cache.get(cacheKey) as FormRequirements | null;
  if (cached) return { payload: cached, sourceUrl: url };

  const { body, status } = await httpGet(url);
  if (status === 404) {
    throw new Error(
      `USCIS form page not found at ${url}. Check the form ID format (e.g. "I-485", "N-400").`,
    );
  }
  if (status >= 400) {
    throw new Error(`USCIS.gov returned ${status} for ${url}.`);
  }

  const payload = parseFormPage(body, formId);

  // The checklist is the highest-value section and is frequently off-page.
  const checklistUrl = findChecklistLink(body);
  if (checklistUrl) {
    payload.checklist_url = checklistUrl;
    const full = await fetchChecklistPage(checklistUrl);
    if (full && full.length > (payload.sections.what_to_file?.length ?? 0)) {
      payload.sections.what_to_file = full;
    }
  }

  // Fees come from the G-1055 schedule, not from this page. A failure there
  // must not sink the rest of the lookup, so it degrades to null.
  try {
    const { payload: fees, sourceUrl: feeUrl } = await getFormFees(formId);
    payload.filing_fee = fees;
    payload.fee_source_url = feeUrl;
  } catch {
    payload.filing_fee = null;
    payload.fee_source_url = FEE_SCHEDULE_URL;
  }

  applyCaps(payload);
  cache.set(cacheKey, payload, TTL.SEVEN_DAYS);

  return { payload, sourceUrl: url };
}

function parseFormPage(html: string, formId: string): FormRequirements {
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim() || $("title").text().trim() || formId;

  // Edition date appears in body text as e.g. "Edition Date 01/20/25"
  const bodyText = $("body").text();
  const editionMatch = bodyText.match(/Edition Date[\s:]*([0-9/]+)/i);

  const sections: FormRequirements["sections"] = {};

  // Primary pass: accordion widgets — the current USCIS template.
  $(".accordion__header").each((_, el) => {
    const key = matchSection(headingText($, el));
    if (!key || sections[key]) return;

    let panel = $(el).next(".accordion__panel");
    if (!panel.length) panel = $(el).nextAll(".accordion__panel").first();
    if (!panel.length) return;

    const text = blockText($, panel);
    if (text) sections[key] = text;
  });

  // Fallback pass: h2/h3 headings, for templates that still use them. Only
  // fills keys the accordion pass did not, so it can never overwrite better data.
  $("h2, h3").each((_, el) => {
    const key = matchSection(headingText($, el));
    if (!key || sections[key]) return;

    const parts: string[] = [];
    let cursor = $(el).next();
    while (cursor.length && !cursor.is("h1, h2, h3")) {
      const t = blockText($, cursor);
      if (t) parts.push(t);
      cursor = cursor.next();
    }

    const text = parts.join("\n").trim();
    if (text) sections[key] = text;
  });

  return {
    form_id: formId.toUpperCase(),
    title,
    edition_date: editionMatch?.[1],
    sections,
    raw_text_length: bodyText.length,
  };
}

/**
 * Locate the standalone "Checklist of Required Initial Evidence" page.
 *
 * There is no single URL convention: I-485 and I-765 link to
 * `/forms/filing-guidance/checklist-of-required-initial-evidence-for-form-…`
 * while I-129 links to `/i-129Checklist`. So we look for any link inside the
 * checklist panel itself whose href mentions "checklist", and only fall back
 * to a page-wide search for the long-form URL.
 */
function findChecklistLink(html: string): string | undefined {
  const $ = cheerio.load(html);

  const panel = $(".accordion__header")
    .filter((_, el) => matchSection(headingText($, el)) === "what_to_file")
    .first()
    .next(".accordion__panel");

  let href: string | undefined;
  panel.find("a[href]").each((_, a) => {
    if (href) return;
    const candidate = $(a).attr("href");
    if (candidate && candidate.toLowerCase().includes("checklist")) {
      href = candidate;
    }
  });

  href ??= $('a[href*="checklist-of-required-initial-evidence"]')
    .first()
    .attr("href");

  if (!href) return undefined;
  return href.startsWith("http")
    ? href
    : `https://www.uscis.gov${href.startsWith("/") ? "" : "/"}${href}`;
}

async function fetchChecklistPage(url: string): Promise<string | null> {
  const cacheKey = `uscis:checklist:${url}`;
  const cached = cache.get(cacheKey) as string | null;
  if (cached) return cached;

  try {
    const { body, status } = await httpGet(url);
    if (status >= 400) return null;

    const $ = cheerio.load(body);
    const main = $("main").length ? $("main") : $("body");
    const text = blockText($, main);
    if (!text) return null;

    cache.set(cacheKey, text, TTL.SEVEN_DAYS);
    return text;
  } catch {
    // A missing checklist page must not fail the whole lookup — the form page
    // content we already parsed is still worth returning.
    return null;
  }
}

/** Truncate over-long sections, recording what was cut. */
function applyCaps(payload: FormRequirements): void {
  const truncated: NonNullable<FormRequirements["truncated_sections"]> = [];

  for (const [key, value] of Object.entries(payload.sections) as Array<
    [SectionKey, string | undefined]
  >) {
    if (!value || value.length <= MAX_SECTION_CHARS) continue;
    payload.sections[key] = value.slice(0, MAX_SECTION_CHARS);
    truncated.push({
      section: key,
      returned: MAX_SECTION_CHARS,
      total: value.length,
    });
  }

  if (truncated.length) payload.truncated_sections = truncated;
}

/**
 * Text extraction that preserves document structure. `.text()` alone
 * concatenates block elements without separators, producing runs like
 * "…file Form I-485.View the checklist…" — which reads badly and flattens
 * list items, exactly the part a filer needs most.
 */
function blockText($: CheerioAPI, el: Selectable): string {
  const node = $(el).clone();
  node.find("script, style, noscript").remove();
  node.find("br").replaceWith("\n");
  node.find("li").each((_, li) => {
    $(li).prepend("\n• ");
  });
  node.find("p, div, tr, h1, h2, h3, h4, h5, h6").each((_, b) => {
    $(b).prepend("\n");
  });

  return node
    .text()
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function headingText($: CheerioAPI, el: Selectable): string {
  return $(el).text().trim().toLowerCase().replace(/\s+/g, " ");
}

function matchSection(heading: string): SectionKey | null {
  if (!heading) return null;
  for (const [key, aliases] of Object.entries(SECTION_ALIASES) as Array<
    [SectionKey, string[]]
  >) {
    if (aliases.some((a) => heading.includes(a))) return key;
  }
  return null;
}

/**
 * "I-485", "i 485", "I485" → "i-485".
 *
 * Stripping whitespace alone turned "I 485" into "i485", which 404s. People
 * and models write the number both ways, and the hyphen is not optional in
 * the URL.
 */
function normaliseSlug(formId: string): string {
  return formId
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^([a-z]{1,3})-?(\d)/, "$1-$2");
}
