/**
 * A CLOSED_AT THAT IS KNOWN TO BE LATE IS NOT A DATE.
 *
 * job_board_closures.absence_basis says what kind of evidence ended a posting.
 * Two of its three values carry a closed_at you may date a statistic with;
 * the third does not, and its own column COMMENT says so in as many words:
 *
 *   'lap_backfill' -- a lap closure from the board's FIRST observable laps --
 *   the backlog of takedowns that accumulated while the page cap made the
 *   board unobservable, up to thirty days of them, all landing at once with a
 *   closed_at of the day we could finally see them. ITS closed_at IS KNOWN TO
 *   BE LATE, by an unknown amount up to the freshness window, so it is not
 *   admissible in ANY duration, tenure or fill-speed statistic; it is a count
 *   of events, not a dated one.
 *
 * When that column shipped (20260909010000) NOTHING READ IT. Sixteen functions
 * computed a duration, a rate or a tenure from closed_at and not one of them
 * mentioned absence_basis -- including get_category_fill_curve, which that
 * migration's own follow-up sentence names. The reason nothing was visibly
 * wrong is that deepCursor.laps was 0: no board had completed a proven lap, so
 * no such row existed yet. The first proven lap starts writing them within
 * days, on the biggest boards on the site, and on that day a month of
 * accumulated takedowns arrives stamped with one afternoon's timestamp:
 *
 *   * a fill that "took one day" in every curve, median and benchmark;
 *   * several hundred takedowns "today"; one week's spike in the trend series;
 *   * an employer we have watched for months reporting a tracking span of one.
 *
 * Our own observability catching up, published as an employer's behaviour.
 *
 * THE PROPERTY THIS GUARD STATES, for the CLASS and not for the sixteen:
 *
 *   1. Any live function that reads closed_at out of job_board_closures
 *      filters on absence_basis. The set is DISCOVERED from the migrations --
 *      last definition wins, exactly as the database resolves them -- so a
 *      seventeenth function written next month fails here instead of shipping.
 *   2. The predicate is `IS DISTINCT FROM 'lap_backfill'` and never
 *      `<> 'lap_backfill'`. The column is nullable and every closure logged
 *      before 2026-09-08 is NULL, so `<>` is NULL for all of them and would
 *      silently delete the entire history this board has -- a bug that would
 *      read as "the log is empty", not as an error.
 *   3. get_application_lifecycle is the ONE shaped exception, and it is pinned
 *      as one. It answers "what happened to the job I applied to", per posting.
 *      A lap_backfill row there is a TRUE statement that the posting came down;
 *      only its date is unusable. So the row stays, `outcome` stays, and
 *      days_standing alone goes NULL. Filtering the row away would answer
 *      'not_observed' about a job that demonstrably closed, which is a worse
 *      error than the one being fixed.
 *   4. The excluded mass stays nameable: get_closure_population() still
 *      publishes closures_lap_backfill. An exclusion nobody can size is a
 *      silent one.
 *
 * Every assertion runs against COMMENT-STRIPPED SQL. This repo has four times
 * shipped a guard whose pinned spelling lived only in a comment while the code
 * beneath it was gone, and the teeth tests at the foot of this file include
 * exactly that case: a body whose comments are perfect and whose code is the
 * pre-fix query.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");

/** Executable text only: `--` to end of line, and block comments. */
const stripSql = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/--[^\n]*/g, "");

type Def = { file: string; raw: string; code: string };

/**
 * The LAST definition of every Postgres function, as an isolated body.
 *
 * Two things are load-bearing. `.sort()` is apply order, because migration
 * filenames are timestamp-prefixed and the last definition is what the database
 * runs. And the body is cut from `CREATE ... FUNCTION` to the close of its own
 * dollar-quoted block -- by the tag it actually opened with, not by a hardcoded
 * `$$` -- so an assertion about function X can never be satisfied or broken by
 * function Y sharing its file.
 */
function liveFunctions(): Map<string, Def> {
  const out = new Map<string, Def>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(DIR, file), "utf8");
    for (const m of sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi,
    )) {
      const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(m.index!));
      if (!tag) continue;
      const open = m.index! + tag.index! + tag[0].indexOf(tag[1]);
      const close = sql.indexOf(tag[1], open + tag[1].length);
      if (close < 0) continue;
      const raw = sql.slice(m.index!, close + tag[1].length);
      out.set(m[1].toLowerCase(), { file, raw, code: stripSql(raw) });
    }
  }
  return out;
}

const LIVE = liveFunctions();

/* ───────────────────────────── the checker ───────────────────────────────
   A pure function over the definitions, so the teeth tests below can run the
   very same code against doctored bodies and watch it fire. */

/** Does this body compute from job_board_closures.closed_at at all?
 *  `\b` on both sides, so the rollup's first_closed_at / last_closed_at are not
 *  mistaken for a read of the log's own column. */
const readsClosedAt = (code: string) =>
  /job_board_closures\b/.test(code) && /\bclosed_at\b/.test(code);

/** The admissible spelling: NULL-safe, so pre-column history survives. */
const ADMITS = /absence_basis\s+IS\s+DISTINCT\s+FROM\s+'lap_backfill'/i;
/** The shaped exception: the row stays, the duration goes. */
const NULLS_THE_DURATION = /absence_basis\s*=\s*'lap_backfill'\s+THEN\s+NULL/i;
/** The spelling that eats every pre-2026-09-08 row along with the backlog. */
const NULL_EATING = /absence_basis\s*(?:<>|!=)\s*'lap_backfill'/i;

function violations(defs: Map<string, Def>): string[] {
  const bad: string[] = [];
  for (const [name, { file, code }] of defs) {
    if (NULL_EATING.test(code)) {
      bad.push(`${name} (${file}): <> 'lap_backfill' is NULL for every closure logged before the column existed`);
      continue;
    }
    if (!readsClosedAt(code)) continue;
    if (ADMITS.test(code) || NULLS_THE_DURATION.test(code)) continue;
    bad.push(`${name} (${file}): reads job_board_closures.closed_at without filtering absence_basis`);
  }
  return bad;
}

/** The functions the rule currently applies to, discovered rather than listed. */
const FLAGGED = [...LIVE].filter(([, d]) => readsClosedAt(d.code)).map(([n]) => n).sort();

describe("no statistic dates itself with a closed_at that is known to be late", () => {
  it("found the migrations and the functions at all (guards the guard)", () => {
    expect(LIVE.size, "no function definitions parsed out of the migrations").toBeGreaterThan(50);
    // If this list ever shrinks sharply, the extractor has rotted and every
    // assertion below is passing over an empty set.
    expect(FLAGGED.length, "nothing reads closed_at — the detector has rotted").toBeGreaterThanOrEqual(16);
    for (const n of [
      "get_category_fill_curve",
      "get_company_fill_curve",
      "get_company_hiring_health",
      "get_actively_hiring_companies",
      "roll_up_and_prune_closures",
      "refresh_ghost_stats",
      "get_takedowns_today",
    ]) {
      expect(FLAGGED, `${n} must be inside the rule, not beside it`).toContain(n);
    }
  });

  it("every live function that dates itself by closed_at filters absence_basis", () => {
    expect(
      violations(LIVE),
      "a lap_backfill closure carries a closed_at that is late by up to the freshness window; " +
        "any duration, rate or tenure that admits one is publishing our own observability as an employer's behaviour",
    ).toEqual([]);
  });

  it("the shaped exception is exactly one function, and it keeps the row", () => {
    // get_application_lifecycle must NULL the duration rather than drop the
    // closure: dropping it reports 'not_observed' for a posting that came down.
    const lifecycle = LIVE.get("get_application_lifecycle");
    expect(lifecycle, "get_application_lifecycle is not defined in any migration").toBeTruthy();
    expect(
      NULLS_THE_DURATION.test(lifecycle!.code),
      "days_standing must go NULL on a backfilled closure, and the row must stay",
    ).toBe(true);
    expect(
      ADMITS.test(lifecycle!.code),
      "this function must not FILTER the row out — 'not_observed' about a job that closed is a worse answer than none",
    ).toBe(false);

    // And it is the only one shaped that way: everywhere else the row is a
    // statistic's input and has no meaning of its own to preserve.
    const shaped = [...LIVE].filter(([, d]) => NULLS_THE_DURATION.test(d.code)).map(([n]) => n);
    expect(shaped, "a second per-row exception needs a decision, not a default").toEqual([
      "get_application_lifecycle",
    ]);
  });

  it("the excluded mass stays nameable in the disclosure", () => {
    // An exclusion nobody can size is a silent one. get_closure_population()
    // is the surface that says how many rows the rule removes.
    const pop = LIVE.get("get_closure_population");
    expect(pop, "get_closure_population is not defined in any migration").toBeTruthy();
    expect(pop!.code).toMatch(/closures_lap_backfill/);
    expect(pop!.code).toMatch(/closures_full_read/);
  });
});

/* ───────────────────────────── teeth ─────────────────────────────────────
   The checker re-run against the pre-fix spellings. A guard that cannot be
   shown to fail is a guard nobody has tested. */

const def = (code: string): Map<string, Def> =>
  new Map([["fixture", { file: "fixture.sql", raw: code, code: stripSql(code) }]]);

describe("the checker can actually fail", () => {
  it("fires on the pre-fix body — a median over an unfiltered closure log", () => {
    expect(
      violations(def(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY closed_at - posted_at)
                      FROM public.job_board_closures WHERE closed_at >= now() - interval '90 days';`)),
    ).toHaveLength(1);
  });

  it("fires when the rule is spelled in a COMMENT and absent from the code", () => {
    // This repo has shipped that four times. The body below reads exactly as
    // though it were fixed and runs exactly as though it were not.
    expect(
      violations(def(`SELECT count(*)
                      FROM public.job_board_closures
                      -- absence_basis IS DISTINCT FROM 'lap_backfill'
                      WHERE closed_at >= now() - interval '1 day';`)),
      "a guard that finds its own literal inside a comment has no teeth",
    ).toHaveLength(1);
  });

  it("fires on the NULL-eating spelling even though it names the value", () => {
    // `<>` is NULL for every row written before the column existed, which is
    // the whole history: the statistic goes empty rather than wrong, and an
    // empty aggregate arrives as a 200.
    expect(
      violations(def(`SELECT count(*) FROM public.job_board_closures
                      WHERE closed_at >= now() - interval '1 day'
                        AND absence_basis <> 'lap_backfill';`)),
    ).toHaveLength(1);
  });

  it("passes the fixed spelling, and the shaped exception", () => {
    expect(
      violations(def(`SELECT count(*) FROM public.job_board_closures
                      WHERE closed_at >= now() - interval '1 day'
                        AND absence_basis IS DISTINCT FROM 'lap_backfill';`)),
    ).toEqual([]);
    expect(
      violations(def(`SELECT CASE WHEN c.absence_basis = 'lap_backfill' THEN NULL
                                  ELSE c.closed_at - c.posted_at END
                      FROM public.job_board_closures c;`)),
    ).toEqual([]);
  });

  it("does not fire on a function that never reads the log's own date", () => {
    // job_board_closure_rollup.first_closed_at is not job_board_closures.
    expect(
      violations(def(`SELECT first_closed_at, last_closed_at FROM public.job_board_closure_rollup;`)),
    ).toEqual([]);
    expect(violations(def(`SELECT count(*) FROM public.job_board_closures;`))).toEqual([]);
  });
});
