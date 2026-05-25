/**
 * USCIS.gov form pages — extract "What to File" / required documentation.
 *
 * URL pattern: https://www.uscis.gov/<form-slug>
 *   e.g. /i-485, /i-130, /n-400
 *
 * These pages are server-rendered HTML with consistent structure: a set of
 * accordion-style sections titled "Forms and Document Downloads",
 * "What to File", "Where to File", "Filing Fees", and "Special Instructions".
 *
 * We use cheerio to walk the DOM. If the structure changes, the worst case
 * is that we return less content — never garbage — because we always include
 * the source URL.
 */
import * as cheerio from "cheerio";
import { httpGet } from "../lib/http.js";
import { cache, TTL } from "../lib/cache.js";

export interface FormRequirements {
  form_id: string;
  title: string;
  edition_date?: string;
  sections: {
    what_to_file?: string;
    where_to_file?: string;
    filing_fees?: string;
    special_instructions?: string;
    forms_and_documents?: string;
  };
  raw_text_length: number;
}

const SECTION_ALIASES: Record<keyof FormRequirements["sections"], string[]> = {
  what_to_file: ["what to file", "what you need to file"],
  where_to_file: ["where to file"],
  filing_fees: ["filing fee", "fees"],
  special_instructions: ["special instructions", "instructions"],
  forms_and_documents: ["forms and document downloads", "forms and documents", "form details"],
};

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
  cache.set(cacheKey, payload, TTL.SEVEN_DAYS);

  return { payload, sourceUrl: url };
}

function parseFormPage(html: string, formId: string): FormRequirements {
  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    formId;

  // Edition date appears in body text as e.g. "Edition Date 01/20/25"
  const bodyText = $("body").text();
  const editionMatch = bodyText.match(/Edition Date[\s:]*([0-9/]+)/i);
  const editionDate = editionMatch?.[1];

  // Walk all section-like headings and capture the text that follows
  const sections: FormRequirements["sections"] = {};

  // USCIS uses h2/h3 headings inside accordion components
  $("h2, h3").each((_, el) => {
    const heading = $(el).text().trim().toLowerCase();
    if (!heading) return;

    const matched = matchSection(heading);
    if (!matched) return;

    // Collect the text of the next siblings until the next heading
    let collected = "";
    let cursor = $(el).next();
    while (cursor.length && !cursor.is("h1, h2, h3")) {
      const t = cursor.text().trim();
      if (t) collected += t + "\n\n";
      cursor = cursor.next();
    }

    // Also try the parent panel — accordions wrap content in siblings/children
    if (!collected) {
      const parent = $(el).parent();
      collected = parent.text().replace($(el).text(), "").trim();
    }

    collected = collected.replace(/\n{3,}/g, "\n\n").trim();
    if (collected && !sections[matched]) {
      sections[matched] = collected.slice(0, 4000); // cap per-section
    }
  });

  return {
    form_id: formId.toUpperCase(),
    title,
    edition_date: editionDate,
    sections,
    raw_text_length: bodyText.length,
  };
}

function matchSection(
  heading: string,
): keyof FormRequirements["sections"] | null {
  for (const [key, aliases] of Object.entries(SECTION_ALIASES) as Array<
    [keyof FormRequirements["sections"], string[]]
  >) {
    if (aliases.some((a) => heading.includes(a))) return key;
  }
  return null;
}

function normaliseSlug(formId: string): string {
  // "I-485" → "i-485"
  return formId.trim().toLowerCase().replace(/\s+/g, "");
}
