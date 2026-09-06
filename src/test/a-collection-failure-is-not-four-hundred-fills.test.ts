import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A COLLECTION FAILURE IS NOT FOUR HUNDRED FILLS.
 *
 * WHAT BROKE. The collector already refused to log closures on a TRUNCATED
 * fetch (`windowed`: the vendor's own advertised total exceeded what we
 * actually pulled). That guard is blind to the other failure, which is the one
 * that costs us: a board answers HTTP 200 with a valid, nearly EMPTY list.
 * feedTotal then equals what we got, `windowed` is false, and every stored
 * posting for that employer is written into job_board_closures in the same
 * second. An outage in our collector becomes several hundred employer
 * takedowns, and nothing downstream can tell it from four hundred real fills.
 * It lands in the one table whose rows mean "the company took the role down",
 * next to the posting rows we have already hard-deleted.
 *
 * HOW IT WAS FOUND. Not by an alarm — nothing went red. It fell out of
 * measuring get_category_fill_speed: median_days_open of 14.9-16.3 across all
 * eighteen categories over ~600k closures, nursing and ML research agreeing to
 * within 1.4 days. Auditing why that number could not be a fact about the
 * labour market meant auditing what a "closure" row actually is, and the mass
 * same-second batches were sitting there in plain sight.
 *
 * WHY THE OBVIOUS FIX IS NOT THE FIX. The obvious fix is: detect the bad batch
 * and DON'T WRITE IT. That is wrong twice over.
 *
 *   1. The closure log is the only asset this product has that cannot be
 *      re-derived later. The postings it describes are hard-deleted; if a pass
 *      is not logged, that history does not exist anywhere, ever. Refusing to
 *      write is a permanent, unrecoverable loss taken on a heuristic.
 *   2. A wrongly-suppressed batch is worse than a wrongly-kept one, and the two
 *      are NOT symmetric. A missed dark feed writes rows we later doubt. A
 *      batch we refuse to write leaves the risk set ENTIRELY — the posting row
 *      is gone too, so the cohort is not censored, it is truncated. Truncation
 *      dressed up as caution is the exact defect this whole change exists to
 *      remove, rebuilt one table upstream.
 *
 * So the design is MARK, NEVER SUPPRESS. The batch is inserted whatever we
 * think of it, carrying `suspect` plus the two numbers that produced the doubt
 * (`batch_removed`, `batch_live_before`) so a reader can recompute the verdict
 * or overturn it. Exclusion happens at READ time, in every function that
 * publishes a fill statistic.
 *
 * That splits the property into three halves that can each rot independently,
 * which is why this file asserts all three:
 *
 *   (a) the collector COMPUTES the ratio and STAMPS all three columns, and the
 *       numbers it stamps are the numbers that decided — not some smaller
 *       written count, or the stored ratio disagrees with the stored verdict;
 *   (b) the collector does NOT skip the insert for a suspect batch;
 *   (c) every read path that publishes a fill statistic excludes suspect rows,
 *       and for the ~54 days of history written before the columns existed, the
 *       retroactive (company_token, closed_at) proxy stands in.
 *
 * (c) is enumerated FROM THE SQL, never from a list typed here, so a fill
 * statistic added next month without the filter fails in this file instead of
 * shipping.
 *
 * COMMENT-STRIPPED SOURCE FOR EVERY CODE ASSERTION. This repo has shipped a
 * guard that passed on a spelling appearing only in a COMMENT while the code
 * itself was dead seven separate times. Both SQL and TypeScript are stripped
 * of comments before any code claim is made against them, and SQL string
 * literals are stripped too — a `COMMENT ON FUNCTION ... IS '... suspect ...'`
 * is prose, and prose must never satisfy a code assertion. Prose claims (the
 * marked-never-suppressed contract) are asserted against RAW source, where they
 * belong.
 */

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const COLLECTOR = resolve(ROOT, "supabase/functions/job-board/index.ts");
const MODEL_DOC = resolve(ROOT, "docs/hiring-health-model.md");
const ALIBI_MIGRATION = resolve(
  MIGRATIONS,
  "20260906090000_a_closure_batch_must_carry_its_own_alibi.sql",
);

// ── source views ────────────────────────────────────────────────────────────

/** TypeScript, raw. Prose assertions only. */
const RAW = readFileSync(COLLECTOR, "utf8");
/** TypeScript, comments removed. EVERY code assertion runs against this. */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Strip SQL `--` comments, leading or trailing, without eating a `--` that
 *  lives inside a string literal (an odd number of quotes before it means we
 *  are inside one). */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      if (at < 0) return line;
      const before = line.slice(0, at);
      const quotes = (before.match(/'/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join("\n");
}

/** Additionally strip single-quoted literals. This is what defeats the trap
 *  the header names: `COMMENT ON FUNCTION ... IS '...suspect...'` is prose
 *  wearing SQL's clothes, and a function whose only mention of `suspect` is in
 *  its own documentation has no filter at all. */
const stripSqlProse = (sql: string) => stripSqlComments(sql).replace(/'(?:[^']|'')*'/g, "''");

// ── live function definitions ───────────────────────────────────────────────

/** Latest CREATE of each function. Lovable re-stamps migrations, so filename
 *  order is the only ordering available and a later file supersedes an earlier
 *  one. Same caveat as anon-facing-closure-readers-must-be-definer.test.ts:
 *  the last-sorting definition is the REPO's intent, not proof about
 *  production — a re-stamped hash-named file can sort earlier while carrying
 *  newer SQL. */
function latestDefinitions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(
      /CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\([\s\S]*?(?:\$\$|\$function\$);/g,
    )) {
      out.set(m[1], m[0]);
    }
  }
  return out;
}

/** Does this body treat a closure row as a FILL?
 *
 *  Stated as a property, not as a list of function names: a fill statistic is
 *  exactly one that has to hold RE-LISTINGS out, so it must contain a
 *  predicate or branch selecting the NON-superseded closures. A function that
 *  only ever asks `WHERE superseded` (get_repost_index, get_repost_churn_
 *  companies) publishes a relist figure and is not in scope here. */
const SELECTS_FILLS =
  /NOT\s+(?:COALESCE\s*\(\s*)?(?:\w+\.)?superseded|(?:\w+\.)?superseded\s+IS\s+NOT\s+TRUE|(?:\w+\.)?superseded\s*=\s*false|WHEN\s+(?:\w+\.)?superseded\s+THEN/i;

/** Any spelling of "this row's batch was doubted, drop it from the estimate".
 *  Kept as a SET of accepted forms rather than a bare mention of the word, so
 *  that `suspect` appearing as a column in a RETURNS list, or as a payload
 *  field, cannot be mistaken for an exclusion. If you write a new correct
 *  spelling, add it here — that is the intended maintenance, and it is cheaper
 *  than the alternative, which is a guard that accepts the word anywhere. */
const EXCLUDES_SUSPECT =
  /NOT\s+COALESCE\s*\(\s*(?:\w+\.)?suspect\s*,\s*false\s*\)|(?:\w+\.)?suspect\s+IS\s+NOT\s+TRUE|(?:\w+\.)?suspect\s*=\s*false|COALESCE\s*\(\s*(?:\w+\.)?suspect\s*,\s*false\s*\)\s*(?:OR|THEN)|NOT\s+(?:\w+\.)?suspect\b/i;

interface Reader {
  name: string;
  /** comments stripped, string literals kept — for literal-sensitive checks */
  body: string;
  /** comments AND string literals stripped — for every keyword claim */
  code: string;
  publishesFills: boolean;
  excludesSuspect: boolean;
  hasRetroProxy: boolean;
}

function closureReaders(defs: Map<string, string>): Reader[] {
  const out: Reader[] = [];
  for (const [name, def] of defs) {
    const body = stripSqlComments(def);
    const code = stripSqlProse(def);
    if (!/job_board_closures/.test(code)) continue;
    out.push({
      name,
      body,
      code,
      publishesFills: SELECTS_FILLS.test(code),
      excludesSuspect: EXCLUDES_SUSPECT.test(code),
      hasRetroProxy: /batch_live_before\s+IS\s+NULL/i.test(code),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The enumerated offenders: functions that count a closure as a fill and do
 *  not drop suspect batches. */
const unguardedFillReaders = (defs: Map<string, string>) =>
  closureReaders(defs)
    .filter((r) => r.publishesFills && !r.excludesSuspect)
    .map((r) => r.name);

/**
 * KNOWN GAPS, PINNED EXACTLY — this is a ledger, not an excuse.
 *
 * Both of these count non-superseded closures and publish the result to anon
 * (`/jobs`'s takedown ticker; `/hiring-trends`' weekly line), and neither drops
 * a suspect batch, so a dark feed inflates both. They are outside the migration
 * set this change ships — docs/hiring-health-model.md scopes the feed-dark
 * exclusion to the fill/health/benchmark/ghost-stats family — and fixing them
 * needs a migration, which the phase that wrote this file does not own.
 *
 * The ledger is asserted EXACT in both directions on purpose:
 *   - a NEW unguarded fill reader is not in it, so it fails here;
 *   - and when someone finally adds `AND NOT COALESCE(suspect, false)` to one
 *     of these two, this test fails as well, which is the prompt to delete the
 *     name rather than leave a stale exemption sitting in the repo forever.
 */
const KNOWN_UNGUARDED = ["get_hiring_trends", "get_takedowns_today"] as const;

// ── collector shape, read off comment-stripped TypeScript ───────────────────

/** The feed-dark ratio, located by its SHAPE rather than by variable names:
 *  `<numerator> > Math.max(5, 0.30 * <denominator>)`. Returns the three
 *  identifiers so the stamped columns can be checked against them. */
function batchGuard(code: string): { flag: string; numerator: string; denominator: string } | null {
  const m = /const\s+(\w+)\s*=\s*(\w+)\s*>\s*Math\.max\(\s*5\s*,\s*0\.30?\s*\*\s*(\w+)\s*\)/.exec(code);
  return m ? { flag: m[1], numerator: m[2], denominator: m[3] } : null;
}

/** Every identifier assigned to a given closure-row field, e.g. `suspect:`. */
function stampedWith(code: string, field: string): string[] {
  return [...code.matchAll(new RegExp(`\\b${field}\\s*:\\s*([A-Za-z_$][\\w$]*)\\b`, "g"))].map((m) => m[1]);
}

const CLOSURE_INSERT = /\.from\(\s*["']job_board_closures["']\s*\)\s*\.insert\(/;

/** Lines that open an `if` whose condition mentions `flag`. */
function conditionsMentioning(code: string, flag: string): string[] {
  return code
    .split("\n")
    .filter((l) => /^\s*(?:\}\s*else\s+)?if\s*\(/.test(l) && new RegExp(`\\b${flag}\\b`).test(l));
}

// ── the guard ───────────────────────────────────────────────────────────────

describe("a collection failure is not four hundred fills", () => {
  const defs = latestDefinitions();
  const readers = closureReaders(defs);

  it("found the sources and the functions it claims to be checking", () => {
    // A guard that silently checks nothing is the failure mode this repo keeps
    // re-discovering, so prove the inputs are real before asserting on them.
    expect(defs.size).toBeGreaterThan(20);
    expect(readers.length).toBeGreaterThan(8);
    for (const name of [
      "get_company_fill_curve",
      "get_category_fill_curve",
      "get_company_hiring_health",
      "get_employer_benchmarks",
    ]) {
      expect(readers.map((r) => r.name), `${name} must be found as a closure reader`).toContain(name);
    }
    expect(CODE).toMatch(CLOSURE_INSERT);
    expect(CODE.length).toBeGreaterThan(10_000);
  });

  // (a) the collector computes the ratio and stamps what decided it
  describe("the collector stamps the numbers that decided", () => {
    const guard = batchGuard(CODE);

    it("computes an absence share against max(5, 0.30 x the removable board)", () => {
      expect(
        guard,
        "no `<absent> > Math.max(5, 0.30 * <live before>)` in the collector: the " +
          "feed-dark ratio is the whole guard, and without it every dark pass is " +
          "logged as employer takedowns",
      ).not.toBeNull();
    });

    it("stamps suspect, batch_removed and batch_live_before on every row of the pass", () => {
      const g = guard!;
      // The verdict must be the guard's own flag (possibly ANDed with the
      // feed-came-back-short term — the collector requires both, which is
      // strictly more conservative than the ratio alone and is allowed).
      const suspectVars = stampedWith(CODE, "suspect");
      expect(suspectVars.length, "no `suspect:` field on the closure row").toBeGreaterThan(0);
      const verdict = suspectVars.find(
        (v) => v === g.flag || new RegExp(`const\\s+${v}\\s*=[^;\\n]*\\b${g.flag}\\b`).test(CODE),
      );
      expect(
        verdict,
        `the stamped suspect value must derive from ${g.flag}; found ${suspectVars.join(", ")}`,
      ).toBeTruthy();

      // THE STAMPED NUMBERS MUST BE THE NUMBERS THAT DECIDED. Stamping the
      // smaller written count instead of the pass's raw absence would make the
      // stored ratio disagree with the stored verdict on any pass where the
      // two-pass grace held ids back — an alibi that does not add up is worse
      // than none, because it invites a reader to "correct" a right call.
      expect(
        stampedWith(CODE, "batch_removed"),
        `batch_removed must be stamped with the guard's own numerator (${g.numerator})`,
      ).toContain(g.numerator);
      expect(
        stampedWith(CODE, "batch_live_before"),
        `batch_live_before must be stamped with the guard's own denominator (${g.denominator})`,
      ).toContain(g.denominator);
    });

    it("measures numerator and denominator over the same population", () => {
      // A freshness-cap wave inflates absence while producing ZERO closures
      // (those route to the exit ledger). Excluding age-outs from the numerator
      // alone is one-sided the wrong way: a 1,000-posting board that ages out
      // 600 and loses 250 more to a dark feed scores 25% and stays clean, where
      // against the 400 that could actually be removed it is 62%.
      const g = batchGuard(CODE)!;
      for (const v of [g.numerator, g.denominator]) {
        const decl = new RegExp(`\\b${v}\\b[\\s\\S]{0,400}?agedOutIds`).test(CODE)
          || new RegExp(`agedOutIds[\\s\\S]{0,400}?\\b${v}\\b`).test(CODE);
        expect(decl, `${v} must exclude this pass's freshness-cap age-outs`).toBe(true);
      }
    });

    it("stamps unconditionally, so a clean batch carries its alibi too", () => {
      // The three columns are the evidence that the call was made at all.
      // Stamping only the suspect rows would leave "no stamp" meaning both
      // "clean" and "written before the guard existed", and the read-time
      // proxy keys on exactly that distinction (batch_live_before IS NULL).
      const g = batchGuard(CODE)!;
      const stampIdx = CODE.indexOf(`batch_live_before: ${g.denominator}`);
      expect(stampIdx, "batch_live_before is not stamped from the guard's denominator").toBeGreaterThan(0);
      const enclosing = CODE.slice(Math.max(0, stampIdx - 2000), stampIdx);
      expect(
        new RegExp(`if\\s*\\([^\\n]*\\b${g.flag}\\b[^\\n]*\\)\\s*\\{[^]{0,2000}$`).test(enclosing),
        "the stamp sits inside a branch conditioned on the verdict",
      ).toBe(false);
    });
  });

  // (b) marked, never suppressed
  describe("a suspect batch is still written", () => {
    it("never skips the closure insert on the verdict", () => {
      const g = batchGuard(CODE)!;
      // No filter, no early exit, no ternary that swaps the rows out.
      for (const bad of [
        new RegExp(`if\\s*\\([^)\\n]*\\b${g.flag}\\b[^)\\n]*\\)\\s*\\{?\\s*(?:continue|return|break)`),
        new RegExp(`\\.filter\\([^)\\n]*\\b${g.flag}\\b`),
        new RegExp(`\\b${g.flag}\\b\\s*\\?[^\\n]*insert`),
        new RegExp(`!\\s*${g.flag}\\s*&&[^\\n]*insert`),
      ]) {
        expect(CODE, `the closure insert must not be gated on ${g.flag}`).not.toMatch(bad);
      }
    });

    it("uses the verdict for logging only, never for control flow over the insert", () => {
      const g = batchGuard(CODE)!;
      const conds = conditionsMentioning(CODE, g.flag);
      expect(conds.length, `expected exactly one branch on ${g.flag}; got ${conds.length}`).toBe(1);
      const at = CODE.indexOf(conds[0]);
      const branch = CODE.slice(at, at + 600);
      expect(branch, "the only branch on the verdict must be the warning line").toMatch(/console\.warn/);
      expect(branch, "the only branch on the verdict must not decide whether to insert").not.toMatch(
        CLOSURE_INSERT,
      );
    });

    it("records the marked-never-suppressed contract in prose (RAW source)", () => {
      // Prose against RAW, code against CODE — the reason is that this claim
      // IS a comment: it is the thing a future editor reads before deciding
      // that not writing a doubted batch would be tidier.
      expect(RAW).toMatch(/Marked,\s*never suppressed/i);
      expect(readFileSync(ALIBI_MIGRATION, "utf8")).toMatch(/The batch is still \*{0,2}inserted/i);
      expect(readFileSync(MODEL_DOC, "utf8")).toMatch(/The batch is still \*{0,2}written/i);
    });
  });

  // (c) every published fill statistic excludes them
  describe("every read path that publishes a fill statistic drops suspect batches", () => {
    it("enumerates the fill readers from the SQL, not from a list", () => {
      const fills = readers.filter((r) => r.publishesFills).map((r) => r.name);
      // Sanity: the estimator's own RPCs must be in the enumerated set, or the
      // classifier has drifted and the next assertion is checking an empty set.
      expect(fills).toContain("get_company_fill_curve");
      expect(fills).toContain("get_category_fill_curve");
      expect(fills).toContain("get_category_fill_speed");
      expect(fills).toContain("get_company_hiring_health");
      expect(fills).toContain("get_actively_hiring_companies");
      expect(fills).toContain("get_employer_benchmarks");
      expect(fills).toContain("refresh_ghost_stats");
      expect(fills.length).toBeGreaterThanOrEqual(8);
      // ...and functions that only ever publish RELIST figures must not be, or
      // the guard would be demanding a fill filter from a churn statistic.
      expect(fills).not.toContain("get_repost_index");
      expect(fills).not.toContain("get_repost_churn_companies");
    });

    it("no fill reader outside the pinned ledger is missing the filter", () => {
      const offenders = unguardedFillReaders(defs);
      expect(
        offenders.slice().sort(),
        "these count non-superseded closures as fills and do not exclude suspect " +
          "batches, so one dark pass publishes itself as employer fills. Either add " +
          "`AND NOT COALESCE(suspect, false)`, or — if it genuinely is not a fill " +
          "statistic — say why in KNOWN_UNGUARDED above",
      ).toEqual([...KNOWN_UNGUARDED].sort());
    });

    it("the ledger stays exactly two entries and shrinks when one is fixed", () => {
      for (const name of KNOWN_UNGUARDED) {
        const r = readers.find((x) => x.name === name);
        expect(r, `${name} is no longer a closure reader — delete it from the ledger`).toBeTruthy();
        expect(
          r!.excludesSuspect,
          `${name} now filters suspect — delete it from KNOWN_UNGUARDED, a stale ` +
            "exemption is how the next gap hides",
        ).toBe(false);
      }
    });

    it("the suspect filter is code, not documentation", () => {
      // The seven-times trap, stated directly: strip the COMMENT ON prose and
      // the filter must still be there. `get_category_fill_curve`'s COMMENT ON
      // says the word four times; that must count for nothing.
      for (const r of readers.filter((x) => x.publishesFills && x.excludesSuspect)) {
        expect(
          EXCLUDES_SUSPECT.test(stripSqlProse(r.code)),
          `${r.name}'s suspect filter survives only in prose`,
        ).toBe(true);
      }
    });
  });

  // (c, second half) the pre-column history
  describe("the retroactive proxy covers the history written before the columns", () => {
    const withProxy = readers.filter((r) => r.hasRetroProxy);

    it("the curve RPCs apply it", () => {
      const names = withProxy.map((r) => r.name);
      expect(
        names,
        "without the proxy the ~54 days of unstamped history is admitted whole, " +
          "and it is the era the feed-dark incident happened in",
      ).toContain("get_company_fill_curve");
      expect(names).toContain("get_category_fill_curve");
      expect(withProxy.length).toBeGreaterThanOrEqual(2);
    });

    it("applies only to unstamped rows, so it retires itself", () => {
      for (const r of withProxy) {
        expect(r.code, `${r.name}: the proxy must be scoped to batch_live_before IS NULL`)
          .toMatch(/batch_live_before\s+IS\s+NULL/i);
      }
    });

    it("keys on (company_token, closed_at) exactly, never an hour bucket", () => {
      // The collector computes ONE closed_at per board pass and reuses it for
      // every 200-row chunk, so the timestamp IS the batch id. Hour bucketing
      // was the original proposal and is strictly worse: the hot lane runs
      // several passes an hour, and merging distinct passes lets a run of small
      // legitimate takedowns add up past the threshold and delete real fills.
      for (const r of withProxy) {
        expect(r.body, `${r.name} groups its batch key by closed_at`).toMatch(
          /GROUP BY[\s\S]{0,200}?closed_at/i,
        );
        expect(
          r.body,
          `${r.name} buckets the batch key by hour — distinct passes merge and ` +
            "legitimate takedowns get deleted as one dark batch",
        ).not.toMatch(/date_trunc\(\s*'hour'\s*,\s*(?:\w+\.)?closed_at/i);
      }
    });

    it("thresholds at max(5, 0.30 x board size) with an absolute floor", () => {
      for (const r of withProxy) {
        expect(
          r.body,
          `${r.name}'s proxy must threshold on GREATEST(<floor>, 0.30 * <board size>)`,
        ).toMatch(/GREATEST\s*\(\s*\d+\s*,\s*0\.30?\s*\*/i);
      }
    });
  });

  // ── has teeth ─────────────────────────────────────────────────────────────
  //
  // Every check above is run against a synthesised PRE-FIX source and must
  // fail. A guard that cannot fire is worse than no guard, because it is read
  // as coverage.
  describe("has teeth", () => {
    it("fires on the pre-fix collector, which never computed the ratio", () => {
      const preFix = CODE.replace(
        /const\s+\w+\s*=\s*\w+\s*>\s*Math\.max\(\s*5\s*,\s*0\.30?\s*\*\s*\w+\s*\);/,
        "",
      );
      expect(preFix).not.toBe(CODE);
      expect(batchGuard(preFix)).toBeNull();
    });

    it("fires when the verdict is stamped but the numbers are not the deciding ones", () => {
      const g = batchGuard(CODE)!;
      // The tempting wrong stamp: the count actually WRITTEN, not the pass's
      // raw absence. Verdict and evidence then disagree on every graced pass.
      const drifted = CODE.replace(
        `batch_removed: ${g.numerator}`,
        "batch_removed: removedInBatch",
      );
      expect(drifted).not.toBe(CODE);
      expect(stampedWith(drifted, "batch_removed")).not.toContain(g.numerator);
    });

    it("fires when a suspect batch skips the insert", () => {
      const g = batchGuard(CODE)!;
      const suppressed = CODE.replace(
        /(\n(\s*))(const closureRows = )/,
        `$1if (${g.flag}) continue;$1$3`,
      );
      expect(suppressed).not.toBe(CODE);
      expect(suppressed).toMatch(
        new RegExp(`if\\s*\\([^)\\n]*\\b${g.flag}\\b[^)\\n]*\\)\\s*\\{?\\s*(?:continue|return|break)`),
      );
      expect(conditionsMentioning(suppressed, g.flag).length).toBeGreaterThan(1);
    });

    it("fires when the stamp itself is hidden behind the verdict", () => {
      // The other tempting wrong shape: stamp only the doubted rows. It looks
      // tidy and it destroys the read-time proxy, because `batch_live_before
      // IS NULL` would then mean "clean" as well as "predates the guard", and
      // the proxy would re-judge every honest batch we ever wrote.
      const g = batchGuard(CODE)!;
      const stamp = `batch_live_before: ${g.denominator}`;
      const conditional = CODE.replace(stamp, `${stamp} /*x*/`).replace(
        /(\n(\s*))(const closureRows = )/,
        `$1if (${g.flag}) {$1$3`,
      );
      const at = conditional.indexOf(stamp);
      const enclosing = conditional.slice(Math.max(0, at - 2000), at);
      expect(
        new RegExp(`if\\s*\\([^\\n]*\\b${g.flag}\\b[^\\n]*\\)\\s*\\{[^]{0,2000}$`).test(enclosing),
      ).toBe(true);
    });

    it("fires on a new fill reader that forgot the filter", () => {
      const forged = new Map(defs);
      forged.set(
        "get_field_fill_leaderboard",
        [
          "CREATE OR REPLACE FUNCTION public.get_field_fill_leaderboard(p_days int)",
          "RETURNS TABLE (category text, fills int)",
          "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public",
          "AS $$",
          "  SELECT c.category, count(*)::int",
          "  FROM public.job_board_closures c",
          "  WHERE c.closed_at >= now() - interval '90 days' AND NOT c.superseded",
          "  GROUP BY c.category;",
          "$$;",
        ].join("\n"),
      );
      expect(unguardedFillReaders(forged)).toContain("get_field_fill_leaderboard");
      expect(unguardedFillReaders(forged).slice().sort()).not.toEqual([...KNOWN_UNGUARDED].sort());
    });

    it("fires when the filter lives only in a COMMENT ON — the seven-times trap", () => {
      const forged = new Map(defs);
      forged.set(
        "get_field_fill_leaderboard",
        [
          "CREATE OR REPLACE FUNCTION public.get_field_fill_leaderboard(p_days int)",
          "RETURNS TABLE (category text, fills int)",
          "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public",
          "AS $$",
          "  -- suspect batches are excluded here",
          "  SELECT c.category, count(*)::int",
          "  FROM public.job_board_closures c",
          "  WHERE c.closed_at >= now() - interval '90 days' AND NOT c.superseded",
          "  GROUP BY c.category;",
          "$$;",
          "COMMENT ON FUNCTION public.get_field_fill_leaderboard(int) IS",
          "  'Fills by field. Rows in a batch marked suspect are excluded, and so '",
          "  'are relists: NOT COALESCE(suspect, false) is applied.';",
        ].join("\n"),
      );
      // RAW text would say the filter is there, twice over.
      expect(EXCLUDES_SUSPECT.test(forged.get("get_field_fill_leaderboard")!)).toBe(true);
      // Comment- and prose-stripped, it is not.
      expect(unguardedFillReaders(forged)).toContain("get_field_fill_leaderboard");
    });

    it("fires on the hour-bucketed proxy the design first proposed", () => {
      const hourly = readers
        .find((r) => r.name === "get_company_fill_curve")!
        .body.replace(/(\w+)\.closed_at\s+AS\s+at/i, "date_trunc('hour', $1.closed_at) AS at")
        .replace(/GROUP BY\s+(\w+)\.company_token,\s*\1\.closed_at/i, "GROUP BY $1.company_token, date_trunc('hour', $1.closed_at)");
      expect(hourly).toMatch(/date_trunc\(\s*'hour'\s*,\s*(?:\w+\.)?closed_at/i);
    });
  });
});
