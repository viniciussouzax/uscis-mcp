import * as cheerio from "cheerio";
import { httpGet } from "../lib/http.js";
import { cache, TTL } from "../lib/cache.js";

const BASE_URL = "https://www.uscis.gov/policy-manual";
const TOC_URL = `${BASE_URL}/table-of-contents`;
const TOC_CACHE_KEY = "policy-manual:toc";

export const SLUG_REGEX = /^volume-(\d{1,2})(-part-([a-z])(-chapter-(\d+))?)?$/;

export interface PolicyManualChapter {
  slug: string;
  title: string;
}

export interface PolicyManualPart {
  slug: string;
  title: string;
  chapters: PolicyManualChapter[];
}

export interface PolicyManualVolume {
  slug: string;
  title: string;
  parts: PolicyManualPart[];
}

export interface PolicyManualToc {
  volumes: PolicyManualVolume[];
  total_volumes: number;
  total_parts: number;
  total_chapters: number;
}

export interface PolicyManualSection {
  id: string;
  heading: string;
  text: string;
}

export interface PolicyManualPage {
  slug: string;
  title: string;
  sections: PolicyManualSection[];
  full_text: string;
}

export async function getPolicyManualToc(): Promise<{
  payload: PolicyManualToc;
  sourceUrl: string;
}> {
  const cached = cache.get(TOC_CACHE_KEY) as PolicyManualToc | null;
  if (cached) return { payload: cached, sourceUrl: TOC_URL };

  const { body, status } = await httpGet(TOC_URL);
  if (status >= 400) {
    throw new Error(`USCIS policy manual TOC returned HTTP ${status}`);
  }

  const $ = cheerio.load(body);
  const volumes: PolicyManualVolume[] = [];

  $("div.toc-tree div.level--2").each((_, volEl) => {
    const volLink = $(volEl)
      .find("h2.level__title > a.level__item-link--2")
      .first();
    const volTitle = volLink.text().trim();
    const volHref = volLink.attr("href") ?? "";
    const volSlug = volHref.replace("/policy-manual/", "");

    if (!volTitle.toLowerCase().startsWith("volume ") || !volSlug) return;

    const parts: PolicyManualPart[] = [];

    $(volEl)
      .find("li.level__item--3")
      .each((_, partEl) => {
        const partLink = $(partEl)
          .find("> a.level__item-link--3")
          .first();
        const partTitle = partLink.text().trim();
        const partHref = partLink.attr("href") ?? "";
        const partSlug = partHref.replace("/policy-manual/", "");

        if (!partSlug || !partTitle) return;

        const chapters: PolicyManualChapter[] = [];

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

        parts.push({ slug: partSlug, title: partTitle, chapters });
      });

    volumes.push({ slug: volSlug, title: volTitle, parts });
  });

  const payload: PolicyManualToc = {
    volumes,
    total_volumes: volumes.length,
    total_parts: volumes.reduce((n, v) => n + v.parts.length, 0),
    total_chapters: volumes.reduce(
      (n, v) =>
        n + v.parts.reduce((m, p) => m + p.chapters.length, 0),
      0,
    ),
  };

  cache.set(TOC_CACHE_KEY, payload, TTL.SEVEN_DAYS);
  return { payload, sourceUrl: TOC_URL };
}

export async function getPolicyManualSection(slug: string): Promise<{
  payload: PolicyManualPage;
  sourceUrl: string;
}> {
  if (!SLUG_REGEX.test(slug)) {
    throw new Error(
      `Invalid policy manual slug "${slug}". ` +
        `Expected a slug like "volume-1", "volume-1-part-a", or "volume-1-part-a-chapter-1".`,
    );
  }

  const sourceUrl = `${BASE_URL}/${slug}`;
  const cacheKey = `policy-manual:section:${slug}`;

  const cached = cache.get(cacheKey) as PolicyManualPage | null;
  if (cached) return { payload: cached, sourceUrl };

  const { body, status } = await httpGet(sourceUrl);
  if (status === 404) {
    throw new Error(
      `Policy manual page not found: ${sourceUrl}. ` +
        `Check that the slug is correct (e.g. "volume-1-part-a-chapter-1").`,
    );
  }
  if (status >= 400) {
    throw new Error(`USCIS returned HTTP ${status} for ${sourceUrl}`);
  }

  const $ = cheerio.load(body);
  const title =
    $("h1.page-title > span").first().text().trim() || slug;

  const contentRoot = $(
    "section#book-content > div#guidance > div.tabcontent--guidance > div.field--name-body",
  );

  // Strip footnote anchor links, preserving their numeric text
  contentRoot
    .find('a.ck-anchor[href^="#footnote-"]')
    .each((_, el) => {
      $(el).replaceWith($(el).text());
    });

  const sections: PolicyManualSection[] = [];
  const fullTextParts: string[] = [];

  contentRoot.find("h2").each((_, h2El) => {
    const sectionId =
      $(h2El).find("a.ck-anchor[id]").first().attr("id") ?? "";
    const heading = $(h2El).text().trim();

    const textParts: string[] = [];
    let cursor = $(h2El).next();
    while (cursor.length && !cursor.is("h2")) {
      const t = cursor.text().replace(/\s+/g, " ").trim();
      if (t) textParts.push(t);
      cursor = cursor.next();
    }

    const text = textParts.join("\n\n").slice(0, 5000);
    sections.push({ id: sectionId, heading, text });
    fullTextParts.push(`## ${heading}\n\n${text}`);
  });

  // Fallback for pages with no h2 sections (volume/part index pages)
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

  const payload: PolicyManualPage = {
    slug,
    title,
    sections,
    full_text: fullTextParts.join("\n\n"),
  };

  cache.set(cacheKey, payload, TTL.SEVEN_DAYS);
  return { payload, sourceUrl };
}
