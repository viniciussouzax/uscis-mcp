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
function normaliseSlug(formId) {
    return formId.trim().toLowerCase().replace(/\s+/g, "");
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
        const byOffice = candidates.filter((e) => e.office_code.toUpperCase() === args.officeCode.toUpperCase());
        if (byOffice.length)
            candidates = byOffice;
    }
    const match = candidates[0];
    if (match) {
        const payload = {
            form_id: form.form,
            form_type_used: match.subtype,
            office_code: match.office_code,
            office_description: match.subtype_info,
            range_low_months: match.lower_months ?? undefined,
            range_high_months: match.upper_months ?? undefined,
            service_request_date: match.service_request_date,
            publication_date: match.publication_date,
            attribution: form.attribution,
            raw: match,
        };
        return { payload, sourceUrl: url };
    }
    // Fall back to top-level aggregate when no office entry matches filters
    const pt = form.processing_time;
    const payload = {
        form_id: form.form,
        form_type_used: "aggregate",
        office_code: "all",
        range_low_months: pt.avg_lower_months,
        range_high_months: pt.avg_upper_months,
        attribution: form.attribution,
        raw: pt,
    };
    return { payload, sourceUrl: url };
}
//# sourceMappingURL=immigrationtimes.js.map