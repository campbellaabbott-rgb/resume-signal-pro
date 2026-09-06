import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * A MEDIAN DRAWN FROM A WINDOW THAT CANNOT HOLD ONE.
 *
 * WHAT BROKE. Until 2026-09-06 every speed claim on this product came from
 * `get_company_hiring_health.median_days_to_close` and, beside it,
 * `get_category_fill_speed.median_days_open`. Measured live on 2026-09-06 over
 * ~600k logged closures, all eighteen categories reported a median between
 * 14.9 and 16.3 days: healthcare 14.9, finance 15.2, design 15.2, legal 15.8,
 * engineering 16.2, sales 16.3. Nursing, securities law, retail and ML research
 * agreeing to within 1.4 days is not a labour market. At those sample sizes the
 * standard error on each median is well under a day, so it is not noise either.
 *
 * HOW IT WAS FOUND, AND WHY THE OBVIOUS FIX IS NOT THE FIX. The obvious reading
 * is "the medians are wrong, recompute them". They were not wrong; they were
 * arithmetically correct over a window that could not contain the answer. The
 * observable support was [7, 30] days BY CONSTRUCTION:
 *
 *   • the ingest ages a posting out at FRESH_WINDOW_DAYS = 30, so no posting can
 *     ever be OBSERVED to close later than ~30 days after its stated date; and
 *   • every fill surface then required
 *     `closed_at - COALESCE(posted_at, first_seen) >= interval '7 days'`,
 *     which deleted the entire left tail.
 *
 * A midpoint drawn from [7, 30] lands near 15 whatever employers do. We were
 * publishing half of our own retention cap and calling it time-to-fill. Fixing
 * the estimator alone would not have fixed that: the roles that never closed
 * were ABSENT from the sample rather than censored in it, which turns censoring
 * into truncation and biases the centre downward without widening any interval
 * to warn anyone. The repair is a cumulative-incidence curve over a risk set
 * that includes age-outs and live roles, with re-listings held out as a
 * competing event — and a rule that the median is simply NOT PUBLISHED when the
 * record does not reach it.
 *
 * A second, independent defect rode along and is pinned here too. The count
 * printed beside the median came from a LARGER population than the median: the
 * count used the coalesced origin, the median required a stated `posted_at`.
 * Live proof, same day: `get_company_hiring_health('gici~wd5~Careers')` returned
 * `closed_90d: 41` next to `median_days_to_close: null` — forty-one closures and
 * no median, rendered side by side as one fact.
 *
 * WHAT THIS GUARD STATES. Not "the SQL was rewritten" — the estimator has its
 * own migration comments for that. These are the honesty rules AT THE SURFACE,
 * where a reader actually meets the number, stated for the CLASS rather than for
 * one file:
 *
 *   1. no published duration is measured from our own discovery time, and the
 *      one surviving per-row exception is worded as the floor it is;
 *   2. the seven-day floor is gone from every function the database runs;
 *   3. no median number is rendered when `median_censored` is true;
 *   4. every relist/churn quantity is rendered as a floor, because the
 *      collector logs at most one re-listed title per employer per 24h;
 *   5. a statistic and its sample-size gate are computed over the same
 *      population — the `closed_90d 41 / median null` shape cannot return;
 *   6. the three `dated_coverage` bands exist in the render path.
 *
 * COMMENT-STRIPPED FOR CODE, RAW FOR PROSE. This repo has shipped a guard that
 * passed on a spelling appearing only in a COMMENT while the code beneath it was
 * dead SEVEN times. Every assertion below picks its constant deliberately:
 * `CODE` where the claim is about what executes, `RAW` where the claim is about
 * what a maintainer is told. The same trap has a SQL form, and it bit while this
 * guard was being written: matching `interval '7 days'` across a whole migration
 * FILE flags four innocent functions, because a migration file routinely defines
 * several functions and the floor belonged to a neighbour that has since been
 * re-issued. Every SQL assertion here therefore runs against one extracted
 * FUNCTION BODY at a time, and only against the LAST definition of that function
 * — redefinition-by-later-migration is this repo's norm, and a guard pinned to
 * an older definition asserts against dead text.
 */

const ROOT = resolve(__dirname, "../..");

/** Strip TS/TSX comments. Block comments first, then whole-line `//`. Deliberately
 *  NOT trailing-`//` stripping: that eats `https://` inside string literals and
 *  has silently deleted real code from a guard's view before. */
const stripTs = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Strip SQL comments: `--` to end of line, and `/* *\/` blocks. */
const stripSql = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(ROOT, dir))) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const rel = join(dir, entry);
    if (statSync(resolve(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

/** Every TypeScript file that can put a number on a screen or in an API payload.
 *  Tests are excluded: a guard quoting the pre-fix spelling in order to prove it
 *  has teeth must not be read as a violation of the rule it is guarding. */
const SOURCE_FILES = [...walk("src"), ...walk("supabase/functions")].filter(
  (p) => !p.startsWith(join("src", "test")),
);

/**
 * The LAST definition of every Postgres function, as an isolated body.
 *
 * Two things are load-bearing. `.sort()` is apply order because migration
 * filenames are timestamp-prefixed, so the last definition wins — that is what
 * the database runs. And the body is cut from the `CREATE OR REPLACE` to the
 * closing `$$`, so an assertion about function X can never be satisfied or
 * broken by function Y sharing its file.
 */
function liveFunctions(): Map<string, { file: string; raw: string; code: string }> {
  const dir = "supabase/migrations";
  const out = new Map<string, { file: string; raw: string; code: string }>();
  for (const file of readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith(".sql")).sort()) {
    const raw = read(join(dir, file));
    for (const m of raw.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)) {
      const open = raw.indexOf("$$", m.index!);
      if (open < 0) continue;
      const close = raw.indexOf("$$", open + 2);
      if (close < 0) continue;
      const body = raw.slice(m.index!, close + 2);
      out.set(m[1], { file, raw: body, code: stripSql(body) });
    }
  }
  return out;
}

const LIVE = liveFunctions();

// ── The spellings this whole change exists to delete ─────────────────────────

/** The seven-day floor: a closure had to have stood a week to be counted. */
const SEVEN_DAY_FLOOR = /(closed_at|exited_at)\s*-\s*[^\n]*?>=\s*interval\s*'7 days'/i;

/** The coalesced origin, SQL spelling. Legal as a FILTER (an undated row still
 *  has to age off the board somehow); a falsehood as a published duration. */
const COALESCED_ORIGIN_SQL = /COALESCE\(\s*[\w.]*posted_at\s*,\s*[\w.]*first_seen\s*\)/gi;

/** The coalesced origin, TypeScript spelling. Case-SENSITIVE on `posted_at`, so
 *  a `postedAt ?? null, first_seen: null` field list is not mistaken for one. */
const COALESCED_ORIGIN_TS = /[\w.]*posted_at\s*\?\?\s*[\w.\s()<>,'"]*?first_seen/g;

/** Is this window an arithmetic duration rather than a predicate? */
const IS_DURATION = /86400|8_640_000|EXTRACT\s*\(\s*epoch|closed_at\s*-|exited_at\s*-|now\(\)\s*-|Date\.parse/i;
const IS_AGGREGATE = /percentile_cont|percentile_disc|\bavg\s*\(|\bsum\s*\(/i;

/** A quantity that is only ever a lower bound must SAY so. `+×` and `×+` are the
 *  compact badge forms of the same qualifier. */
const FLOOR_MARKER = /at least|≥|×\+|\+×/;

describe("a median drawn from a window that cannot hold one — no published duration is measured from our discovery time", () => {
  it("no live function aggregates a duration from a coalesced origin", () => {
    // The headline medians were exactly this: percentile_cont over
    // closed_at − COALESCE(posted_at, first_seen). A role that stood on the
    // employer's site for sixty days before our crawler found it read as
    // newborn, which is the 2.8-day-median incident with a bigger denominator.
    // Stated for the class over all 195 live function bodies rather than for
    // the handful this change touched, because the substitution has been
    // reintroduced twice by files nobody was looking at.
    const offenders: string[] = [];
    for (const [name, { file, code }] of LIVE) {
      for (const m of code.matchAll(COALESCED_ORIGIN_SQL)) {
        const window = code.slice(Math.max(0, m.index! - 260), m.index! + 260);
        if (IS_DURATION.test(window) && IS_AGGREGATE.test(window)) offenders.push(`${name} (${file})`);
      }
    }
    expect([...new Set(offenders)], "our discovery date must not reach a published median or average").toEqual([]);
  });

  it("the one surviving per-row coalesced duration is published as the floor it is", () => {
    // get_application_lifecycle.days_standing still uses the coalesced origin,
    // and that is allowed ONLY because first_seen can never precede the true
    // post date — so the number is always a LOWER BOUND on true tenure and never
    // an overstatement. The rule is therefore not "delete it" but "word it as a
    // floor", and the guard holds both halves: the set is exactly one function,
    // and its render says "at least".
    const perRow = new Set<string>();
    for (const [name, { code }] of LIVE) {
      for (const m of code.matchAll(COALESCED_ORIGIN_SQL)) {
        const window = code.slice(Math.max(0, m.index! - 260), m.index! + 260);
        if (IS_DURATION.test(window)) perRow.add(name);
      }
    }
    expect([...perRow], "a new coalesced duration needs a decision, not a default").toEqual([
      "get_application_lifecycle",
    ]);

    const account = stripTs(read("src/pages/Account.tsx"));
    expect(account, "days_standing must reach the reader with its floor wording attached")
      .toMatch(/lifecycleStood[\s\S]{0,80}at least \{\{d\}\} days posted/);
  });

  it("in src/ and the edge functions a coalesced origin only filters or fills days_on_board", () => {
    // Class-wide over every non-test TS file. Two roles are legitimate: the
    // freshness cutoff (an undated posting still has to age out of the board
    // somehow) and the exit ledger's legacy days_on_board column. Anything else
    // is a duration built on our crawler's clock.
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = stripTs(read(file));
      for (const m of code.matchAll(COALESCED_ORIGIN_TS)) {
        const window = code.slice(Math.max(0, m.index! - 200), m.index! + m[0].length + 200);
        if (!/days_on_board/.test(window) && !/[Cc]utoff/.test(window)) {
          offenders.push(`${file}: ${m[0].replace(/\s+/g, " ").slice(0, 80)}`);
        }
      }
    }
    expect(offenders, "a coalesced origin may decide whether a row is served, never what a duration is").toEqual([]);
  });

  it("no estimator reads days_on_board, the one coalesced duration the collector still writes", () => {
    // This is what keeps the exception above from leaking. days_on_board is
    // written from COALESCE(posted_at, first_seen) at three of the collector's
    // four exit write sites — including the freshness sweep, which is the main
    // producer of age-outs — so censoring at it would put our discovery time
    // into the estimator on the MAJORITY of censored rows. That is the same
    // basis bug in the one place it could never surface as a published number:
    // it would only shift censored times. The censored arm uses
    // job_board_exits.posted_at instead.
    const readers = [...LIVE].filter(([, { code }]) => /days_on_board/i.test(code)).map(([n]) => n);
    expect(readers, "the censored arm's origin is exits.posted_at, never days_on_board").toEqual([]);

    const curve = LIVE.get("get_company_fill_curve");
    expect(curve, "get_company_fill_curve must exist to be asserted against").toBeTruthy();
    expect(curve!.code, "the censored arm reads the employer's own date").toMatch(/exited_at[\s\S]{0,120}posted_at/);
  });
});

describe("a median drawn from a window that cannot hold one — the seven-day floor is gone from every function the database runs", () => {
  it("no live function body still requires a closure to have stood a week", () => {
    // The floor was added to suppress relist churn. Two other mechanisms already
    // do that job properly — the `superseded` flag names a relist directly, and
    // the feed-dark batch guard names a collection failure directly — so what
    // this rule actually removed was the entire left tail: the fast fills, which
    // are the single most useful thing a reader could learn from the data.
    //
    // Body-scoped, and that is the point. A whole-FILE match reports
    // get_country_facet, get_size_segments, get_application_lifecycle and
    // get_company_suggest as offenders; all four are innocent, and the floors in
    // their files belong to get_company_hiring_health, get_actively_hiring_
    // companies and get_employer_benchmarks, which share those files and have
    // since been re-issued. Four false accusations is how a guard gets narrowed
    // until it no longer says anything.
    const offenders = [...LIVE]
      .filter(([, { code }]) => SEVEN_DAY_FLOOR.test(code))
      .map(([name, { file }]) => `${name} (${file})`);
    expect(offenders, "the floor deletes exactly the fast fills").toEqual([]);
  });

  it("the re-issued functions are the ones the database actually runs", () => {
    // Without this the test above is satisfiable by a migration that never
    // landed: if an OLDER definition were last, the clean bodies asserted above
    // would be dead text. Pins which file each name resolves to.
    const FLOOR_FIX = "20260906093000_the_seven_day_floor_deleted_the_fast_fills.sql";
    for (const name of [
      "get_company_hiring_health",
      "get_actively_hiring_companies",
      "get_category_fill_speed",
      "get_employer_benchmarks",
      "roll_up_and_prune_closures",
    ]) {
      expect(LIVE.get(name)?.file, `${name} must resolve to the floor-removal migration`).toBe(FLOOR_FIX);
    }
    expect(LIVE.get("get_company_fill_curve")?.file).toBe("20260906091000_censoring_is_not_truncation.sql");
    expect(LIVE.get("get_category_fill_curve")?.file).toBe(
      "20260906092000_a_median_from_a_window_that_cannot_hold_one.sql",
    );
  });

  it("no live copy still describes the floor as a feature", () => {
    // The floor also existed as a SENTENCE: /explore promised "roles that stayed
    // posted at least a week and then came down — a real fill signal". Deleting
    // the predicate and leaving the sentence is how copy goes false when the
    // thing it describes moves. Asserted against RAW, because this is a claim
    // made to a reader rather than a computation.
    const explore = read("src/pages/Explore.tsx");
    expect(explore, "the sentence describing the seven-day floor must not be rendered")
      .not.toMatch(/"explore\.hiringBlurb"/);
    expect(explore, "its replacement names the tracked window instead").toMatch(/"explore\.hiringBlurbCurve"/);
  });
});

describe("a median drawn from a window that cannot hold one — a median that was not reached is not printed", () => {
  const MEDIAN_RENDER = /median_days_to_fill\s*\?\?\s*0/g;

  it("every numeric median render sits inside a median_censored branch", () => {
    // The published median is min{ t <= 30 : R(t) >= 0.5 }. Where the fill
    // incidence never reaches one half inside our record — which is MOST
    // employers today, given ~54 days of lifecycle history against a 30-day
    // serving cap — median_days_to_fill is NULL and median_censored is TRUE.
    // The honest rendering is "more than 30 days", never a number, never an
    // interpolation, and never a `?? 0` that prints day zero.
    const sites: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = stripTs(read(file));
      for (const m of code.matchAll(MEDIAN_RENDER)) {
        const before = code.slice(Math.max(0, m.index! - 400), m.index!);
        sites.push(`${file}:${/median_censored\s*\?/.test(before) ? "guarded" : "UNGUARDED"}`);
      }
    }
    expect(sites.length, "the render sites must still exist to be guarded").toBeGreaterThan(0);
    expect(sites.filter((s) => s.endsWith("UNGUARDED")), "a number where there is no median is the headline bug").toEqual([]);
  });

  it("the API passes the null through instead of defaulting it", () => {
    // Same rule one runtime over. `num()` carries NULL out as null; a `?? 0` or
    // a Math.round here would publish "half filled on day 0" to every integrator
    // reading the endpoint.
    const api = stripTs(read("supabase/functions/public-api/index.ts"));
    expect(api, "the median must reach the payload unmodified").toMatch(/median_days_to_fill\s*\)/);
    expect(api, "no default may stand in for an absent median")
      .not.toMatch(/median_days_to_fill\s*(\?\?|\|\|)\s*0/);
  });

  it("the censored copy exists and interpolates no day count", () => {
    // A censored median must not smuggle a number back in through its own
    // sentence. The only interpolation allowed is the support edge itself.
    const en = JSON.parse(read("src/i18n/locales/en.json")) as {
      jobsPage: Record<string, string>;
      accountPage: Record<string, string>;
    };
    for (const key of ["fieldMedianCensored", "hhMedianCensored"]) {
      const copy = en.jobsPage[key];
      expect(copy, `jobsPage.${key} must exist`).toBeTruthy();
      expect(copy, "the censored sentence says there is no figure").toMatch(/no typical figure/i);
      expect((copy.match(/\{\{(\w+)\}\}/g) ?? []).sort(), "only the support edge may be interpolated").toEqual(["{{d}}"]);
    }
    expect(en.accountPage.replyWindowFillCensored, "the tracker chip has a censored branch too")
      .toMatch(/still up 30 days/i);
  });
});

describe("a median drawn from a window that cannot hold one — a floor is rendered as a floor", () => {
  it("every relist or churn quantity that reaches copy carries an at-least", () => {
    // The collector logs only the FIRST superseded closure per normalised title
    // per employer per 24h — one live board collapsed the same title 89 times in
    // a day into a single row. So relist_rate_14, relists_90d and churn are lower
    // bounds, never measurements, and rendering one as an exact figure restates
    // the overstated precision the old superseded_90d count carried. Worse: the
    // deduped rows are DELETED rather than merely unlogged, which makes the fill
    // rate beside them a ceiling.
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = stripTs(read(file));
      for (const m of code.matchAll(/t\(\s*"[^"]+"\s*,\s*"(?:[^"\\]|\\.)*"[\s\S]{0,400}?\)/g)) {
        const call = m[0];
        if (!/relists_90d|relist_rate_14|\.churn\b|relistPct/.test(call)) continue;
        const copy = /t\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/.exec(call);
        if (!copy) continue;
        if (!FLOOR_MARKER.test(copy[2])) offenders.push(`${file}: ${copy[1]}`);
      }
    }
    expect(offenders, "a deduped count rendered as an exact one is a false precision claim").toEqual([]);

    // The bare-JSX case, which no t() scan can see: the field table prints the
    // relist share as a raw span.
    const ghost = stripTs(read("src/pages/GhostJobIndex.tsx"));
    const relist = ghost.slice(ghost.indexOf("relist_rate_14 * 100") - 200, ghost.indexOf("relist_rate_14 * 100") + 80);
    expect(relist, "the field table's relist share is a floor on screen").toMatch(/≥/);
  });

  it("the un-floored predecessors of those strings are rendered by nothing", () => {
    // Both spellings still sit in all nine locale files, because a locale VALUE
    // overrides an inline default and deleting keys mid-flight leaves nine
    // translations rendering the old sentence. The rule that matters is that no
    // source file still ASKS for one. Comment-stripped: a key named in a comment
    // explaining why it was retired must not fail this.
    const RETIRED = ["verdictChurn", "repostChipTracked", "hhRepostsTracked", "repostTipTracked"];
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = stripTs(read(file));
      for (const key of RETIRED) {
        if (new RegExp(`["'\`]jobsPage\\.${key}["'\`]`).test(code)) offenders.push(`${file}: ${key}`);
      }
    }
    expect(offenders, "the exact-count sentences were replaced, not kept as a fallback").toEqual([]);

    const en = JSON.parse(read("src/i18n/locales/en.json")) as { jobsPage: Record<string, string> };
    for (const key of ["verdictChurnFloor", "hhRepostsFloor", "repostChipFloor"]) {
      expect(en.jobsPage[key], `jobsPage.${key} must carry its floor marker`).toMatch(FLOOR_MARKER);
    }
  });

  it("the public API declares the relist figures floors and the interval an approximation", () => {
    // Asserted against RAW: this is prose served to integrators, and it is the
    // only place they can learn either fact. The interval on R(14) is a Greenwood
    // interval on S carried across by the observed fill share — exact only where
    // that share is constant over the window — and publishing it as an exact
    // Aalen-Johansen interval would be a precision claim we cannot support.
    const api = read("supabase/functions/public-api/index.ts");
    expect(api, "relist figures are lower bounds and the payload must say so").toMatch(/FLOORS?:/);
    expect(api, "the interval is an approximation and the payload must say so").toMatch(/APPROXIMATION/);
    expect(api, "the deprecated median must not be sold as a time-to-fill")
      .toMatch(/Do not read it as time-to-fill/);
  });
});

describe("a median drawn from a window that cannot hold one — a statistic and its sample-size gate share a population", () => {
  it("the fill-rate gate is the RPC's own sufficient, never a closure count", () => {
    // THE DEFECT, NAMED. get_company_hiring_health computed closed_90d on the
    // coalesced basis and median_days_to_close over the strictly smaller stated-
    // date cohort, then rendered them side by side as one fact. Live proof
    // 2026-09-06: gici~wd5~Careers returned closed_90d 41 with the median null.
    // The client made it worse by re-deriving its own render gate from whichever
    // count it happened to hold, which is how a rate over four dated closures
    // reached a screen. There is now exactly one gate and the database computes
    // it, over the same rows the rate is estimated from.
    const jobs = stripTs(read("src/pages/Jobs.tsx"));
    const gate = /export function canStateFillRate\([\s\S]*?\n\}/.exec(jobs)?.[0] ?? "";
    expect(gate, "canStateFillRate must still exist as the single predicate").toBeTruthy();
    expect(gate, "the gate is the RPC's own sufficiency finding").toMatch(/\.sufficient\b/);
    expect(gate, "a closure count is a different population from the rate")
      .not.toMatch(/closed_90d|fills_90d|fills_le_14|n_at_risk_14/);

    for (const file of ["src/pages/Jobs.tsx", "src/pages/Account.tsx", "src/pages/GhostJobIndex.tsx", "src/pages/Explore.tsx"]) {
      const code = stripTs(read(file));
      expect(code, `${file} must not re-derive a rate gate from a closure count`)
        .not.toMatch(/closed_90d\s*>=\s*\d/);
    }
  });

  it("the sample printed beside an employer rate is the dated cohort, not the day-14 risk set", () => {
    // n_at_risk_14 is the survivor count at the horizon: it excludes every role
    // that already filled, relisted or was censored before day 14, so it shrinks
    // as the rate rises and can be SMALLER than the fill count it would claim to
    // cover. Printing it as "measured over N roles" is the closed_90d-beside-a-
    // null-median defect written out as a sentence. dated_n is the cohort the
    // durations were actually computed over.
    const jobs = stripTs(read("src/pages/Jobs.tsx"));
    for (const m of jobs.matchAll(/n_at_risk_14/g)) {
      const window = jobs.slice(Math.max(0, m.index! - 300), m.index! + 120);
      expect(window, "the risk set is a gate input, never a printed sample").not.toMatch(/\bt\(\s*"/);
    }
    expect(jobs, "the employer sentence names the dated cohort").toMatch(/n:\s*hiringCurve\.dated_n/);
  });

  it("the curve RPC publishes the coverage gap rather than conditioning on it silently", () => {
    const curve = LIVE.get("get_company_fill_curve")!;
    for (const col of ["dated_coverage", "dated_n", "undated_n", "sufficient", "median_censored"]) {
      expect(curve.code, `get_company_fill_curve must return ${col}`).toContain(col);
    }
  });

  it("the live proof of the mismatch is on the record", () => {
    // Asserted against RAW on purpose: this is the measurement that justifies the
    // change, and a later reader who cannot find it will re-litigate the design.
    const record = read("supabase/migrations/20260906091000_censoring_is_not_truncation.sql");
    expect(record).toMatch(/gici~wd5~Careers/);
    expect(record).toMatch(/closed_90d\s*=\s*41/);
    expect(record).toMatch(/median_days_to_close\s*=\s*null/);
  });
});

describe("a median drawn from a window that cannot hold one — the three coverage bands exist in the render path", () => {
  it("the bands are defined once, with both thresholds and exactly three outcomes", () => {
    // dated_coverage is deliberately NOT part of `sufficient`. They answer
    // different questions: sufficiency asks whether the estimate is stable enough
    // to show, coverage asks how much of the employer's board it speaks for.
    // Folding them into one gate throws away the middle case, where the number is
    // sound and simply needs to name its population.
    const jobs = stripTs(read("src/pages/Jobs.tsx"));
    expect(jobs, "the plain band starts at 60%").toMatch(/FILL_COVERAGE_PLAIN\s*=\s*0\.6/);
    expect(jobs, "below 30% the duration claim is suppressed entirely").toMatch(/FILL_COVERAGE_MIN\s*=\s*0\.3/);
    const band = /export function coverageBand\([\s\S]*?\n\}/.exec(jobs)?.[0] ?? "";
    expect(band, "coverageBand must exist as the one definition").toBeTruthy();
    expect(band).toMatch(/"plain"/);
    expect(band).toMatch(/"qualified"/);
    expect(band).toMatch(/"none"/);
  });

  it("every surface that renders a fill rate applies the suppression threshold", () => {
    // The strict floor, class-wide: a rate computed over under a third of an
    // employer's roles is not a fact about that employer, and no surface may
    // print it. Undatedness is correlated with posting AGE — several vendors stop
    // stamping posted_at once a role is older — so the roles the duration arm
    // drops are disproportionately the long-open ones. That is the same right-
    // tail loss this whole change exists to remove, wearing a coverage label.
    const renderers = SOURCE_FILES.filter((f) => /fill_rate_14/.test(stripTs(read(f))) && f.startsWith("src/pages"));
    expect(renderers.length, "the rate must be rendered somewhere").toBeGreaterThan(0);
    for (const file of renderers) {
      const code = stripTs(read(file));
      expect(code, `${file} must suppress below the coverage floor`)
        .toMatch(/FILL_COVERAGE_(MIN|QUALIFY)|coverageBand/);
    }
  });

  it("every surface that renders the rate in prose also names the coverage share", () => {
    // The middle band, 0.30–0.60: show the number, and say what it covers.
    //
    // ONE SURFACE IS KNOWINGLY OUTSIDE THIS AND IS LISTED RATHER THAN EXCUSED.
    // /explore renders the rate inside a compact grid badge and applies only the
    // suppression threshold, so an employer at 35% coverage gets the figure with
    // no qualifier beside it. That is a real gap against the model's "applied
    // identically on every surface that renders a duration", not a design choice,
    // and it is written here so it is visible rather than absent. The list must
    // shrink to empty; a second entry appearing is a regression this fails on.
    const BAND_GAP = ["src/pages/Explore.tsx"];
    const proseSurfaces = ["src/pages/Jobs.tsx", "src/pages/Account.tsx", "src/pages/GhostJobIndex.tsx"];
    for (const file of proseSurfaces) {
      const code = stripTs(read(file));
      expect(code, `${file} must carry the qualified band as well as the floor`)
        .toMatch(/FILL_COVERAGE_PLAIN/);
    }
    const gaps = SOURCE_FILES.filter((f) => {
      if (!f.startsWith("src/pages")) return false;
      const code = stripTs(read(f));
      return /fill_rate_14/.test(code) && !/FILL_COVERAGE_PLAIN|coverageBand/.test(code);
    });
    expect(gaps, "only the known badge surface may omit the middle band").toEqual(BAND_GAP);

    const en = JSON.parse(read("src/i18n/locales/en.json")) as {
      jobsPage: Record<string, string>;
      accountPage: Record<string, string>;
    };
    expect(en.jobsPage.fillCoverageQualifier, "the qualifier must name the share").toMatch(/\{\{pct\}\}%/);
    expect(en.accountPage.replyWindowFillCoverage, "and again on the tracker chip").toMatch(/\{\{pct\}\}%/);
  });
});

describe("a median drawn from a window that cannot hold one — the guard has teeth", () => {
  // Every matcher above is proved to fire on the exact pre-fix spelling. A guard
  // that cannot fail is worse than no guard: it reports a property nobody holds.

  it("the seven-day matcher fires on the spelling that shipped", () => {
    expect(SEVEN_DAY_FLOOR.test(
      "AND closed_at - COALESCE(posted_at, first_seen) >= interval '7 days'",
    )).toBe(true);
    expect(SEVEN_DAY_FLOOR.test(
      "AND c.closed_at - c.posted_at >= interval '7 days'",
    )).toBe(true);
    // And does NOT fire on a seven-day TREND BUCKET, which is a different rule
    // living in get_trending_categories and get_hiring_trends and is correct.
    expect(SEVEN_DAY_FLOOR.test(
      "count(*) FILTER (WHERE posted_at > now() - interval '7 days')",
    )).toBe(false);
  });

  it("the coalesced-origin matchers fire on the medians that shipped", () => {
    const sql = "percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM"
      + " (closed_at - COALESCE(posted_at, first_seen))) / 86400.0)";
    const hit = [...sql.matchAll(COALESCED_ORIGIN_SQL)];
    expect(hit.length, "the SQL spelling must be seen").toBe(1);
    expect(IS_DURATION.test(sql) && IS_AGGREGATE.test(sql), "and classified as an aggregate duration").toBe(true);

    expect([...("days_on_board: (r.posted_at ?? r.first_seen)".matchAll(COALESCED_ORIGIN_TS))].length).toBe(1);
    // Must NOT fire on a field list that merely names both columns.
    expect([...("posted_at: j.postedAt ?? null, first_seen: null,".matchAll(COALESCED_ORIGIN_TS))].length).toBe(0);
  });

  it("the median guard rejects an ungated render", () => {
    const bad = stripTs('<>{t("jobsPage.fieldMedian", "day {{d}}", { d: Math.round(field.median_days_to_fill ?? 0) })}</>');
    const m = [...bad.matchAll(/median_days_to_fill\s*\?\?\s*0/g)][0];
    expect(m, "the render form must be recognised").toBeTruthy();
    expect(/median_censored\s*\?/.test(bad.slice(0, m!.index!)), "and reported as unguarded").toBe(false);

    const good = "median_censored ? <>none</> : <>{Math.round(x.median_days_to_fill ?? 0)}</>";
    const gm = [...good.matchAll(/median_days_to_fill\s*\?\?\s*0/g)][0];
    expect(/median_censored\s*\?/.test(good.slice(0, gm!.index!))).toBe(true);
  });

  it("the floor-marker matcher rejects an exact-count relist sentence", () => {
    expect(FLOOR_MARKER.test("{{relistPct}}% re-listed")).toBe(false);
    expect(FLOOR_MARKER.test("at least {{relistPct}}% re-listed")).toBe(true);
    expect(FLOOR_MARKER.test("≥{{pct}}% re-listed")).toBe(true);
    expect(FLOOR_MARKER.test("Re-lists roles often ({{n}}×+)")).toBe(true);
  });

  it("comment stripping actually strips, and RAW actually keeps", () => {
    // THE SEVEN-TIME TRAP, PROVED IN BOTH DIRECTIONS. A guard that pins a
    // spelling passes on a COMMENT while the code beneath it is dead; a guard
    // that forbids a spelling fails on a comment explaining why the spelling was
    // removed. Both are real failures in this repo's history, so both constants
    // are proved to behave.
    const sql = "-- AND closed_at - posted_at >= interval '7 days'\nSELECT 1;";
    expect(SEVEN_DAY_FLOOR.test(sql), "raw SQL keeps the commented spelling").toBe(true);
    expect(SEVEN_DAY_FLOOR.test(stripSql(sql)), "stripped SQL does not").toBe(false);

    const ts = "// const x = a.posted_at ?? b.first_seen;\nconst y = 1;";
    expect(COALESCED_ORIGIN_TS.test(ts)).toBe(true);
    COALESCED_ORIGIN_TS.lastIndex = 0;
    expect([...stripTs(ts).matchAll(COALESCED_ORIGIN_TS)].length, "stripped TS does not").toBe(0);

    const block = "/* closed_at - COALESCE(posted_at, first_seen) */ SELECT 1;";
    expect([...stripSql(block).matchAll(COALESCED_ORIGIN_SQL)].length).toBe(0);
    expect(stripTs("https://example.com/x // not a comment start"), "a URL is not a line comment")
      .toContain("https://example.com/x");
  });

  it("the function-body extractor is what makes the SQL assertions honest", () => {
    // Proved against the exact false positive this guard hit while being written:
    // 20260811160307 defines get_size_segments AND get_actively_hiring_companies,
    // the floor belongs to the second, and a whole-file match convicts the first.
    const file = "supabase/migrations/20260811160307_b721954a-be85-494d-b640-1e047506afdf.sql";
    expect(SEVEN_DAY_FLOOR.test(stripSql(read(file))), "the file does carry a floor somewhere").toBe(true);
    expect(LIVE.get("get_size_segments")?.file, "and get_size_segments' live body is in that file").toBe(
      "20260811160307_b721954a-be85-494d-b640-1e047506afdf.sql",
    );
    expect(SEVEN_DAY_FLOOR.test(LIVE.get("get_size_segments")!.code), "but not inside its own body").toBe(false);
  });
});
