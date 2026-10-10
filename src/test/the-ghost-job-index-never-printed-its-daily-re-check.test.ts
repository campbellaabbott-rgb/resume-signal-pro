import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

/**
 * WHAT WAS WRONG, measured 2026-10-08 with a Googlebot UA (SEO report S2 and
 * the data-page items of its "fix later" list):
 *  - llms.txt sends answer engines to /ghost-job-index for the board's daily
 *    accuracy figure, and the page's crawlable body had zero hits for
 *    "accuracy": the number existed (get_audit_result: 99.1% of 114 sampled,
 *    2026-10-07) and the bake never read it;
 *  - the four data pages were generic WebPage markup with no date, and the
 *    Ghost Job Index's markup said the board measures which companies
 *    "actually fill roles", which the page itself says a feed cannot tell;
 *  - /hiring-trends, /entry-level-index and /pay-transparency printed raw
 *    field codes, so "other" read as the top field; employer rows printed the
 *    stored tenant code and linked company pages the bake never wrote.
 *
 * The builder is run here exactly as the existing data-page guard runs it:
 * sliced out of the shipped file between its markers and called.
 */

const SCRIPT = resolve(__dirname, "../../scripts/prerender-seo.mjs");
const START = "// >>> DATA-PAGE FIGURE BUILDER START";
const END = "// <<< DATA-PAGE FIGURE BUILDER END";
type Figures = { html: string; desc: string | null; read: boolean; modified?: string | null };
function build(p: unknown): Record<"ghost" | "entry" | "trends" | "pay", Figures> {
  const src = readFileSync(SCRIPT, "utf8");
  const slice = src.slice(src.indexOf(START), src.indexOf(END));
  // eslint-disable-next-line no-new-func
  return new Function(`${slice}; return dataPageFigures;`)()(p);
}
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const STATS = {
  computed_at: "2026-10-09T06:00:00+00:00",
  ghost_stats: { total_open: 1028735, total_company_names: 31000, closed_90d: 816312, observed_days: 120, median_days_open: 9, posted_coverage_pct: 99.5, computed_at: "2026-10-09T05:30:00+00:00" },
  entry_stats: { total_entry: 50000, total_open: 1028735, companies_with_entry: 4000, remote_entry: 3000, by_category: { other: 9000, engineering: 4000 } },
  entry_companies: [{ company: "Ms", company_token: "ms~wd5~external", entry_roles: 40, open_roles: 605 }],
  hiring_trends: [{ week_start: "2026-09-21", new_postings: 280000, closed: 100, closed_flagged: 0, remote_new: 1, entry_new: 1 }, { week_start: "2026-09-28", new_postings: 288808, closed: 100, closed_flagged: 0, remote_new: 1, entry_new: 1 }, { week_start: "2026-10-05", new_postings: 1000, closed: 1, remote_new: 1, entry_new: 1 }],
  trending_categories: [{ category: "other", last7: 90000, prior7: 80000 }],
};
const AUDIT = { at: "2026-10-07T04:23:21.584Z", sampled: 114, decided: 113, live: 112, gone: 1, unknown: 1, accuracyPct: 99.1 };
const TRANSPARENCY = {
  computed_at: "2026-10-09T06:10:00+00:00",
  pay: { overall: { pay_pct: 31, total: 2000000 }, categories: [{ category: "other", pay_pct: 20, total: 5000 }], top_companies: [{ company: "Ms", company_token: "ms~wd5~external", pay_pct: 90, total: 600 }] },
  coverage: { overall: { mode_pct: 40 } },
};
const ADAPTERS = {
  companyName: (token: string, stored: string) => (token === "ms~wd5~external" ? "Morgan Stanley" : stored),
  companyHref: (token: string, query?: string) => `/jobs?company=${encodeURIComponent(token)}${query ? `&${query}` : ""}`,
  fieldLabel: (slug: string) => (slug === "other" ? "Roles we could not sort into a field" : slug === "engineering" ? "Engineering & IT" : slug),
};

describe("the Ghost Job Index prints its dated daily re-check", () => {
  it("states the percentage, the decided count, the sample and the day", () => {
    const g = build({ stats: STATS, audit: AUDIT, freshness: null, transparency: null, ...ADAPTERS }).ghost;
    expect(text(g.html)).toContain("Daily re-check: 99.1% of 113 decided sample postings still live at the source (2026-10-07)");
    expect(text(g.html)).toContain("114 sampled on 2026-10-07");
  });

  it("prints no re-check at all when the audit could not be read", () => {
    const g = build({ stats: STATS, audit: null, freshness: null, transparency: null }).ghost;
    expect(text(g.html)).not.toMatch(/re-check:/i);
    expect(g.read).toBe(true);
  });

  it("carries each page's own measurement stamp for the Dataset markup", () => {
    const f = build({ stats: STATS, audit: AUDIT, freshness: null, transparency: TRANSPARENCY, ...ADAPTERS });
    expect(f.ghost.modified).toBe("2026-10-09T05:30:00.000Z");
    expect(f.entry.modified).toBe("2026-10-09T06:00:00.000Z");
    expect(f.pay.modified).toBe("2026-10-09T06:10:00.000Z");
  });
});

describe("the data-page tables print labels, names and links a reader can use", () => {
  const f = build({ stats: STATS, audit: AUDIT, freshness: null, transparency: TRANSPARENCY, ...ADAPTERS });
  it("prints the catch-all bucket as what it is, never as a field called other", () => {
    for (const k of ["entry", "trends", "pay"] as const) {
      expect(f[k].html, k).toContain("Roles we could not sort into a field");
      expect(f[k].html, k).not.toMatch(/<td class="py-1 pr-3">(?:<a [^>]*>)?other(?:<\/a>)?<\/td>/);
    }
  });

  it("names the employer by its own name and links the address the bake chose", () => {
    expect(f.entry.html).toContain(`<a href="/jobs?company=ms~wd5~external&amp;experience=entry">Morgan Stanley</a>`);
    expect(f.pay.html).toContain(`<a href="/jobs?company=ms~wd5~external">Morgan Stanley</a>`);
    expect(f.pay.html).not.toContain(">Ms<");
  });
});

describe("the data pages are Datasets, and none claims the board sees a hire", () => {
  const bake = codeOf(readFileSync(SCRIPT, "utf8"));
  it("each of the four pages is marked up through datasetLd with its own stamp", () => {
    for (const [path, key] of [["/ghost-job-index", "ghost"], ["/entry-level-index", "entry"], ["/hiring-trends", "trends"], ["/pay-transparency", "pay"]]) {
      expect(bake, path).toMatch(new RegExp(`path: "${path.replace(/[/-]/g, (c) => `\\${c}`)}",\\s*modified: DATA_FIGURES\\.${key}\\.modified,`));
    }
    expect(bake).toMatch(/"@type": "Dataset"/);
    expect(bake).toMatch(/\.\.\.\(DATA_LICENSE \? \{ license: DATA_LICENSE \} : \{\}\)/);
  });

  it("no data page's markup or copy says companies fill roles", () => {
    const blocks = ["/ghost-job-index", "/entry-level-index", "/hiring-trends", "/pay-transparency"].map((p) => {
      const at = bake.indexOf(`path: "${p}",`);
      return bake.slice(at, bake.indexOf("});", bake.indexOf("jsonLd:", at)));
    });
    for (const b of blocks) expect(b).not.toMatch(/\b(?:actually|truly) fill|roles actually filled|how fast they fill/i);
  });
});
