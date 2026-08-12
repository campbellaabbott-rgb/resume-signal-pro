/**
 * THE DATING SWEEP RE-ARMS ON INTAKE, NOT ONLY ON A CALENDAR.
 *
 * Audit of 2026-08-08. The posted-date backfill is the only thing that gives
 * BambooHR and Rippling postings a stated age — neither feed carries a date,
 * both detail endpoints do. It ran on 08-05 and worked: 41,113 rows dated at
 * 99.2%. Three days later:
 *
 *     bamboohr   44,684 total   10,473 dated   34,211 undated   (23%)
 *     rippling   12,496 total    2,375 dated   10,121 undated   (19%)
 *
 * Nothing was broken. 2,395 boards were merged into the catalog that day and
 * every posting they bootstrapped arrived undated, so the sweep's own stated
 * assumption — "after the first pass the population is one week's inflow, not
 * 43,687 rows" — stopped being true, and 44,882 postings were queued to wait
 * until 08-12 for a date they could have had in hours.
 *
 * TWO PROPERTIES, and the second is the one that keeps this safe to run:
 *
 *   Growth arms it. New undated intake above the post-sweep floor re-arms the
 *   sweep early, so a merge is followed by dating rather than by a week of
 *   undated rows.
 *
 *   The FLOOR does not. Rows that carry no vendor date, or that the feed no
 *   longer lists, stay NULL forever — the backlog never reaches zero. Comparing
 *   against the absolute number would re-run this sweep continuously against
 *   rows it has already proven it cannot date, spending vendor requests to
 *   achieve nothing. It compares against what the last completed sweep left
 *   behind.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  postedBackfillDue,
  backlogFromCoverage,
  POSTED_BACKFILL_VERSION,
  POSTED_BACKFILL_REARM_MS,
  POSTED_BACKFILL_GROWTH_REARM,
  POSTED_BACKFILL_MIN_GAP_MS,
  POSTED_BACKFILL_VENDORS,
} from "../../supabase/functions/_shared/posted-backfill";

const SRC = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
const HB = readFileSync(
  resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"),
  "utf8",
);

const { due, VERSION, REARM_MS, GROWTH, MIN_GAP } = {
  due: postedBackfillDue,
  VERSION: POSTED_BACKFILL_VERSION,
  REARM_MS: POSTED_BACKFILL_REARM_MS,
  GROWTH: POSTED_BACKFILL_GROWTH_REARM,
  MIN_GAP: POSTED_BACKFILL_MIN_GAP_MS,
};

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 3_600_000;

describe("the clock still arms it", () => {
  it("a never-run sweep is due", () => {
    expect(due({})).toBe(true);
  });

  it("a version bump is due — the only way to force a full re-date", () => {
    expect(due({ version: VERSION - 1, sweptAt: ago(HOUR) })).toBe(true);
  });

  it("past the re-arm window is due", () => {
    expect(due({ version: VERSION, sweptAt: ago(REARM_MS + HOUR) })).toBe(true);
  });

  it("a fresh sweep with no backlog signal is NOT due", () => {
    expect(due({ version: VERSION, sweptAt: ago(HOUR) })).toBe(false);
  });

  it("an unparseable stamp reads as due, the conservative direction", () => {
    expect(due({ version: VERSION, sweptAt: "not a date" })).toBe(true);
  });
});

describe("intake arms it early", () => {
  const base = { version: VERSION, backlogAtSweep: 3_000 };

  it("new undated rows above the floor re-arm before the week is up", () => {
    // The 2026-08-08 case: a merge lands, tens of thousands of undated
    // postings appear, and the sweep runs in hours instead of days.
    expect(due({ ...base, sweptAt: ago(MIN_GAP + HOUR) }, 3_000 + GROWTH)).toBe(true);
  });

  it("growth below the threshold does not", () => {
    expect(due({ ...base, sweptAt: ago(MIN_GAP + HOUR) }, 3_000 + GROWTH - 1)).toBe(false);
  });

  it("respects the minimum gap, so a busy day cannot chain sweeps", () => {
    expect(due({ ...base, sweptAt: ago(MIN_GAP - HOUR) }, 3_000 + GROWTH * 10)).toBe(false);
  });
});

describe("the irreducible floor never re-arms it", () => {
  it("a huge but UNCHANGED backlog is not due", () => {
    // The property that stops this burning vendor requests forever. 40,000
    // undated rows that the last sweep already failed to date are not a
    // reason to try them again — only rows ABOVE that are.
    expect(due({ version: VERSION, sweptAt: ago(MIN_GAP + HOUR), backlogAtSweep: 40_000 }, 40_000)).toBe(false);
  });

  it("a SHRINKING backlog is not due", () => {
    expect(due({ version: VERSION, sweptAt: ago(MIN_GAP + HOUR), backlogAtSweep: 40_000 }, 12_000)).toBe(false);
  });

  it("is inert with no recorded floor — falls back to the timer", () => {
    // Before any sweep records a baseline, an enormous backlog must not be
    // read as enormous growth.
    expect(due({ version: VERSION, sweptAt: ago(MIN_GAP + HOUR) }, 500_000)).toBe(false);
  });

  it("treats an unknown backlog as unknown, never as zero or as growth", () => {
    const v = { version: VERSION, sweptAt: ago(MIN_GAP + HOUR), backlogAtSweep: 3_000 };
    expect(due(v, null)).toBe(false);
    expect(due(v, undefined)).toBe(false);
  });
});

describe("the backlog is measured off the precomputed rollup", () => {
  const cov = [
    { source: "bamboohr", total: 44_684, dated: 10_473 },
    { source: "rippling", total: 12_496, dated: 2_375 },
    { source: "greenhouse", total: 60_906, dated: 60_356 },
    { source: "workday", total: 305_381, dated: 261_391 },
    { source: "pinpoint", total: 6_110, dated: 0 },
    { source: "ashby", total: 20_106, dated: 20_106 },
  ];

  it("sums undated rows across exactly the backfillable vendors", () => {
    // 34,211 + 10,121 + 550 — the live 2026-08-08 figures.
    expect(backlogFromCoverage(cov)).toBe(44_882);
  });

  it("excludes workday, whose phase is retired", () => {
    // Its 43,990 undated rows would be a permanent floor in the growth measure,
    // letting a vendor the sweep cannot help decide when it runs. Asserted
    // DIFFERENTIALLY — moving workday's undated count must not move the answer
    // at all, which a threshold comparison would not actually prove.
    expect(POSTED_BACKFILL_VENDORS).not.toContain("workday");
    const without = cov.filter((r) => r.source !== "workday");
    const wild = [...without, { source: "workday", total: 999_999, dated: 0 }];
    expect(backlogFromCoverage(wild)).toBe(backlogFromCoverage(without));
  });

  it("excludes pinpoint, verified to carry no date field at all", () => {
    expect(POSTED_BACKFILL_VENDORS).not.toContain("pinpoint");
  });

  it("returns null — not 0 — when nothing matched", () => {
    // A zero would read as "no backlog" and silently disable the re-arm.
    expect(backlogFromCoverage([{ source: "ashby", total: 1, dated: 1 }])).toBeNull();
    expect(backlogFromCoverage([])).toBeNull();
    expect(backlogFromCoverage(null)).toBeNull();
    expect(backlogFromCoverage("nonsense")).toBeNull();
  });

  it("skips malformed rows rather than coercing them to zero", () => {
    const only = [
      { source: "bamboohr", total: "junk", dated: 5 },
      { source: "rippling", total: 100, dated: 40 },
    ];
    expect(backlogFromCoverage(only)).toBe(60);
  });

  it("never goes negative if dated somehow exceeds total", () => {
    expect(backlogFromCoverage([{ source: "bamboohr", total: 10, dated: 99 }])).toBe(0);
  });

  it("index.ts reads the rollup and never counts nulls live", () => {
    // Counting posted_at IS NULL over ~598k rows is the shape behind two
    // separate 57014 outages on this table.
    const fn = /async function undatedBacklog\([\s\S]*?\n\}/.exec(SRC)?.[0] ?? "";
    expect(fn, "undatedBacklog not found in index.ts").not.toBe("");
    expect(fn).toMatch(/job_board_stats_rollup/);
    expect(fn).toMatch(/date_coverage/);
    expect(fn).not.toMatch(/posted_at/);
    expect(fn).toMatch(/backlogFromCoverage/);
  });

  it("records the floor when a sweep completes, or the growth check is dead", () => {
    expect(SRC).toMatch(/const backlogAtSweep = await undatedBacklog\(client\)/);
    expect(SRC).toMatch(/version: POSTED_BACKFILL_VERSION, sweptAt: new Date\(\)\.toISOString\(\)[^}]*backlogAtSweep/);
  });
});

describe("the heartbeat watches the vendors that depend on the sweep", () => {
  it("no longer exempts bamboohr and rippling outright", () => {
    // The blind spot this audit found: the date-coverage canary skipped
    // exactly the vendors whose dates come from the backfill, so bamboohr at
    // 23% and rippling at 19% raised nothing at all.
    expect(HB).toMatch(/const BACKFILL_DATED = \['bamboohr', 'rippling', 'greenhouse'\]/);
  });

  it("judges them on backlog, not on percentage", () => {
    // Percentage is the wrong test for a backfilled vendor: it sags by design
    // after a merge and says nothing about how many postings are affected.
    expect(HB).toMatch(/BACKFILL_DATED\.includes\(r\.source\)\)\s*\n\s*\.reduce\(/);
    expect(HB).toMatch(/backlog >= BACKLOG_ALARM/);
  });

  it("still judges feed-dated vendors on percentage", () => {
    expect(HB).toMatch(/\.filter\(\(r\) => !BACKFILL_DATED\.includes\(r\.source\) && !FEED_UNDATED\.includes\(r\.source\)/);
    expect(HB).toMatch(/r\.pct < 50/);
  });

  it("keeps pinpoint exempt on a verified basis, not an assumed one", () => {
    // Its postings.json was inspected on 2026-08-08: no created/published
    // field of any kind. 6,110 honestly undated rows no sweep can fix.
    expect(HB).toMatch(/const FEED_UNDATED = \['pinpoint', 'workday'\]/);
    expect(HB).toMatch(/carries\s*\n?\s*\/\/ no created\/published field/);
  });

  it("alarms above the sweep's own re-arm threshold, not below it", () => {
    // Alarming under +5,000 would fire on every normal merge, before the
    // re-arm has had any chance to act.
    const alarm = Number(/const BACKLOG_ALARM = ([0-9_]+)/.exec(HB)?.[1]?.replace(/_/g, "") ?? 0);
    expect(alarm).toBeGreaterThan(GROWTH);
  });

  it("declares a bumped BUILD_VERSION so the deploy is checkable", () => {
    // 2026-08-12.1: SC_STALL_DEGRADE_MIN 720 -> 240 after the six-hour
    // stats_cache stall this endpoint slept through (its first real one).
    // The pin moves with every scan-heartbeat change, deliberately: the
    // version is the only external tell of which bundle answered.
    expect(HB).toMatch(/const BUILD_VERSION = "2026-08-12\.\d+"/);
  });

  it("reads the ROLLUP, not the cache that was frozen when this shipped", () => {
    // The alarm went out wired to stats_cache and did not run once: measured
    // straight after deploy, stats_cache was 7,651 minutes stale (5.3 days)
    // while the rollup was current to the half-hour, so `job_board_date_
    // coverage` was absent from the response entirely. An alarm reading a
    // stopped instrument is the failure it was built to catch.
    expect(HB).toMatch(/const dateCovP = rpcWithin\(supabase\.rpc\('get_date_coverage'\), RPC_MS\)/);
    expect(HB).toMatch(/const \{ data: covLive \} = await dateCovP;/);
  });

  it("keeps stats_cache as the fallback, so a rollup outage degrades not disappears", () => {
    expect(HB).toMatch(/\(Array\.isArray\(covLive\) && covLive\.length > 0\)[\s\S]{0,160}statsCache\?\.date_coverage/);
  });

  it("watches the same source the sweep's own re-arm reads", () => {
    // The alarm and the mechanism it watches must not disagree about the
    // numbers. job-board counts the backlog off date_coverage in the rollup;
    // so does this.
    const fn = /async function undatedBacklog\([\s\S]*?\n\}/.exec(SRC)?.[0] ?? "";
    expect(fn).toMatch(/date_coverage/);
    expect(HB).toMatch(/get_date_coverage/);
  });
});
