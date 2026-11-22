// @vitest-environment node
/**
 * LLMS-FULL CARRIES THE DATA PAGES' FIGURES (SEO audit 2026-11-18, OFFSITE-9,
 * and the optional OFFSITE-12).
 *
 * llms-full.txt carried the scan benchmark's figures (n = 190, self-selected)
 * and none of the board's own, though the four data pages print theirs in
 * their meta descriptions: open roles, median posting age, closures logged in
 * 90 days, early-career openings, the share that states pay. It now carries a
 * dated "Board figures" block whose every line is the page's own description
 * value beside the moment it was measured, and llms.txt lists the board's
 * datasets first under "Original data", with the benchmark listed once.
 *
 * OFFSITE-12: the llms.txt lead line names its reading's day, so it prints the
 * exact count ("1,024,429 openings from 31,558 company job boards") rather
 * than the 7%-floored "950,000+" beside the same day's exact figure.
 *
 * The real bake runs against a stubbed network (every request not listed is
 * refused; nothing leaves the machine).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const STATS = {
  computed_at: "2026-11-17T06:00:00+00:00",
  ghost_stats: { total_open: 1024429, total_company_names: 31000, closed_90d: 1286209, observed_days: 120, median_days_open: 14, posted_coverage_pct: 99.5, computed_at: "2026-11-17T05:30:00+00:00" },
  entry_stats: { total_entry: 139290, total_open: 1024429, companies_with_entry: 4000, remote_entry: 3000, by_category: { other: 9000, engineering: 4000 } },
  entry_companies: [{ company: "Ms", company_token: "ms~wd5~external", entry_roles: 40, open_roles: 605 }],
  hiring_trends: [
    { week_start: "2026-10-27", new_postings: 280000, closed: 100, closed_flagged: 0, remote_new: 1, entry_new: 1 },
    { week_start: "2026-11-03", new_postings: 288808, closed: 100, closed_flagged: 0, remote_new: 1, entry_new: 1 },
    { week_start: "2026-11-10", new_postings: 1000, closed: 1, remote_new: 1, entry_new: 1 },
  ],
  trending_categories: [{ category: "engineering", last7: 90000, prior7: 80000 }],
};
const TRANSPARENCY = {
  computed_at: "2026-11-17T06:10:00+00:00",
  pay: { overall: { pay_pct: 33.3, total: 1045070 }, categories: [{ category: "engineering", pay_pct: 20, total: 5000 }], top_companies: [] },
  coverage: { overall: { mode_pct: 40 } },
};
const FACETS = { total: 1100000, openTotal: 1024429, companiesOpenCount: 31558, companiesFacet: [], categoriesFacet: { engineering: 100000 } };

function bake(routes: Record<string, unknown> | null): { dist: string; out: string; log: string } {
  const out = mkdtempSync(join(tmpdir(), "llms-figures-"));
  mkdirSync(join(out, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(out, "dist", "index.html"));
  let env: Record<string, string> = { PRERENDER_OUT: out, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" };
  if (routes) {
    const stub = join(out, "stub-fetch.cjs");
    writeFileSync(stub, `
const routes = ${JSON.stringify(routes)};
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /\\/rest\\/v1\\/rpc\\/([a-z_0-9]+)$/.exec(url);
  if (m && routes[m[1]]) return new Response(JSON.stringify(routes[m[1]]), { status: 200, headers: { "content-type": "application/json" } });
  throw new Error("stubbed network: " + url);
};`);
    env = { PRERENDER_OUT: out, PRERENDER_OFFLINE: "", VITE_SUPABASE_URL: "https://stub.supabase.test", VITE_SUPABASE_PUBLISHABLE_KEY: "stub-key", NODE_OPTIONS: `--require ${stub}` };
  }
  const r = spawnSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  expect(r.status, r.stderr).toBe(0);
  return { dist: join(out, "dist"), out, log: `${r.stdout}\n${r.stderr}` };
}

let READ = { dist: "", out: "", log: "" };
let FACETED = { dist: "", out: "", log: "" };
let OFFLINE = { dist: "", out: "", log: "" };
beforeAll(() => {
  READ = bake({ get_public_scan_insights: {}, get_stats_cache: STATS, get_transparency_cache: TRANSPARENCY });
  // The board's facets too (OFFSITE-12). With no employer in the stub's list,
  // this run's sitemap step refuses to shrink the committed sitemap; only its
  // llms.txt, written before that step, is read here.
  FACETED = bake({ get_public_scan_insights: {}, get_stats_cache: STATS, get_transparency_cache: TRANSPARENCY, get_job_board_facets: FACETS });
  OFFLINE = bake(null);
}, 400_000);
afterAll(() => {
  for (const d of [READ.out, FACETED.out, OFFLINE.out]) if (d && d.startsWith(tmpdir())) rmSync(d, { recursive: true, force: true });
});

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const metaDescription = (dist: string, p: string) => decode((/<meta name="description" content="([^"]*)"/.exec(readFileSync(join(dist, p, "index.html"), "utf8")) || [])[1] ?? "");
const PAGES = [
  ["Ghost Job Index", "ghost-job-index", "2026-11-17 05:30 UTC"],
  ["Weekly Hiring Trends", "hiring-trends", "2026-11-17 06:00 UTC"],
  ["Entry-Level Index", "entry-level-index", "2026-11-17 06:00 UTC"],
  ["Pay Transparency Index", "pay-transparency", "2026-11-17 06:10 UTC"],
] as const;

describe("llms-full.txt's board figures", () => {
  it("carry each data page's own description value, dated, linked to its page", () => {
    const full = readFileSync(join(READ.dist, "llms-full.txt"), "utf8");
    const block = /\n## Board figures[^\n]*\n((?:- [^\n]*\n)+)/.exec(full)?.[1] ?? "";
    expect(block, "llms-full carries a Board figures block").not.toBe("");
    for (const [name, slug, measured] of PAGES) {
      const line = block.split("\n").find((l) => l.startsWith(`- ${name} (https://resumebooster.work/${slug}),`));
      expect(line, name).toBeDefined();
      const desc = metaDescription(READ.dist, slug);
      expect(desc.length, `${slug} serves its figures in its description`).toBeGreaterThan(20);
      expect(line, name).toBe(`- ${name} (https://resumebooster.work/${slug}), measured ${measured}: ${desc}`);
    }
  });

  it("name the board's unique figures: open roles, median age, closures, early-career and pay share", () => {
    const full = readFileSync(join(READ.dist, "llms-full.txt"), "utf8");
    for (const want of ["1,024,429 open roles", "median age 14 days", "1,286,209 closure events logged in 90 days", "139,290 early-career openings", "33.3% of the 1,045,070 postings"]) expect(full).toContain(want);
  });

  it("are left out, not invented, when the bake read no figure", () => {
    const full = readFileSync(join(OFFLINE.dist, "llms-full.txt"), "utf8");
    expect(full).not.toMatch(/## Board figures/);
  });
});

describe("llms.txt", () => {
  for (const [label, read] of [
    ["the served file", () => readFileSync(join(READ.dist, "llms.txt"), "utf8")],
    ["the committed file", () => readFileSync(join(ROOT, "public/llms.txt"), "utf8")],
  ] as const) {
    it(`${label} lists the board's datasets first under Original data, and the benchmark once`, () => {
      const lt = read();
      const section = /## Original data\n\n((?:- [^\n]*\n)+)/.exec(lt)?.[1] ?? "";
      const first = section.split("\n").filter(Boolean).slice(0, 4).map((l) => (/^- \[([^\]]+)\]/.exec(l) || [])[1]);
      expect(first).toEqual(["Ghost Job Index", "Weekly Hiring Trends", "Entry-Level Index", "Pay Transparency Index"]);
      expect(lt.match(/\(https:\/\/resumebooster\.work\/research\/ats-score-benchmarks\)/g) ?? []).toHaveLength(1);
      for (const name of ["Ghost Job Index", "Weekly Hiring Trends", "Entry-Level Index", "Pay Transparency Index"]) {
        expect(lt.match(new RegExp(`^- \\[${name}\\]`, "gm")) ?? [], name).toHaveLength(1);
      }
    });
  }

  it("leads with the exact dated count from a live read, never a floor beside it (OFFSITE-12)", () => {
    const lt = readFileSync(join(FACETED.dist, "llms.txt"), "utf8");
    expect(lt).toMatch(/1,024,429 openings from 31,558 company job boards \(as of \d{4}-\d{2}-\d{2}\)/);
    expect(lt).not.toMatch(/[\d,]+\+ openings from/);
  });
});
