// @vitest-environment node
/**
 * A DATA PAGE RANKS NO EMPLOYER BY A SYSTEM CODE (SEO audit 2026-11-18,
 * GEO-11).
 *
 * The leaderboards on /entry-level-index and /pay-transparency printed
 * "Shusa", "Bne" and "Lapoflove": the codes the boards' hiring systems give
 * them, title-cased, ranked as if they were employers' names. A row whose
 * printed name is still its board's code, by the rule a new posting page is
 * already refused by (isUnreviewedTenantName, with its allowlist of real
 * one-word names and the names stream's overrides), now stays out of the
 * ranking until it is named, and the bake lists each one at the WARN tier.
 *
 * Runs the shipped builder, sliced from the bake between its markers, as
 * a-data-page-that-serves-no-number-is-an-empty-page does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { employerName, isUnreviewedTenantName } from "@/lib/company-display";

const SCRIPT = resolve(__dirname, "../../scripts/prerender-seo.mjs");
type Page = { html: string };
function loadBuilder(): (p: unknown) => Record<"entry" | "pay", Page> {
  const src = readFileSync(SCRIPT, "utf8");
  const a = src.indexOf("// >>> DATA-PAGE FIGURE BUILDER START");
  const b = src.indexOf("// <<< DATA-PAGE FIGURE BUILDER END");
  expect(b).toBeGreaterThan(a);
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(a, b)}; return dataPageFigures;`)();
}

const PAYLOAD = {
  stats: {
    computed_at: "2026-11-18T09:12:00+00:00",
    stale_parts: [] as string[],
    entry_stats: { total_entry: 114091, total_open: 770898, companies_with_entry: 13869, remote_entry: 4451, by_category: { operations: 21306 } },
    entry_companies: [
      { company: "Republic Finance, LLC", company_token: "jobs.republicfinance.com", entry_roles: 219, open_roles: 219 },
      { company: "Shusa", company_token: "shusa", entry_roles: 150, open_roles: 160 },
      { company: "Agape Care Group", company_token: "agapecare", entry_roles: 115, open_roles: 128 },
    ],
  },
  transparency: {
    computed_at: "2026-11-18T08:37:00+00:00",
    pay: {
      overall: { total: 899242, pay_pct: 28.5 },
      categories: [{ category: "healthcare", total: 126542, pay_pct: 38.3 }],
      top_companies: [
        { company: "CarMax", company_token: "carmax~wd1~External", total: 266, pay_pct: 100.0 },
        { company: "Lapoflove", company_token: "lapoflove", total: 240, pay_pct: 100.0 },
      ],
    },
    coverage: { overall: { total: 899242, pay_n: 256068, pay_pct: 28.5, mode_n: 202645, mode_pct: 22.5 }, by_source: [] },
  },
};
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("the leaderboards", () => {
  const seen: string[] = [];
  const built = loadBuilder()({
    ...PAYLOAD,
    companyName: (t: string, n: string) => employerName(t, n),
    codeNamed: (t: string, n: string) => isUnreviewedTenantName(t, n),
    codeNamedSeen: seen,
  });

  it("rank the named employers and leave out a row printed under its board's code", () => {
    expect(text(built.entry.html)).toContain("Republic Finance");
    expect(text(built.entry.html)).toContain("Agape Care Group");
    expect(text(built.entry.html)).not.toMatch(/\bShusa\b/);
    expect(text(built.pay.html)).toContain("CarMax");
    expect(text(built.pay.html)).not.toMatch(/\bLapoflove\b/);
  });

  it("hand the bake each row they left out, with its page and its code", () => {
    expect(seen).toEqual(["/entry-level-index: Shusa (shusa)", "/pay-transparency: Lapoflove (lapoflove)"]);
  });

  it("rank every row as before when the bake gives no rule", () => {
    const plain = loadBuilder()(PAYLOAD);
    expect(text(plain.entry.html)).toMatch(/\bShusa\b/);
  });
});

describe("the bake", () => {
  it("gives the builder the posting pages' rule and warns with the rows it left out", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toMatch(/codeNamed: \(token, printed\) => D\.isUnreviewedTenantName\(token, printed\),\s*codeNamedSeen: CODE_NAMED_ROWS,/);
    expect(src).toMatch(/if \(CODE_NAMED_ROWS\.length\) console\.warn\(`\[prerender-seo\] WARN /);
  });
});
