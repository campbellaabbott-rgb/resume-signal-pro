// @vitest-environment node
/**
 * A FIELD A DATA PAGE NAMES LINKS ITS LANDER (SEO audit 2026-11-18,
 * CONTENT-N2, the bake's half).
 *
 * The field landers were linked from about 20 of 1,370 pages. /hiring-trends
 * and /pay-transparency name the board's fields in their tables, a company
 * page names the fields holding most of its roles, and a posting page has a
 * field of its own, and none of them linked a lander. Each now does, in the
 * bytes a crawler reads; a field with no lander ("other") stays plain text.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as seo from "../../scripts/prerender-seo.mjs";

const SCRIPT = resolve(__dirname, "../../scripts/prerender-seo.mjs");
const src = readFileSync(SCRIPT, "utf8");
function loadBuilder(): (p: unknown) => Record<"trends" | "pay", { html: string }> {
  const a = src.indexOf("// >>> DATA-PAGE FIGURE BUILDER START");
  const b = src.indexOf("// <<< DATA-PAGE FIGURE BUILDER END");
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(a, b)}; return dataPageFigures;`)();
}
const PAYLOAD = {
  stats: {
    computed_at: "2026-11-18T09:12:00+00:00",
    stale_parts: [] as string[],
    hiring_trends: [
      { week_start: "2026-11-02", new_postings: 258336, entry_new: 8928, remote_new: 6368, closed: 451212 },
      { week_start: "2026-11-09", new_postings: 253266, entry_new: 20452, remote_new: 7807, closed: 172263 },
    ],
    trending_categories: [
      { category: "healthcare", last7: 45116, prior7: 38179 },
      { category: "other", last7: 34859, prior7: 30838 },
    ],
    entry_stats: { total_entry: 20452, total_open: 899242, companies_with_entry: 3120, remote_entry: 1406, by_category: { healthcare: 4120, other: 1900 } },
    entry_companies: [],
  },
  transparency: {
    computed_at: "2026-11-18T08:37:00+00:00",
    pay: {
      overall: { total: 899242, pay_pct: 28.5 },
      categories: [{ category: "healthcare", total: 126542, pay_pct: 38.3 }, { category: "other", total: 11658, pay_pct: 12.0 }],
      top_companies: [],
    },
    coverage: { overall: { total: 899242, pay_n: 256068, pay_pct: 28.5, mode_n: 202645, mode_pct: 22.5 }, by_source: [] },
  },
  fieldLabel: (s: string) => (s === "healthcare" ? "Healthcare & Clinical" : "Roles we could not sort into a field"),
  fieldHref: (s: string) => (s === "healthcare" ? "/jobs/field/healthcare" : null),
};

describe("the data pages' field tables", () => {
  const built = loadBuilder()(PAYLOAD) as Record<"trends" | "pay" | "entry", { html: string }>;
  it("link a field the board has a lander for, by its own name", () => {
    expect(built.trends.html).toContain('<a href="/jobs/field/healthcare">Healthcare &amp; Clinical</a>');
    expect(built.pay.html).toContain('<a href="/jobs/field/healthcare">Healthcare &amp; Clinical</a>');
  });
  it("on the entry-level page, the field links its lander and the count keeps the board's entry-level facet", () => {
    expect(built.entry.html).toContain('<a href="/jobs/field/healthcare">Healthcare &amp; Clinical</a>');
    expect(built.entry.html).toContain('<a href="/jobs?category=healthcare&amp;experience=entry">4,120</a>');
    expect(built.entry.html).not.toContain('experience=entry">Healthcare');
  });
  it("leave a field with no lander as plain text", () => {
    expect(built.pay.html).toContain("Roles we could not sort into a field");
    expect(built.pay.html).not.toMatch(/<a [^>]*>Roles we could not sort/);
  });
  it("the bake hands the builder each lander's address", () => {
    expect(src).toMatch(/fieldHref: \(slug\) => \(CATEGORY_LANDERS\.some\(\(\[s\]\) => s === slug\) \? `\/jobs\/field\/\$\{slug\}` : null\),/);
  });
});

describe("the other baked postings a posting page links", () => {
  const S = seo as unknown as { relatedPostingLinks: (self: Record<string, unknown>, live: Array<Record<string, unknown>>, most?: number) => Array<{ path: string }> };
  const P = (path: string, token: string | null, category: string | null, postedAt: string) => ({ path, title: `Role ${path}`, company: "X", token, category, postedAt });
  const live = [
    P("/p/self", "acme", "healthcare", "2026-11-20"),
    P("/p/acme-old", "acme", "finance", "2026-11-01"),
    P("/p/acme-new", "acme", "healthcare", "2026-11-19"),
    P("/p/field-a", "other", "healthcare", "2026-11-18"),
    P("/p/field-b", "third", "healthcare", "2026-11-21"),
    P("/p/elsewhere", "fourth", "legal", "2026-11-21"),
  ];
  it("are the same employer's first, then the same field's, newest first, three at most, never itself", () => {
    expect(S.relatedPostingLinks({ path: "/p/self", token: "acme", category: "healthcare" }, live).map((p) => p.path)).toEqual(["/p/acme-new", "/p/acme-old", "/p/field-b"]);
  });
  it("with no employer token, the field's alone; with neither, none", () => {
    expect(S.relatedPostingLinks({ path: "/p/x", token: null, category: "healthcare" }, live).map((p) => p.path)).toEqual(["/p/field-b", "/p/self", "/p/acme-new"]);
    expect(S.relatedPostingLinks({ path: "/p/x", token: null, category: null }, live)).toEqual([]);
  });
  it("the posting page prints them under their own heading, from the pages this bake writes as live", () => {
    expect(src).toMatch(/const liveBaked = detailed\.filter\(\(d\) => d\.page\.live\)/);
    expect(src).toMatch(/const more = relatedPostingLinks\(\{ path, token: job\.token \?\? null, category: typeof job\.category === "string" \? job\.category : null \}, liveBaked\);/);
    expect(src).toContain("<h2>Other openings with a page of their own</h2>");
  });
});

describe("a company page and a posting page", () => {
  it("a company page links the landers of the fields holding most of its roles", () => {
    const pages = readFileSync(resolve(__dirname, "../../scripts/prerender-pages.mjs"), "utf8");
    expect(pages).toMatch(/Every employer's openings in \$\{facts\.fields\.length === 1 \? "that field" : "those fields"\}: \$\{facts\.fields\.map\(\(x\) => `<a href="\/jobs\/field\/\$\{encodeURIComponent\(x\.slug\)\}">/);
  });
  it("a posting page links its field's lander", () => {
    expect(src).toMatch(/return f \? `<a href="\/jobs\/field\/\$\{f\[0\]\}">More \$\{esc\(f\[1\]\)\} jobs<\/a> · ` : "";/);
  });
});
