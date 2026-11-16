/**
 * THE DATA-PAGE BAKE FOLLOWS THE LIVE SCHEDULE AND SAYS WHAT IT CARRIED.
 *
 *   NB-32     the cadence words follow the schedule pg_cron runs (anon
 *             get_cron_health), and DATA_PAGE_CADENCE only when the build read
 *             none: the cost wave's re-timing migrations sat unapplied while
 *             the words describing them shipped.
 *   S14X-160  the ghost groups say when ghost_stats was carried, by the cache
 *             or by its own writer, and the pay page names its carried parts.
 *   S14X-194  the freshness denominator is job boards holding a live posting.
 *   SEO-F07   a re-check more than 36 hours older than the build is not
 *             called daily (live: the newest run was 2026-11-07).
 *   S14X-043  llms.txt promises the same FULL report on a rescan, and says a
 *             partial one is not kept.
 *
 * The builder is sliced out of the shipped file and run, as the guards beside
 * this one do.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const BAKE = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
type Fig = { html: string; answer?: string | null };
function build(payload: unknown): Record<"ghost" | "entry" | "trends" | "pay", Fig> {
  const a = BAKE.indexOf("// >>> DATA-PAGE FIGURE BUILDER START");
  const b = BAKE.indexOf("// <<< DATA-PAGE FIGURE BUILDER END");
  // eslint-disable-next-line no-new-func
  return new Function(`${BAKE.slice(a, b)}; return dataPageFigures;`)()(payload);
}
const text = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const GHOST = {
  total_open: 770989, total_companies: 32301, total_company_names: 31482, closed_90d: 1543884,
  observed_days: 71, median_days_open: 13.7, median_days_to_close: 12.5, posted_coverage_pct: 99.5,
  computed_at: "2026-11-15T03:05:00Z",
};
const STATS = (over: Record<string, unknown> = {}) => ({
  computed_at: "2026-11-15T03:27:00Z", stale_parts: [] as string[], ghost_stats: { ...GHOST },
  entry_stats: { total_open: 1000, total_entry: 100 }, entry_companies: [], hiring_trends: [], ...over,
});
const FRESH = { boards: 31304, p50_min: 40, p95_min: 300, computed_at: "2026-11-15T04:15:00Z" };
const AUDIT = { at: "2026-11-07T04:23:33.811Z", accuracyPct: 96.6, sampled: 120, decided: 117, live: 113 };
const NOW = Date.parse("2026-11-15T18:00:00Z");

describe("the cadence words (NB-32)", () => {
  it("follow the live schedule when the build read one", () => {
    const g = build({ stats: STATS(), freshness: FRESH, cron: [
      { ch_jobname: "refresh-ghost-stats", ch_schedule: "*/20 * * * *", ch_active: true },
      { ch_jobname: "job-board-stats-rollup", ch_schedule: "*/15 * * * *", ch_active: true },
    ] }).ghost;
    expect(text(g.html)).toContain("recomputed every 20 minutes");
    expect(text(g.html)).toContain("recomputed every 15 minutes");
    expect(text(g.html)).not.toContain("recomputed every 30 minutes");
  });
  it("keep the constant when the build read none, when a job is inactive, or for a schedule they cannot say", () => {
    for (const cron of [undefined, null, [{ ch_jobname: "job-board-stats-rollup", ch_schedule: "*/15 * * * *", ch_active: false }],
                        [{ ch_jobname: "job-board-stats-rollup", ch_schedule: "15 4 * * *", ch_active: true }]]) {
      const g = build({ stats: STATS(), freshness: FRESH, cron }).ghost;
      expect(text(g.html), JSON.stringify(cron)).toContain("recomputed every 30 minutes");
    }
  });
});

describe("the ghost groups say when ghost_stats was carried (S14X-160)", () => {
  it("by the cache", () => {
    const g = build({ stats: STATS({ stale_parts: ["ghost_stats"] }) }).ghost;
    expect(text(g.html)).toContain("Carried forward: the latest recomputation could not finish these figures, so they are from an earlier run, no newer than 2026-11-15 03:05 UTC.");
  });
  it("by its own writer, naming the pieces", () => {
    const g = build({ stats: STATS({ ghost_stats: { ...GHOST, stale_parts: ["closures"] } }) }).ghost;
    expect(text(g.html)).toContain("could not finish the closure figures, so those are from an earlier run");
  });
  it("and says nothing when nothing was carried", () => {
    expect(text(build({ stats: STATS() }).ghost.html)).not.toContain("Carried forward");
  });
  it("the pay page names its carried part", () => {
    const pay = build({ transparency: { computed_at: "2026-11-15T03:00:00Z", stale_parts: ["coverage"], pay: { overall: { pay_pct: 31, total: 2000000 }, categories: [], top_companies: [] }, coverage: { overall: { mode_pct: 40 } } } }).pay;
    expect(text(pay.html)).toContain("these carry the previous run's value: coverage");
  });
});

describe("the freshness denominator (S14X-194)", () => {
  it("is job boards holding a live posting, dated by the rollup", () => {
    const t = text(build({ freshness: FRESH }).ghost.html);
    expect(t).toContain("31,304 — job boards we read that hold a live posting");
    expect(t).toContain("2026-11-15 04:15 UTC");
    expect(t).not.toContain("company feeds in the rotation");
  });
});

describe("the re-check's age (SEO-F07)", () => {
  it("names the age of a run more than 36 hours older than the build and does not call it daily", () => {
    const g = build({ stats: STATS(), audit: AUDIT, now: NOW }).ghost;
    expect(text(g.html)).toContain("The re-check is scheduled once a day, but this is the latest run on record, 8 days older than this page's build.");
    expect(text(g.html)).not.toContain("Run once a day; the live page shows the latest run.");
    expect(g.answer).toContain("In the latest re-check on record, 2026-11-07,");
  });
  it("keeps the daily wording for a run inside 36 hours, and with no build clock (the control)", () => {
    for (const now of [Date.parse("2026-11-08T04:00:00Z"), undefined]) {
      const g = build({ stats: STATS(), audit: AUDIT, now }).ghost;
      expect(text(g.html)).toContain("Run once a day; the live page shows the latest run.");
      expect(g.answer).toContain("In the daily re-check on 2026-11-07,");
    }
  });
  it("the llms.txt rewrite names the run's date past 36 hours", () => {
    const at = BAKE.indexOf("THE RE-CHECK'S AGE (SEO-F07): the file says");
    const block = BAKE.slice(at, BAKE.indexOf("\n      }\n", at));
    expect(block).toContain("> 36");
    const re = /sub\(\/(.+)\/, /.exec(block)![1];
    expect(new RegExp(re).test(readFileSync(resolve(ROOT, "public/llms.txt"), "utf8")), "the pattern no longer matches llms.txt").toBe(true);
  });
});

describe("llms.txt's rescan promise (S14X-043)", () => {
  it("names a full report and says a partial one is not kept", () => {
    const llms = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");
    expect(llms).toContain("A rescan of the same file against the same job posting within 7 days returns the same full report under the same report ID; a partial report is not kept, so a rescan after one runs again.");
  });
});
