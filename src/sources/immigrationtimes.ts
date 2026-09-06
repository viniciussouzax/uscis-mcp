/**
 * immigrationtimes.org processing times source.
 *
 * Base URL: https://immigrationtimes.org/api/v1
 * Auth:     none
 *
 * Third-party aggregator that collects USCIS processing time estimates daily
 * from egov.uscis.gov (which is Cloudflare-protected and unreachable via plain
 * HTTP). Data is in months, updated daily, and includes per-office/subtype
 * granularity that mirrors the egov API shape.
 *
 * Attribution field in each response points back to the USCIS source URL so
 * callers always have the provenance chain: immigrationtimes.org → USCIS.
 *
 * Exported functions intentionally match the same signatures as egov.ts so
 * the get-processing-time handler needs only a one-line import change.
 */
import { httpGetJson } from "../lib/http.js";
import { cache, TTL } from "../lib/cache.js";

const BASE = "https://immigrationtimes.org/api/v1";

// ── API response types ────────────────────────────────────────────────────────

interface ImmigrationTimesForm {
  form: string;
  slug: string;
  last_updated: string;
  status: string;
  processing_time: {
    avg_lower_months: number;
    avg_upper_months: number;
    min_months: number;
    max_months: number;
  };
  offices: OfficeEntry[];
  source: string;
  attribution: string;
}

interface OfficeEntry {
  office_code: string;
  subtype: string;
  subtype_info: string;
  lower_months: number | null;
  upper_months: number | null;
  publication_date: string;
  service_request_date: string;
}

// ── Types shared with the handler (mirrors egov.ts shapes) ───────────────────

export interface FormType {
  form_type: string;
  form_type_id?: string;
  description_en?: string;
}

export interface Office {
  office_code: string;
  office_description?: string;
}

export interface OfficeTime {
  office_code: string;
  subtype: string;
  subtype_info?: string;
  low_months: number;
  high_months: number;
  publication_date?: string;
  service_request_date?: string;
}

/**
 * How the numbers below were arrived at.
 *
 * "office" — a specific office was asked for and found, so the range is that
 * office's published estimate.
 *
 * "distribution" — no office was named. Processing time is published per
 * office and they disagree enormously: 96 offices publish an I-485 estimate
 * ranging from 6.5 to 70.5 months. There is no single correct number to give,
 * so none is given — the spread is returned instead.
 */
export type ProcessingTimeScope = "office" | "distribution";

export interface ProcessingTimeResult {
  form_id: string;
  scope: ProcessingTimeScope;
  form_type_used?: string;
  /** Set only when scope is "office". */
  office_code?: string;
  office_description?: string;
  /** Set only when scope is "office" — never a stand-in for the whole country. */
  range_low_months?: number;
  range_high_months?: number;
  service_request_date?: string;
  publication_date?: string;
  /** Set only when scope is "distribution". */
  distribution?: {
    offices_with_data: number;
    /** Ranked by the midpoint of each office's range. */
    median: OfficeTime;
    fastest: OfficeTime;
    slowest: OfficeTime;
    /** The aggregator's own published average across offices, if given. */
    published_average_low_months?: number;
    published_average_high_months?: number;
    offices: OfficeTime[];
  };
  attribution: string;
  raw: unknown;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** "I-485", "i 485", "I485" → "i-485" — the hyphen is required by the API. */
function normaliseSlug(formId: string): string {
  return formId
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^([a-z]{1,3})-?(\d)/, "$1-$2");
}

async function fetchForm(slug: string): Promise<ImmigrationTimesForm> {
  const cacheKey = `imgt:form:${slug}`;
  const cached = cache.get(cacheKey) as ImmigrationTimesForm | null;
  if (cached) return cached;

  const url = `${BASE}/${encodeURIComponent(slug)}.json`;
  const data = await httpGetJson<ImmigrationTimesForm>(url);

  if (data.status !== "ok") {
    throw new Error(
      `immigrationtimes.org returned status "${data.status}" for ${slug}.`,
    );
  }

  cache.set(cacheKey, data, TTL.ONE_DAY);
  return data;
}

// ── Exported functions ────────────────────────────────────────────────────────

export async function listFormTypes(formId: string): Promise<FormType[]> {
  const slug = normaliseSlug(formId);
  const form = await fetchForm(slug);

  // Dedupe by subtype — each subtype is a "form type" in the egov sense
  const seen = new Set<string>();
  const types: FormType[] = [];
  for (const entry of form.offices) {
    if (!seen.has(entry.subtype)) {
      seen.add(entry.subtype);
      types.push({
        form_type: entry.subtype,
        form_type_id: entry.subtype,
        description_en: entry.subtype_info,
      });
    }
  }
  return types;
}

export async function listOffices(
  formId: string,
  subtype: string,
): Promise<Office[]> {
  const slug = normaliseSlug(formId);
  const form = await fetchForm(slug);

  const seen = new Set<string>();
  const offices: Office[] = [];
  for (const entry of form.offices) {
    if (entry.subtype === subtype && !seen.has(entry.office_code)) {
      seen.add(entry.office_code);
      offices.push({
        office_code: entry.office_code,
        office_description: entry.subtype_info,
      });
    }
  }
  return offices;
}

export async function getProcessingTime(args: {
  formId: string;
  formType?: string;
  officeCode?: string;
}): Promise<{ payload: ProcessingTimeResult; sourceUrl: string }> {
  const slug = normaliseSlug(args.formId);
  const url = `${BASE}/${encodeURIComponent(slug)}.json`;
  const form = await fetchForm(slug);

  // Filter candidates by subtype and optional office_code
  let candidates = form.offices.filter((e) => e.lower_months !== null);

  if (args.formType) {
    const byType = candidates.filter((e) => e.subtype === args.formType);
    if (byType.length) candidates = byType;
  }

  if (args.officeCode) {
    const wanted = args.officeCode.toUpperCase();
    const byOffice = candidates.filter(
      (e) => e.office_code.toUpperCase() === wanted,
    );
    if (!byOffice.length) {
      const available = [...new Set(candidates.map((e) => e.office_code))].sort();
      throw new Error(
        `No processing time published for ${form.form} at office "${args.officeCode}". ` +
          `Offices with data: ${available.join(", ") || "(none)"}.`,
      );
    }

    // One office, one answer.
    const match = byOffice[0];
    return {
      payload: {
        form_id: form.form,
        scope: "office",
        form_type_used: match.subtype,
        office_code: match.office_code,
        office_description: match.subtype_info,
        range_low_months: match.lower_months ?? undefined,
        range_high_months: match.upper_months ?? undefined,
        service_request_date: match.service_request_date,
        publication_date: match.publication_date,
        attribution: form.attribution,
        raw: match,
      },
      sourceUrl: url,
    };
  }

  // No office named. The previous behaviour took candidates[0] — whichever
  // office happened to come first in the array — and presented it as the
  // processing time for the form. For I-130 that is FOD at 167-300 months
  // against a median of 53.5-71, an answer wrong by a factor of three and
  // indistinguishable from a considered one. Return the spread instead.
  const times = candidates
    .filter((e) => e.lower_months !== null && e.upper_months !== null)
    .map<OfficeTime>((e) => ({
      office_code: e.office_code,
      subtype: e.subtype,
      subtype_info: e.subtype_info,
      low_months: e.lower_months as number,
      high_months: e.upper_months as number,
      publication_date: e.publication_date,
      service_request_date: e.service_request_date,
    }));

  const pt = form.processing_time;

  if (!times.length) {
    // Nothing per-office: the aggregator's own average is all there is.
    return {
      payload: {
        form_id: form.form,
        scope: "distribution",
        distribution: {
          offices_with_data: 0,
          median: EMPTY_TIME,
          fastest: EMPTY_TIME,
          slowest: EMPTY_TIME,
          published_average_low_months: pt?.avg_lower_months,
          published_average_high_months: pt?.avg_upper_months,
          offices: [],
        },
        attribution: form.attribution,
        raw: pt,
      },
      sourceUrl: url,
    };
  }

  const ranked = [...times].sort((a, b) => midpoint(a) - midpoint(b));

  return {
    payload: {
      form_id: form.form,
      scope: "distribution",
      form_type_used: args.formType,
      publication_date: times[0].publication_date,
      distribution: {
        offices_with_data: ranked.length,
        median: ranked[Math.floor(ranked.length / 2)],
        fastest: ranked[0],
        slowest: ranked[ranked.length - 1],
        published_average_low_months: pt?.avg_lower_months,
        published_average_high_months: pt?.avg_upper_months,
        offices: ranked,
      },
      attribution: form.attribution,
      raw: pt,
    },
    sourceUrl: url,
  };
}

const EMPTY_TIME: OfficeTime = {
  office_code: "",
  subtype: "",
  low_months: 0,
  high_months: 0,
};

function midpoint(t: OfficeTime): number {
  return (t.low_months + t.high_months) / 2;
}
