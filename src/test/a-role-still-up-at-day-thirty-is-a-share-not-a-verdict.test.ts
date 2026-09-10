/**
 * A ROLE STILL UP AT DAY THIRTY IS A SHARE, NOT A VERDICT.
 *
 * The owner asked for posting AGE to be a signal. Past day 30 a posting is
 * DELETED (FRESH_WINDOW_DAYS = 30; the sweep tombstones it), so a takedown
 * after day 30 is never observed and nothing may extrapolate past it. The
 * measurable quantity is S(30) from the Aalen-Johansen estimator: the share of
 * a DATED cohort still advertised when it reaches the cap, with R(30) taken
 * down for good and X(30) re-listed, R + X + S = 1 checked rather than
 * asserted. 20260909217000 / 20260909217500 extend both curves IN PLACE with
 * those columns, and 20260909217800 materialises the per-board observability
 * bucket the refresh already computed and threw away.
 *
 * TWO WAYS THE NUMBER LIES, WHICH THIS GUARD PINS SHUT:
 *
 *   1. THE COHORT FLOOR. job_board_exits.posted_at is stamped only from
 *      2026-09-06, so no age-out logged earlier carries an origin and any
 *      cohort posted before 2026-08-07 has its takedowns in the log and its
 *      survivors nowhere -- S(30) runs low, in the accusing direction. The
 *      day-30 cohort must be floored at GREATEST(the day after the event
 *      window opened, that - 30d) with the stamping date a NAMED constant, and
 *      the floor must be returned. THE WINDOW EDGE IS THE ARMS' OWN: the
 *      closure and exit arms are cut on now() - 90 days at employer grain and
 *      on the caller's p_days at field grain; a cohort cut on a fixed 90 days
 *      while its arms were cut on p_days kept its survivors and lost its early
 *      takedowns -- S(30) high -- with sufficient_30 still true.
 *
 *   1b. ONE AGE-OUT, ONE VERDICT. Our sweep's takedown at the cap is censored
 *      on the same batch verdict at both grains: suspect UNION dark, keyed on
 *      (company_token, exited_at). Censoring the field arm on dark alone gave
 *      one event two verdicts.
 *
 *   2. THE OBSERVABILITY GATE. A windowed board with no proven lap has
 *      S(30) = 1 BY CONSTRUCTION -- its takedowns are invisible, so every
 *      posting ages out. The day-30 columns must be NULL (not 1.0) unless the
 *      board's bucket is full_read or lap_proven, and at field grain the risk
 *      set must admit only those boards and say what share it admitted.
 *
 * AND ONE WAY THE CHANGE ITSELF COULD BREAK THINGS: every existing column of
 * both curves is read by the company lander, the explore cache and the
 * actively-hiring leaderboard. They must stay BYTE-IDENTICAL -- same RETURNS
 * TABLE prefix, same projection line per column -- and the estimator's own
 * mirror checks must still pass over the extended bodies.
 *
 * Every assertion about what the SQL DOES runs against COMMENT-STRIPPED code,
 * discovered as the LAST definition of each function (apply order), exactly
 * as the database resolves it. The teeth block at the foot runs the same
 * checker against the prior migration's text and against a fixture whose only
 * correct spellings live in comments, and watches it fire.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");

const PRIOR = "20260909200000_a_closed_at_that_is_known_to_be_late.sql";
const COMPANY_FILE = "20260909217000_a_role_still_up_at_day_thirty_is_a_share_not_a_verdict.sql";
const CATEGORY_FILE = "20260909217500_a_field_is_only_as_open_as_the_boards_we_can_read.sql";
const TABLE_FILE = "20260909217800_the_bucket_we_computed_and_threw_away.sql";

/** Executable text only: `--` to end of line, and block comments. */
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/--[^\n]*/g, "");

type Def = { file: string; raw: string; code: string };

/**
 * Every function definition in one file, cut from `CREATE ... FUNCTION` to the
 * close of its own dollar-quoted block -- by the tag it opened with -- so an
 * assertion about X can never be satisfied by Y sharing the file.
 */
function definitionsIn(file: string): Map<string, Def> {
  const out = new Map<string, Def>();
  const sql = readFileSync(resolve(DIR, file), "utf8");
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)) {
    const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(m.index!));
    if (!tag) continue;
    const open = m.index! + tag.index! + tag[0].indexOf(tag[1]);
    const close = sql.indexOf(tag[1], open + tag[1].length);
    if (close < 0) continue;
    const raw = sql.slice(m.index!, close + tag[1].length);
    out.set(m[1].toLowerCase(), { file, raw, code: stripSql(raw) });
  }
  return out;
}

/** The LAST definition of every function -- `.sort()` is apply order. */
function liveFunctions(): Map<string, Def> {
  const out = new Map<string, Def>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    for (const [name, def] of definitionsIn(file)) out.set(name, def);
  }
  return out;
}

const LIVE = liveFunctions();
const PRIOR_DEFS = definitionsIn(PRIOR);

/** The RETURNS TABLE column lines of one definition, verbatim. */
function returnsTableLines(raw: string): string[] {
  const m = /RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE/.exec(raw);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/,\s*$/, ""))
    .filter((l) => l.trim().length > 0);
}

/** The projection line that produces `AS <col>`, whitespace-normalised. */
function projectionLine(code: string, col: string): string | null {
  const re = new RegExp(`^([^\\n]*\\bAS\\s+${col})\\s*,?\\s*$`, "m");
  const m = re.exec(code);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

const NEW_COLUMNS = [
  "still_open_30",
  "still_open_30_lo",
  "still_open_30_hi",
  "taken_down_30",
  "relist_rate_30",
  "n_at_risk_30",
  "ageouts_at_30",
  "sum_check_30",
  "cohort_from",
  "cohort_to",
  "sufficient_30",
];

/* ───────────────────────────── the checker ───────────────────────────────
   Pure over comment-stripped code, so the teeth tests below can run it against
   the pre-fix body and against a comment-only fixture and watch it fire. */
function dayThirtyViolations(code: string, grain: "tok" | "cat"): string[] {
  const v: string[] = [];
  const cols = returnsTableLines(code).map((l) => l.trim().split(/\s+/)[0]);
  const extra = grain === "tok" ? "observability_bucket" : "gate_share_30";
  for (const c of [...NEW_COLUMNS, extra]) if (!cols.includes(c)) v.push(`column:${c}`);

  // agg carries the age-out count: sum(is_ageout) AS d_ageout.
  if (!/sum\(\s*r\.is_ageout\s*\)::int\s+AS d_ageout/.test(code)) v.push("d_ageout");

  // at_h at the cap, in the file's own form.
  if (!/COALESCE\(min\(c\.s\)\s+FILTER \(WHERE c\.tt <= 30\), 1\) AS s30/.test(code)) v.push("s30");
  if (!/COALESCE\(max\(c\.x_cif\) FILTER \(WHERE c\.tt <= 30\), 0\) AS x30/.test(code)) v.push("x30");
  if (!/COALESCE\(max\(c\.gw\)\s+FILTER \(WHERE c\.tt <= 30\), 0\) AS gw30/.test(code)) v.push("gw30");
  if (!/COALESCE\(sum\(c\.cnt\)\s+FILTER \(WHERE c\.tt >= 30\), 0\)::int AS n30/.test(code)) v.push("n30");
  if (!/COALESCE\(sum\(c\.d_ageout\) FILTER \(WHERE c\.tt >= 30\), 0\)::int AS ageouts30/.test(code))
    v.push("ageouts30");

  // Complementary log-log on S(30): v clamped at 4, +1.96 the LOWER bound.
  if (!/LEAST\(a\.gw30 \/ \(ln\(a\.s30\) \* ln\(a\.s30\)\), 4\.0\)/.test(code)) v.push("cll-v");
  if (!/b\.s30 \^ LEAST\(exp\(1\.96 \* sqrt\(b\.v30\)\), 50\.0\) END AS s30_lo/.test(code)) v.push("s30_lo");
  if (!/b\.s30 \^ GREATEST\(exp\(-1\.96 \* sqrt\(b\.v30\)\), 0\.02\) END AS s30_hi/.test(code)) v.push("s30_hi");

  // THE COHORT FLOOR: a named constant, the GREATEST, and the cohort using it.
  if (!/DATE '2026-09-06'\s+AS exits_origin_stamped_from/.test(code)) v.push("floor-constant");
  // THE COHORT LIVES INSIDE THE EVENT WINDOW: from_d is the first whole day
  // after the window the closure and exit arms are cut on -- the fixed 90 days
  // at employer grain, the caller's p_days (via `win`) at field grain.
  const windowEdge =
    grain === "tok"
      ? /GREATEST\(\(now\(\) - interval '90 days'\)::date \+ 1,\s*\(SELECT kk\.exits_origin_stamped_from FROM k kk\) - 30\) AS from_d/
      : /GREATEST\(\(now\(\) - make_interval\(days => \(SELECT w\.d FROM win w\)\)\)::date \+ 1,\s*\(SELECT kk\.exits_origin_stamped_from FROM k kk\) - 30\) AS from_d/;
  if (!windowEdge.test(code)) v.push("floor");
  // The field curve's only window is `win`: a literal 90-day interval anywhere
  // in its code is a cohort or an arm cut on a window the caller did not ask for.
  if (grain === "cat" && /interval\s+'90\s+days'/i.test(code)) v.push("window-bound");

  // ONE AGE-OUT, ONE VERDICT: the exit arm is censored on suspect UNION dark,
  // keyed on (company_token, exited_at), at both grains.
  if (
    !/bad_batch AS \(\s*SELECT DISTINCT c\.company_token AS tok, c\.closed_at AS at[\s\S]*?COALESCE\(c\.suspect, false\)[\s\S]*?UNION\s+SELECT d\.tok, d\.at FROM dark d\s*\)/.test(
      code,
    )
  )
    v.push("bad-batch");
  if (!/CASE WHEN bb\.tok IS NOT NULL THEN 0\s+WHEN e\.exit_reason = 'aged_out' THEN 1 ELSE 0 END AS is_ageout/.test(code))
    v.push("ageout-censor");
  if (!/LEFT JOIN bad_batch bb ON bb\.tok = e\.company_token AND bb\.at = e\.exited_at/.test(code))
    v.push("ageout-censor-join");
  if (!/current_date - 30\s+AS to_d/.test(code)) v.push("cohort-to");
  const arms = code.match(/posted_at >= \(SELECT h\.from_d FROM cohort30 h\)/g)?.length ?? 0;
  if (arms < 3) v.push("cohort30-on-every-arm");
  if (!/WHERE r\.in_cohort30 AND r\.tt IS NOT NULL AND r\.tt >= 0/.test(code)) v.push("agg30-cohort");
  if (!/AS cohort_from/.test(code) || !/AS cohort_to/.test(code)) v.push("cohort-published");

  // THE OBSERVABILITY GATE: the admitted buckets, spelled in code.
  if (!/\(o\.bucket IN \('full_read', 'lap_proven'\)\) AS admitted/.test(code)) v.push("bucket-gate");
  if (!/FROM public\.job_board_board_observability o/.test(code)) v.push("reads-observability");
  if (grain === "tok") {
    // NULL, not 1.0: every day-30 figure sits under CASE WHEN ob.admitted.
    for (const c of ["still_open_30", "still_open_30_lo", "still_open_30_hi", "taken_down_30", "relist_rate_30", "n_at_risk_30", "ageouts_at_30", "sum_check_30"]) {
      if (!new RegExp(`CASE WHEN ob\\.admitted THEN [^\\n]*END\\s+AS ${c}\\b`).test(code)) v.push(`null-not-one:${c}`);
    }
    if (!/COALESCE\(ob\.admitted\s+AND/.test(code)) v.push("gate-in-sufficient");
  } else {
    if (!/AND r\.tt >= 0 AND r\.admitted\s+GROUP BY r\.cat, r\.tt/.test(code)) v.push("gate-in-risk-set");
    if (!/count\(\*\) FILTER \(WHERE r\.in_cohort30 AND r\.dated AND r\.admitted\)::int AS admitted_dated_n/.test(code))
      v.push("gate-share");
    if (!/round\(g30\.admitted_dated_n::numeric \/ NULLIF\(g30\.dated_n30, 0\), 4\) AS gate_share_30/.test(code))
      v.push("gate-share-published");
  }

  // R + X + S = 1, CHECKED: published, and inside the gate.
  if (!/round\(e30\.r30 \+ e30\.x30 \+ e30\.s30, 6\)[^\n]*AS sum_check_30/.test(code)) v.push("identity");
  if (!/abs\(e30\.r30 \+ e30\.x30 \+ e30\.s30 - 1\) <= 0\.000001/.test(code)) v.push("identity-gate");

  // The day-30 gate on named constants.
  if (!/25\s+AS min_n_at_risk_30/.test(code) || !/0\.15::numeric\s+AS max_half_width_30/.test(code))
    v.push("constants");
  if (!/COALESCE\(e30\.n30, 0\) >= \(SELECT kk\.min_n_at_risk_30 FROM k kk\)/.test(code)) v.push("gate-n");
  if (!/\(e30\.s30_hi - e30\.s30_lo\) \/ 2 <= \(SELECT kk\.max_half_width_30 FROM k kk\)/.test(code))
    v.push("gate-half-width");

  return v;
}

/** The estimator mirror, verbatim from the-estimator-that-must-agree-with-arithmetic. */
function boundArm(code: string, marker: string): string {
  const end = code.indexOf(marker);
  if (end < 0) return "";
  const start = code.lastIndexOf("CASE WHEN", end);
  return start < 0 ? "" : code.slice(start, end);
}
function mirrorViolations(code: string): string[] {
  const v: string[] = [];
  if (!/lag\(\s*[\w.]+\s*,\s*1\s*,\s*1\.0\s*\)\s*OVER/.test(code)) v.push("lag");
  if (!/ln\(\s*GREATEST\(\s*1\.0\s*-\s*[\w.]+\.d::numeric\s*\/\s*[\w.]+\.n\s*,\s*1e-12\s*\)\s*\)/.test(code)) v.push("clamp");
  if (
    !/sum\(\s*[\w.]+\.cnt\s*\)\s*OVER\s*\(\s*PARTITION BY [\w.]+\.(?:tok|cat)\s+ORDER BY [\w.]+\.tt DESC\s+ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/.test(
      code,
    )
  )
    v.push("risk-set-desc");
  const lo = boundArm(code, "AS s_lo");
  const hi = boundArm(code, "AS s_hi");
  if (!lo || !/exp\(1\.96 \* sqrt\(/.test(lo) || /exp\(-1\.96/.test(lo)) v.push("s_lo-branch");
  if (!hi || !/exp\(-1\.96 \* sqrt\(/.test(hi)) v.push("s_hi-branch");
  if (!/sum\(\s*[\w.]+\.s_prev \* [\w.]+\.d_fill::numeric \/ [\w.]+\.n\s*\)\s*OVER/.test(code)) v.push("r-uses-s_prev");
  if (!/sum\(\s*[\w.]+\.s_prev \* [\w.]+\.d_relist::numeric \/ [\w.]+\.n\s*\)\s*OVER/.test(code)) v.push("x-uses-s_prev");
  if (/COALESCE\(\s*[\w.]*posted_at\s*,\s*[\w.]*first_seen\s*\)/i.test(code)) v.push("coalesced-origin");
  if (/interval\s+'7\s+days'/i.test(code)) v.push("seven-day-floor");
  if (!/min\(\s*[\w.]+\.tt\s*\)\s*FILTER \(WHERE [\w.]+\.tt <= 30/.test(code)) v.push("median-horizon");
  return v;
}

const CURVES: Array<{ fn: string; grain: "tok" | "cat"; file: string }> = [
  { fn: "get_company_fill_curve", grain: "tok", file: COMPANY_FILE },
  { fn: "get_category_fill_curve", grain: "cat", file: CATEGORY_FILE },
];

describe("still advertised at day 30 is published as a share, gated, and never past the cap", () => {
  it("found the definitions at all (guards the guard)", () => {
    expect(LIVE.size).toBeGreaterThan(50);
    for (const { fn } of CURVES) {
      expect(LIVE.get(fn), `${fn} has no live definition`).toBeTruthy();
      expect(PRIOR_DEFS.get(fn), `${fn} is not in ${PRIOR}`).toBeTruthy();
    }
    expect(LIVE.get("refresh_closure_population")).toBeTruthy();
  });

  for (const { fn, grain, file } of CURVES) {
    describe(fn, () => {
      const live = LIVE.get(fn)!;
      const prior = PRIOR_DEFS.get(fn)!;

      it("is live in the day-30 migration, one function per file", () => {
        expect(live.file).toBe(file);
        expect(definitionsIn(file).size, "the OUT-param guard slices one function per file").toBe(1);
      });

      it("carries every day-30 property against comment-stripped code", () => {
        expect(dayThirtyViolations(live.code, grain)).toEqual([]);
      });

      it("keeps every existing column byte-identical: RETURNS TABLE prefix and projection line", () => {
        const before = returnsTableLines(prior.raw);
        const after = returnsTableLines(live.raw);
        expect(before.length, "prior RETURNS TABLE not parsed").toBeGreaterThan(10);
        expect(after.slice(0, before.length)).toEqual(before);
        expect(after.length).toBeGreaterThan(before.length);
        for (const line of before) {
          const col = line.trim().split(/\s+/)[0];
          const was = projectionLine(prior.code, col);
          const now = projectionLine(live.code, col);
          expect(was, `prior projection for ${col} not found`).not.toBeNull();
          expect(now, `${col} lost its projection line`).toBe(was);
        }
      });

      it("still mirrors the reference estimator, over both chains", () => {
        expect(mirrorViolations(live.code)).toEqual([]);
        // The second chain is a real chain: its own DESC risk set and lag.
        expect(live.code).toMatch(/FROM agg30 a/);
        expect(live.code).toMatch(/lag\(s\.s, 1, 1\.0\) OVER \(PARTITION BY s\.(?:tok|cat) ORDER BY s\.tt\) AS s_prev\s+FROM surv30 s/);
      });

      it("still excludes the closed_at that is known to be late", () => {
        expect(live.code).toMatch(/absence_basis\s+IS\s+DISTINCT\s+FROM\s+'lap_backfill'/);
        expect(live.code).not.toMatch(/absence_basis\s*(?:<>|!=)\s*'lap_backfill'/);
      });

      it("names the cap, the floor and the gate in its COMMENT ON, and never the two forbidden words", () => {
        const sql = readFileSync(resolve(DIR, file), "utf8");
        const comment = sql.slice(sql.indexOf("COMMENT ON FUNCTION"));
        expect(comment).toMatch(/2026-08-07/);
        expect(comment).toMatch(/2026-09-06/);
        expect(comment).toMatch(/NULL -- not 1\.0/);
        expect(comment).toMatch(/full_read or lap_proven/);
        expect(comment).toMatch(/checked rather than asserted/);
        expect(comment).toMatch(/closure never means hired/);
        expect(comment).toMatch(/section 10/);
        expect(sql).not.toMatch(/\bghost/i);
        expect(sql).not.toMatch(/\bfake\b/i);
      });

      it("re-grants after the catalog drop, so the drop is not an outage", () => {
        const sql = stripSql(readFileSync(resolve(DIR, file), "utf8"));
        expect(sql).toMatch(new RegExp(`p\\.proname = '${fn}'[\\s\\S]*EXECUTE 'DROP FUNCTION ' \\|\\| r\\.sig::text;`));
        expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO anon, authenticated, service_role;`));
        expect(sql).toMatch(/RAISE EXCEPTION/);
        expect(sql.indexOf("DROP FUNCTION")).toBeLessThan(sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`));
      });
    });
  }

  describe("the observability table and the refresh that keeps it", () => {
    const refresh = LIVE.get("refresh_closure_population")!;
    const tableSql = readFileSync(resolve(DIR, TABLE_FILE), "utf8");
    const ddl = (sql: string) => {
      const m = /CREATE TABLE IF NOT EXISTS public\.job_board_board_observability \([\s\S]*?\);/.exec(stripSql(sql));
      return m ? m[0].replace(/\s+/g, " ") : "";
    };

    it("is written by the live refresh, in the same statement as the counts, and pruned", () => {
      expect(refresh.file).toBe(TABLE_FILE);
      expect(refresh.code).toMatch(/INSERT INTO public\.job_board_board_observability AS o \(company_token, bucket, lap_w0, as_of\)/);
      expect(refresh.code).toMatch(/FROM classed x\s+ON CONFLICT \(company_token\) DO UPDATE/);
      // The write and the counts read ONE classification: the INSERT is a CTE
      // of the SELECT ... INTO payload, not a second pass.
      const write = refresh.code.indexOf("INSERT INTO public.job_board_board_observability");
      const into = refresh.code.indexOf("INTO payload");
      expect(write).toBeGreaterThan(0);
      expect(write).toBeLessThan(into);
      expect(refresh.code).toMatch(/DELETE FROM public\.job_board_board_observability o\s+WHERE o\.as_of < v_as_of/);
      // The five buckets it writes are the five the readers gate on.
      for (const b of ["full_read", "lap_proven", "lap_pending", "unprovable", "unobserved"]) {
        expect(refresh.code).toMatch(new RegExp(`'${b}'`));
      }
    });

    it("has one DDL, spelled identically wherever it appears, with the five-bucket CHECK", () => {
      const owner = ddl(tableSql);
      expect(owner).toMatch(/CHECK \(bucket IN \('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved'\)\)/);
      expect(owner).toMatch(/company_token text PRIMARY KEY/);
      expect(ddl(readFileSync(resolve(DIR, COMPANY_FILE), "utf8"))).toBe(owner);
    });

    it("stays service-role only and the refresh stays revoked from anon by name", () => {
      const code = stripSql(tableSql);
      expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/);
      expect(code).toMatch(/REVOKE ALL ON public\.job_board_board_observability FROM anon, authenticated/);
      expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_closure_population\(\) FROM PUBLIC, anon, authenticated/);
      expect(code).not.toMatch(/GRANT[^;]*job_board_board_observability[^;]*TO[^;]*\banon\b/);
    });

    it("keeps the cached counts' keys so get_closure_population() is untouched", () => {
      for (const k of [
        "boards_full_read", "postings_full_read", "boards_lap_proven", "postings_lap_proven",
        "boards_lap_pending", "postings_lap_pending", "boards_unprovable", "postings_unprovable",
        "boards_unobserved", "postings_unobserved", "boards_first_lap", "first_lap_earliest",
        "closures_full_read", "closures_lap", "closures_lap_backfill", "closures_pre_basis",
      ]) {
        expect(refresh.code).toMatch(new RegExp(`'${k}',`));
      }
      expect(LIVE.get("get_closure_population")!.file).not.toBe(TABLE_FILE);
    });

    it("sorts after the function files it serves, and the table DDL sorts before them", () => {
      // The readers are validated at CREATE, so the DDL must already exist
      // when 217000 runs; the writer may come last.
      expect(COMPANY_FILE < CATEGORY_FILE && CATEGORY_FILE < TABLE_FILE).toBe(true);
      expect(readdirSync(DIR)).toEqual(expect.arrayContaining([COMPANY_FILE, CATEGORY_FILE, TABLE_FILE]));
    });
  });
});

/* ───────────────────────────── teeth ─────────────────────────────────────
   The checker re-run against the pre-fix spellings. A guard that cannot be
   shown to fail is a guard nobody has tested. */
describe("the day-30 checker can actually fail", () => {
  it("fires on the prior migration's bodies -- no floor, no gate, no identity, no columns", () => {
    for (const { fn, grain } of CURVES) {
      const v = dayThirtyViolations(PRIOR_DEFS.get(fn)!.code, grain);
      expect(v).toEqual(
        expect.arrayContaining([
          "column:still_open_30",
          "column:cohort_from",
          "d_ageout",
          "s30",
          "floor-constant",
          "floor",
          "bucket-gate",
          "reads-observability",
          "identity",
          "identity-gate",
          "constants",
        ]),
      );
      if (grain === "tok") expect(v).toContain("null-not-one:still_open_30");
      else expect(v).toContain("gate-in-risk-set");
    }
  });

  it("is not satisfied by the correct spellings appearing only in a COMMENT", () => {
    // The trap this repo has fallen into four times: the guard passes because
    // the strings it pins live in comments while the code beneath is the old
    // query. The fixture is the prior body with the entire new body appended
    // as comment lines.
    const { fn, grain } = CURVES[0];
    const commented = LIVE.get(fn)!.raw.split("\n").map((l) => `-- ${l}`).join("\n");
    const fixture = PRIOR_DEFS.get(fn)!.raw + "\n" + commented;
    // Against RAW the comment satisfies the floor and the gate...
    expect(dayThirtyViolations(fixture, grain)).not.toContain("floor-constant");
    expect(dayThirtyViolations(fixture, grain)).not.toContain("bucket-gate");
    // ...which is exactly why every code assertion runs comment-stripped.
    const v = dayThirtyViolations(stripSql(fixture), grain);
    expect(v).toEqual(expect.arrayContaining(["floor-constant", "floor", "bucket-gate", "identity", "constants"]));
  });

  it("fires when a day-30 column is published without the bucket CASE (the 1.0-by-construction leak)", () => {
    const code = LIVE.get("get_company_fill_curve")!.code.replace(
      /CASE WHEN ob\.admitted THEN round\(e30\.s30, 4\)\s+END\s+AS still_open_30/,
      "round(e30.s30, 4) AS still_open_30",
    );
    expect(dayThirtyViolations(code, "tok")).toContain("null-not-one:still_open_30");
  });

  it("fires when the field cohort is cut on a fixed 90 days while its arms are cut on p_days", () => {
    // The lane's first draft: at p_days < 90 the cohort's early takedowns left
    // the closure arm while its survivors stayed -- S(30) high, gate still true.
    const live = LIVE.get("get_category_fill_curve")!.code;
    const preFix = live.replace(
      "GREATEST((now() - make_interval(days => (SELECT w.d FROM win w)))::date + 1,",
      "GREATEST((now() - interval '90 days')::date,",
    );
    expect(preFix).not.toBe(live);
    const v = dayThirtyViolations(preFix, "cat");
    expect(v).toContain("floor");
    expect(v).toContain("window-bound");
    // And the company grain must carry the +1 edge too: the two grains print
    // one cohort_from for one day.
    const co = LIVE.get("get_company_fill_curve")!.code.replace("::date + 1,", "::date,");
    expect(dayThirtyViolations(co, "tok")).toContain("floor");
  });

  it("fires when the field age-out arm is censored on dark alone (one event, two verdicts)", () => {
    const live = LIVE.get("get_category_fill_curve")!.code;
    const preFix = live
      .replace(
        "LEFT JOIN bad_batch bb ON bb.tok = e.company_token AND bb.at = e.exited_at",
        "LEFT JOIN dark dk ON dk.tok = e.company_token AND dk.at = e.exited_at",
      )
      .replace(/CASE WHEN bb\.tok IS NOT NULL THEN 0\s+WHEN e\.exit_reason = 'aged_out'/, "CASE WHEN dk.tok IS NOT NULL THEN 0 WHEN e.exit_reason = 'aged_out'");
    expect(preFix).not.toBe(live);
    expect(dayThirtyViolations(preFix, "cat")).toEqual(expect.arrayContaining(["ageout-censor", "ageout-censor-join"]));
    // Dropping the CTE itself is caught on its own.
    expect(dayThirtyViolations(live.replace(/bad_batch AS \([\s\S]*?FROM dark d\s*\),/, ""), "cat")).toContain("bad-batch");
  });

  it("fires when the floor is hard-coded instead of derived from the named constant", () => {
    const code = LIVE.get("get_company_fill_curve")!.code.replace(
      "(SELECT kk.exits_origin_stamped_from FROM k kk) - 30",
      "DATE '2026-08-07'",
    );
    expect(dayThirtyViolations(code, "tok")).toContain("floor");
  });

  it("fires when the identity is asserted (dropped from the gate) rather than checked", () => {
    const code = LIVE.get("get_category_fill_curve")!.code.replace(
      /\s+AND abs\(e30\.r30 \+ e30\.x30 \+ e30\.s30 - 1\) <= 0\.000001/,
      "",
    );
    expect(dayThirtyViolations(code, "cat")).toContain("identity-gate");
  });

  it("fires when the field risk set stops gating on the bucket", () => {
    const code = LIVE.get("get_category_fill_curve")!.code.replace(" AND r.tt >= 0 AND r.admitted\n", " AND r.tt >= 0\n");
    expect(dayThirtyViolations(code, "cat")).toContain("gate-in-risk-set");
  });

  it("the byte-identity check fires on a one-character drift in an old column", () => {
    const live = LIVE.get("get_company_fill_curve")!;
    const drifted = live.code.replace("round(e.r14, 4)                              AS fill_rate_14", "round(e.r14, 3)                              AS fill_rate_14");
    expect(drifted).not.toBe(live.code);
    expect(projectionLine(drifted, "fill_rate_14")).not.toBe(projectionLine(PRIOR_DEFS.get("get_company_fill_curve")!.code, "fill_rate_14"));
  });
});
