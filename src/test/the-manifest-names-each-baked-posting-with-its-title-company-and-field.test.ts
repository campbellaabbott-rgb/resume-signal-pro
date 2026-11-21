// @vitest-environment node
/**
 * THE MANIFEST NAMES EACH BAKED POSTING WITH ITS TITLE, COMPANY AND FIELD
 * (SEO audit 2026-11-18, CRAWL18B-4).
 *
 * The rendered hubs (the homepage, /jobs, the field and company pages) dropped
 * every link to the 497 baked posting pages: /posting-pages.json listed their
 * paths only, so a hub could not say which page was which. It now carries one
 * row per live page with the title and company the page prints and its board
 * field, the same paths as the sitemap and in its order.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as seo from "../../scripts/prerender-seo.mjs";

const S = seo as unknown as {
  postingPagesManifest: (entries: unknown[], o: Record<string, unknown>) => { at: string; live: string[]; rows?: Array<Record<string, unknown>> };
};
const ENTRIES = [
  { path: "/jobs/posting/greenhouse/acme/1" },
  { path: "/industries/healthcare" },
  { path: "/jobs/posting/workday/insulet~wd5~insuletcareers/REQ-1.5" },
];
const ABOUT: Record<string, { title: string; company: string; field: string | null }> = {
  "/jobs/posting/greenhouse/acme/1": { title: "Registered Nurse", company: "Acme Health", field: "healthcare" },
  "/jobs/posting/workday/insulet~wd5~insuletcareers/REQ-1.5": { title: "Supplier Engineer", company: "Insulet", field: null },
};
const isPosting = (e: { path: string }) => e.path.startsWith("/jobs/posting/");
const href = (p: string) => (/\.[^/]*$/.test(p) ? `${p}/` : p);

describe("/posting-pages.json", () => {
  const m = S.postingPagesManifest(ENTRIES, { today: "2026-11-21", isPosting, href, about: (p: string) => ABOUT[p] ?? null });

  it("has a row for each live posting page, the sitemap's paths in its order", () => {
    expect(m.rows?.map((r) => r.path)).toEqual(m.live);
    expect(m.live).toEqual(["/jobs/posting/greenhouse/acme/1", "/jobs/posting/workday/insulet~wd5~insuletcareers/REQ-1.5/"]);
  });

  it("each row names the title and company the page prints, and its field or null", () => {
    expect(m.rows).toEqual([
      { path: "/jobs/posting/greenhouse/acme/1", title: "Registered Nurse", company: "Acme Health", field: "healthcare" },
      { path: "/jobs/posting/workday/insulet~wd5~insuletcareers/REQ-1.5/", title: "Supplier Engineer", company: "Insulet", field: null },
    ]);
  });

  it("a page the bake knows nothing about keeps its path and a null field", () => {
    const bare = S.postingPagesManifest(ENTRIES, { today: "2026-11-21", isPosting, href });
    expect(bare.rows?.[0]).toEqual({ path: "/jobs/posting/greenhouse/acme/1", field: null });
  });

  it("the bake hands it each page's title, company and lander field, the ledger's for a carried page", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/postingAbout\.set\(p\.path, \{ title: p\.title, company: p\.company, field: p\.category && CATEGORY_LANDERS\.some/);
    expect(src).toMatch(/about: \(path\) => postingAbout\.get\(path\) \?\? \(postingLedger\[path\] \? \{ title: postingLedger\[path\]\.title, company: postingLedger\[path\]\.company, field: null \} : null\)/);
  });
});
