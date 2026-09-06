import * as cheerio from "cheerio";
import { httpGet } from "../lib/http.js";
import { cache, TTL } from "../lib/cache.js";
const BASE_URL = "https://www.uscis.gov/policy-manual";
const TOC_URL = `${BASE_URL}/table-of-contents`;
const TOC_CACHE_KEY = "policy-manual:toc";
export const SLUG_REGEX = /^volume-(\d{1,2})(-part-([a-z])(-chapter-(\d+))?)?$/;
export async function getPolicyManualToc() {
    const cached = cache.get(TOC_CACHE_KEY);
    if (cached)
        return { payload: cached, sourceUrl: TOC_URL };
    const { body, status } = await httpGet(TOC_URL);
    if (status >= 400) {
        throw new Error(`USCIS policy manual TOC returned HTTP ${status}`);
    }
    const $ = cheerio.load(body);
    const volumes = [];
    // ul.level--3 (parts) are siblings of div.level--2 (volumes) inside
    // div.toc-tree, not children — iterate direct children in order.
    let currentVolume = null;
    $("div.toc-tree").children().each((_, el) => {
        const $el = $(el);
        if ($el.hasClass("level--2")) {
            if (currentVolume)
                volumes.push(currentVolume);
            currentVolume = null;
            // USCIS has flipped the title wrapper between <h2> and <div> before —
            // match on the classes only.
            const volLink = $el.find(".level__title > a.level__item-link--2").first();
            const volTitle = volLink.text().trim();
            const volHref = volLink.attr("href") ?? "";
            const volSlug = volHref.replace("/policy-manual/", "");
            if (!volTitle.toLowerCase().startsWith("volume ") || !volSlug)
                return;
            currentVolume = { slug: volSlug, title: volTitle, parts: [] };
            return;
        }
        if ($el.hasClass("level--3") && currentVolume) {
            $el.find("li.level__item--3").each((_, partEl) => {
                const partLink = $(partEl).find("> a.level__item-link--3").first();
                const partTitle = partLink.text().trim();
                const partHref = partLink.attr("href") ?? "";
                const partSlug = partHref.replace("/policy-manual/", "");
                if (!partSlug || !partTitle)
                    return;
                const chapters = [];
                $(partEl)
                    .find("ul.level--4 > li.level__item--4 > a.level__item-link--4")
                    .each((_, chapEl) => {
                    const chapTitle = $(chapEl).text().trim();
                    const chapHref = $(chapEl).attr("href") ?? "";
                    const chapSlug = chapHref.replace("/policy-manual/", "");
                    if (chapSlug && chapTitle) {
                        chapters.push({ slug: chapSlug, title: chapTitle });
                    }
                });
                currentVolume.parts.push({ slug: partSlug, title: partTitle, chapters });
            });
        }
    });
    if (currentVolume)
        volumes.push(currentVolume);
    const payload = {
        volumes,
        total_volumes: volumes.length,
        total_parts: volumes.reduce((n, v) => n + v.parts.length, 0),
        total_chapters: volumes.reduce((n, v) => n + v.parts.reduce((m, p) => m + p.chapters.length, 0), 0),
    };
    cache.set(TOC_CACHE_KEY, payload, TTL.SEVEN_DAYS);
    return { payload, sourceUrl: TOC_URL };
}
export async function getPolicyManualSection(slug) {
    if (!SLUG_REGEX.test(slug)) {
        throw new Error(`Invalid policy manual slug "${slug}". ` +
            `Expected a slug like "volume-1", "volume-1-part-a", or "volume-1-part-a-chapter-1".`);
    }
    const sourceUrl = `${BASE_URL}/${slug}`;
    const cacheKey = `policy-manual:section:${slug}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return { payload: cached, sourceUrl };
    const { body, status } = await httpGet(sourceUrl);
    if (status === 404) {
        throw new Error(`Policy manual page not found: ${sourceUrl}. ` +
            `Check that the slug is correct (e.g. "volume-1-part-a-chapter-1").`);
    }
    if (status >= 400) {
        throw new Error(`USCIS returned HTTP ${status} for ${sourceUrl}`);
    }
    const $ = cheerio.load(body);
    const title = $("h1.page-title > span").first().text().trim() || slug;
    // div#guidance is itself the tabcontent div; the field is its direct child.
    const contentRoot = $("div#guidance > .field--name-body");
    // Strip footnote anchor links, preserving their numeric text
    contentRoot
        .find('a.ck-anchor[href^="#footnote-"]')
        .each((_, el) => {
        $(el).replaceWith($(el).text());
    });
    const sections = [];
    const fullTextParts = [];
    // Everything before the first h2 belongs to the chapter too. Walking only
    // h2-and-after silently drops it — and on many chapters that is the whole
    // body. 6 USCIS-PM E.2, for instance, holds its intro, its EB-1/EB-2/EB-3
    // list and its eligibility table before the single h2 on the page, which is
    // "Footnotes"; without this the chapter comes back as footnotes alone.
    const firstH2 = contentRoot.find("h2").first();
    if (firstH2.length) {
        const preamble = textBefore($, contentRoot, firstH2);
        if (preamble) {
            const text = preamble.slice(0, 5000);
            sections.push({ id: "", heading: "Introduction", text });
            fullTextParts.push(`## Introduction\n\n${text}`);
        }
    }
    contentRoot.find("h2").each((_, h2El) => {
        const sectionId = $(h2El).find("a.ck-anchor[id]").first().attr("id") ?? "";
        const heading = $(h2El).text().trim();
        const textParts = [];
        let cursor = $(h2El).next();
        while (cursor.length && !cursor.is("h2")) {
            const t = cursor.text().replace(/\s+/g, " ").trim();
            if (t)
                textParts.push(t);
            cursor = cursor.next();
        }
        const text = textParts.join("\n\n").slice(0, 5000);
        sections.push({ id: sectionId, heading, text });
        fullTextParts.push(`## ${heading}\n\n${text}`);
    });
    // Fallback for pages with no h2 at all (volume/part index pages). Note this
    // never fired for the case above: a chapter whose only h2 is "Footnotes"
    // still counts as one section, so the count was never zero.
    if (sections.length === 0) {
        const fallback = contentRoot
            .text()
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 5000);
        if (fallback) {
            sections.push({ id: "", heading: title, text: fallback });
            fullTextParts.push(fallback);
        }
    }
    const payload = {
        slug,
        title,
        sections,
        full_text: fullTextParts.join("\n\n"),
    };
    cache.set(cacheKey, payload, TTL.SEVEN_DAYS);
    return { payload, sourceUrl };
}
/**
 * Text of everything that precedes `stop` inside `root`, in document order.
 *
 * Climbs from `stop` up to `root`, taking each level's earlier siblings, so it
 * works whether the heading sits directly under the content root or nested in
 * a wrapper.
 */
function textBefore($, root, stop) {
    const parts = [];
    let node = stop;
    while (node.length && !node.is(root)) {
        const level = node
            .prevAll()
            .toArray()
            .reverse()
            .map((el) => $(el).text().replace(/\s+/g, " ").trim())
            .filter(Boolean);
        parts.unshift(...level);
        node = node.parent();
    }
    return parts.join("\n\n").trim();
}
//# sourceMappingURL=policy-manual.js.map