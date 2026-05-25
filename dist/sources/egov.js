/**
 * USCIS egov Processing Times.
 *
 * Base URL: https://egov.uscis.gov/processing-times/api
 * Auth:     none
 *
 * This API is the JSON backend that powers the public processing times
 * page. It is NOT formally documented by USCIS — the endpoint shapes here
 * were verified against the live page's network traffic and corroborated
 * by independent open-source scrapers.
 *
 * The flow is:
 *   1. GET /forms                         → list of form codes
 *   2. GET /formtypes/<form>              → sub-categories within a form
 *   3. GET /offices/<form>/<formTypeId>   → service centers handling it
 *   4. GET /processingtime/<form>/<formTypeId>/<officeCode>  → estimate
 *
 * Important 2026 caveat: USCIS is consolidating most service center labels
 * into a single "SCOPS" (Service Center Operations) bucket. Older data may
 * still return named centers (Nebraska, Vermont, etc.) — we surface
 * whatever the API returns rather than forcing a translation.
 */
import { httpGet } from "../lib/http.js";
import { cache, TTL } from "../lib/cache.js";
const BASE = "https://egov.uscis.gov/processing-times/api";
// egov.uscis.gov is behind a Cloudflare WAF. It blocks requests that don't
// pass a JavaScript-based challenge — browser-like headers alone are not
// enough because Cloudflare also checks the TLS fingerprint (JA3). Node's
// built-in fetch() has a different TLS fingerprint from Chrome regardless of
// what User-Agent is sent.
const EGOV_OPTS = {
    headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://egov.uscis.gov/processing-times/",
    },
};
const WAF_ERROR = "egov.uscis.gov is protected by Cloudflare bot detection, which requires " +
    "JavaScript challenge execution and a browser-matching TLS fingerprint. " +
    "A plain HTTP client cannot pass this check. To make this tool work, the " +
    "egov source needs to be rewritten to use a headless browser (e.g. " +
    "Playwright) or an alternative USCIS data source.";
async function egovGet(url) {
    const { body, status, contentType } = await httpGet(url, EGOV_OPTS);
    if (status === 403 || (status >= 400 && contentType.includes("text/html"))) {
        throw new Error(WAF_ERROR);
    }
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
// ── Step 1: list forms (cached for a day) ───────────────────────────────────
export async function listForms() {
    const cacheKey = "egov:forms";
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${BASE}/forms`;
    const json = await egovGet(url);
    const forms = json.data?.forms ?? json.forms ?? [];
    const names = forms.map((f) => f.form_name).filter(Boolean);
    cache.set(cacheKey, names, TTL.ONE_DAY);
    return names;
}
// ── Step 2: list form-types for a form ──────────────────────────────────────
export async function listFormTypes(formId) {
    const f = normaliseFormId(formId);
    const cacheKey = `egov:formtypes:${f}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${BASE}/formtypes/${encodeURIComponent(f)}`;
    const json = await egovGet(url);
    const types = json.data?.form_types ?? json.form_types ?? [];
    cache.set(cacheKey, types, TTL.ONE_DAY);
    return types;
}
// ── Step 3: list offices ────────────────────────────────────────────────────
export async function listOffices(formId, formTypeId) {
    const f = normaliseFormId(formId);
    const cacheKey = `egov:offices:${f}:${formTypeId}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${BASE}/offices/${encodeURIComponent(f)}/${encodeURIComponent(formTypeId)}`;
    const json = await egovGet(url);
    const offices = json.data?.offices ?? json.offices ?? [];
    cache.set(cacheKey, offices, TTL.ONE_DAY);
    return offices;
}
// ── Step 4: processing time ─────────────────────────────────────────────────
export async function getProcessingTime(args) {
    const formId = normaliseFormId(args.formId);
    // If no formType given, take the first one available
    let formTypeId = args.formType;
    if (!formTypeId) {
        const types = await listFormTypes(formId);
        if (!types.length) {
            throw new Error(`No form types found for ${formId}. USCIS may not currently publish processing times for this form.`);
        }
        formTypeId = types[0].form_type_id ?? types[0].form_type;
    }
    // If no office given, take the first one (or SCOPS if listed)
    let officeCode = args.officeCode;
    let officeDescription;
    if (!officeCode) {
        const offices = await listOffices(formId, formTypeId);
        if (!offices.length) {
            throw new Error(`No offices found for ${formId} / ${formTypeId}.`);
        }
        const scops = offices.find((o) => (o.office_code ?? "").toUpperCase().includes("SCOPS"));
        const chosen = scops ?? offices[0];
        officeCode = chosen.office_code;
        officeDescription = chosen.office_description;
    }
    const url = `${BASE}/processingtime/${encodeURIComponent(formId)}/${encodeURIComponent(formTypeId)}/${encodeURIComponent(officeCode)}`;
    const cacheKey = `egov:pt:${formId}:${formTypeId}:${officeCode}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return { payload: cached, sourceUrl: url };
    const json = await egovGet(url);
    const pt = json.data?.processing_time ?? json.processing_time;
    if (!pt) {
        throw new Error(`Processing time payload was empty for ${formId}/${formTypeId}/${officeCode}.`);
    }
    const range = pt.range ?? [];
    const low = range.find((r) => r.unit_of_measure_code?.toLowerCase().startsWith("m"))?.value;
    const high = range[range.length - 1]?.value;
    const result = {
        form_id: formId,
        form_type_used: formTypeId,
        office_code: officeCode,
        office_description: officeDescription,
        range_low_months: typeof low === "number" ? low : undefined,
        range_high_months: typeof high === "number" && high !== low ? high : undefined,
        service_request_date: pt.service_request_date,
        publication_date: pt.publication_date,
        raw: pt,
    };
    cache.set(cacheKey, result, TTL.ONE_DAY);
    return { payload: result, sourceUrl: url };
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function normaliseFormId(input) {
    // The API expects "I-485", "N-400", "I-130" with a hyphen and uppercase.
    return input.trim().toUpperCase().replace(/^([A-Z]+)\s*-?\s*(\d+)/, "$1-$2");
}
//# sourceMappingURL=egov.js.map