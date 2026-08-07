/**
 * A GREEN LIGHT OVER AN INSTRUMENT THAT HAD STOPPED READING.
 *
 * Found in the 2026-08-07 audit, as a chain of three:
 *
 *   1. get_ghost_job_index_stats() times out — 57014 at 60s, reproduced live —
 *      because the corpus passed 590k postings and the query does two
 *      count(DISTINCT) plus two percentile_cont full sorts.
 *   2. refresh_stats_cache() calls it hourly, so the cache had not updated
 *      since 2026-08-03. The public Ghost Job Index went on publishing 562,873
 *      open roles against a real 590,870 — understating its own board by
 *      28,000 — under a caption reading "right now".
 *   3. scan-heartbeat SKIPPED the two checks that would have caught it and
 *      still returned `healthy`. Its own skip reason said "the
 *      refresh-stats-cache job looks stalled" for four days.
 *
 * The third is why nobody knew, and it is the one this file guards.
 *
 * THE DESIGN BEING PRESERVED, not overridden: skips deliberately do not fail
 * the run, because an hourly job missing a tick is not an outage and crying
 * wolf is what that pass was fixing. That holds for a transient stall. It
 * breaks at 34x the bound, where "unmeasured" has become the steady state.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const hb = readFileSync(resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");
const page = readFileSync(resolve(__dirname, "../pages/GhostJobIndex.tsx"), "utf8");
const hbCode = hb.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("a permanent skip degrades the run", () => {
  it("has a threshold well past the 180-minute freshness bound", () => {
    expect(hbCode).toMatch(/SC_STALL_DEGRADE_MIN = 720/);
  });

  it("degrades when the cache is far stale OR the row is missing", () => {
    expect(hbCode).toMatch(/if \(scAgeMin === null \|\| scAgeMin > SC_STALL_DEGRADE_MIN\)/);
    expect(hbCode).toMatch(/if \(overallStatus === 'healthy'\) overallStatus = 'degraded'/);
  });

  it("says how long the checks have been blind", () => {
    // "degraded" with no cause is the next version of this bug.
    const i = hbCode.indexOf("SC_STALL_DEGRADE_MIN");
    expect(hbCode.slice(i, i + 700)).toMatch(/errorMessage = errorMessage/);
    expect(hbCode.slice(i, i + 700)).toMatch(/unevaluated/);
  });

  it("still tolerates a genuine hiccup", () => {
    // 720 minutes is four consecutive missed hourly refreshes. Below that the
    // check stays silent, which is the behaviour the original note defends.
    const m = /SC_STALL_DEGRADE_MIN = (\d+)/.exec(hbCode);
    expect(Number(m?.[1])).toBeGreaterThan(180);
  });

  it("keeps skipping the checks rather than judging stale inputs", () => {
    // Degrading is about the STATUS. The checks themselves must still not run
    // on numbers that no longer describe the board.
    expect(hbCode).toMatch(/skip\('job_board_stat_plausibility', scWhy\)/);
  });
});

describe("the public page dates its own figures", () => {
  it("carries the cache's computed_at", () => {
    expect(pageCode).toMatch(/setStatsComputedAt\(cache\?\.ghost_stats \? cachedAt : null\)/);
  });

  it("reports null when the numbers were read live, not a fake timestamp", () => {
    expect(pageCode).toMatch(/const statsStaleHours = statsComputedAt/);
  });

  it("stops claiming 'right now' once the figures are hours old", () => {
    // The caption was an unconditional claim, and for four days a false one.
    expect(pageCode).toMatch(/statsStaleHours !== null && statsStaleHours >= 3/);
    expect(pageCode).toMatch(/as of \$\{new Date\(statsComputedAt as string\)/);
  });

  it("still says 'right now' when the cache is current", () => {
    // The wording is true on a healthy hourly refresh; dating everything
    // unconditionally would trade one inaccuracy for a worse-looking product.
    expect(pageCode).toMatch(/: "verified open roles right now"/);
  });
});
