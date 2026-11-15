/**
 * THE SITE'S OWN LINK LISTS, ONE COPY FOR THE APP AND THE BAKE (B04, LINK-03).
 *
 * The footer the app renders (src/components/Footer.tsx) and the footer the
 * bake writes into every prerendered page (scripts/prerender-seo.mjs, its
 * shell) were two typed lists, and they drifted: on 2026-11-07 the baked
 * footer on every page linked none of /guides, the three ATS guides beside
 * Workday's, /builder, /data-api, /privacy or /terms, all of which the app's
 * footer linked. Crawlers that run no JavaScript (every AI crawler, Bing's
 * raw fetch) read only the baked one, so the guides and the citable data
 * pages were reachable for them almost only from the sitemap.
 *
 * Both footers now render these lists. Labels are main-locale keys
 * (footer.*), which the app translates and the bake reads in English; the
 * fallback is the English the key holds. Pure: no imports.
 */

export interface SiteLink {
  /** The path the link opens. */
  to: string;
  /** The main-locale key of its label. */
  key: string;
  /** The English label, for a reader whose locale has no such key. */
  fallback: string;
}

/**
 * The footer's first link, spelled out in both footers: the one footer path
 * to /explore a phone always renders (explore-claims.test.ts holds the app's).
 */
export const FOOTER_EXPLORE_LINK: SiteLink = { to: "/explore", key: "footer.explore", fallback: "Explore by field" };

/** The four pages the board publishes its own measurements on, each dated by its payload. */
export const DATA_PAGE_LINKS: readonly SiteLink[] = [
  { to: "/ghost-job-index", key: "footer.links.ghostJobIndex", fallback: "Ghost Job Index" },
  { to: "/hiring-trends", key: "footer.links.hiringTrends", fallback: "Weekly Hiring Trends" },
  { to: "/entry-level-index", key: "footer.links.entryLevelIndex", fallback: "Entry-Level Index" },
  { to: "/pay-transparency", key: "footer.links.payTransparency", fallback: "Pay Transparency Index" },
];

/** The footer's resources list: the board, the free tools, the guides, the data pages and the API. */
export const FOOTER_RESOURCES: readonly SiteLink[] = [
  { to: "/companies", key: "footer.links.companies", fallback: "Companies hiring" },
  { to: "/trust", key: "footer.links.trust", fallback: "Trust & transparency" },
  { to: "/resume-checker", key: "footer.links.resumeChecker", fallback: "Free resume checker" },
  { to: "/ats-resume-test", key: "footer.links.atsTest", fallback: "ATS resume test" },
  { to: "/resume-score", key: "footer.links.resumeScore", fallback: "Resume score" },
  { to: "/industries", key: "footer.links.industries", fallback: "Resume keywords by industry" },
  { to: "/guides", key: "footer.links.guides", fallback: "Resume & ATS guides" },
  { to: "/research/ats-score-benchmarks", key: "footer.links.atsBenchmarks", fallback: "ATS score benchmarks" },
  { to: "/ats/workday", key: "footer.links.workday", fallback: "Workday ATS guide" },
  { to: "/ats/greenhouse", key: "footer.links.greenhouse", fallback: "Greenhouse guide" },
  { to: "/ats/lever", key: "footer.links.lever", fallback: "Lever guide" },
  { to: "/ats/icims", key: "footer.links.icims", fallback: "iCIMS guide" },
  { to: "/vs/jobscan", key: "footer.links.vsJobscan", fallback: "vs Jobscan" },
  { to: "/builder", key: "footer.links.builder", fallback: "Resume Builder" },
  { to: "/methodology", key: "footer.links.methodology", fallback: "Methodology" },
  ...DATA_PAGE_LINKS,
  { to: "/data-api", key: "footer.links.dataApi", fallback: "Hiring Data & API" },
  { to: "/agents", key: "footer.links.agents", fallback: "Connect your agent" },
];

/** The footer's bottom row: the price page, the board, what is new, and the two legal pages. */
export const FOOTER_BOTTOM: readonly SiteLink[] = [
  { to: "/pricing", key: "footer.pricing", fallback: "Pricing" },
  { to: "/jobs", key: "footer.jobs", fallback: "Job board" },
  { to: "/changelog", key: "footer.changelog", fallback: "What's New" },
  { to: "/privacy", key: "footer.privacy", fallback: "Privacy Policy" },
  { to: "/terms", key: "footer.terms", fallback: "Terms of Service" },
];

/**
 * Pages the crawler's footer has carried that the app's does not: the app
 * reaches them from the header's menu or from the pages themselves, and a
 * crawler that runs no script reads no menu.
 */
export const BAKED_FOOTER_EXTRA: readonly SiteLink[] = [
  { to: "/cv-standards", key: "footer.links.cvStandards", fallback: "CV standards by country" },
  { to: "/affiliates", key: "footer.links.affiliates", fallback: "Affiliates" },
  { to: "/about", key: "footer.links.about", fallback: "About" },
];

/** Every link the app's footer renders, in its order. */
export const APP_FOOTER_LINKS: readonly SiteLink[] = [FOOTER_EXPLORE_LINK, ...FOOTER_RESOURCES, ...FOOTER_BOTTOM];

/** Every link the baked footer renders, in its order: the app's, then the crawler's extras. */
export const BAKED_FOOTER_LINKS: readonly SiteLink[] = [...APP_FOOTER_LINKS, ...BAKED_FOOTER_EXTRA];

/** The baked header's links: the app header's main ones a crawler can follow, /guides among them as the app's menu has it. */
export const BAKED_HEADER_LINKS: readonly SiteLink[] = [
  { to: "/jobs", key: "header.jobs", fallback: "Jobs" },
  { to: "/companies", key: "header.companies", fallback: "Companies" },
  { to: "/resume-checker", key: "footer.links.resumeChecker", fallback: "Free resume checker" },
  { to: "/guides", key: "header.guides", fallback: "Guides" },
  { to: "/pricing", key: "header.pricing", fallback: "Pricing" },
];

/** A link's label from a locale object (the main locale's JSON), or its English fallback. */
export function siteLinkLabel(link: SiteLink, locale: unknown): string {
  let v: unknown = locale;
  for (const part of link.key.split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[part] : undefined;
  return typeof v === "string" && v.trim() ? v : link.fallback;
}
