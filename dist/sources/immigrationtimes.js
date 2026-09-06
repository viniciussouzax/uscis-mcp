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
// ── Internal helpers ─────────────────────────────────────────────────────────
/** "I-485", "i 485", "I485" → "i-485" — the hyphen is required by the API. */
function normaliseSlug(formId) {
    return formId
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/^([a-z]{1,3})-?(\d)/, "$1-$2");
}
async function fetchForm(slug) {
    const cacheKey = `imgt:form:${slug}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${BASE}/${encodeURIComponent(slug)}.json`;
    const data = await httpGetJson(url);
    if (data.status !== "ok") {
        throw new Error(`immigrationtimes.org returned status "${data.status}" for ${slug}.`);
    }
    cache.set(cacheKey, data, TTL.ONE_DAY);
    return data;
}
// ── Exported functions ────────────────────────────────────────────────────────
export async function listFormTypes(formId) {
    const slug = normaliseSlug(formId);
    const form = await fetchForm(slug);
    // Dedupe by subtype — each subtype is a "form type" in the egov sense
    const seen = new Set();
    const types = [];
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
export async function listOffices(formId, subtype) {
    const slug = normaliseSlug(formId);
    const form = await fetchForm(slug);
    const seen = new Set();
    const offices = [];
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
export async function getProcessingTime(args) {
    const slug = normaliseSlug(args.formId);
    const url = `${BASE}/${encodeURIComponent(slug)}.json`;
    const form = await fetchForm(slug);
    // Filter candidates by subtype and optional office_code
    let candidates = form.offices.filter((e) => e.lower_months !== null);
    if (args.formType) {
        const byType = candidates.filter((e) => e.subtype === args.formType);
        if (byType.length)
            candidates = byType;
    }
    if (args.officeCode) {
        const wanted = args.officeCode.toUpperCase();
        const byOffice = candidates.filter((e) => e.office_code.toUpperCase() === wanted);
        if (!byOffice.length) {
            const available = [...new Set(candidates.map((e) => e.office_code))].sort();
            throw new Error(`No processing time published for ${form.form} at office "${args.officeCode}". ` +
                `Offices with data: ${available.join(", ") || "(none)"}.`);
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
        .map((e) => ({
        office_code: e.office_code,
        subtype: e.subtype,
        subtype_info: e.subtype_info,
        low_months: e.lower_months,
        high_months: e.upper_months,
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
const EMPTY_TIME = {
    office_code: "",
    subtype: "",
    low_months: 0,
    high_months: 0,
};
function midpoint(t) {
    return (t.low_months + t.high_months) / 2;
}
//# sourceMappingURL=immigrationtimes.js.map