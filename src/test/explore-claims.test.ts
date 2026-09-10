/**
 * EXPLORE WAS PUBLISHING THREE FALSE SENTENCES AND HIDING HALF A SECTION.
 *
 * Measured against production 2026-08-10:
 *
 *   get_size_segments() emits bands mega/large/mid/small, computed from
 *   GREATEST(on_board, feed_total) — a count of OPEN ROLES. The page asked for
 *   ["enterprise","mid","small"], labelled them by EMPLOYEE COUNT ("Enterprise
 *   — 1,000+ employees"), and blurbed "Every company here states its own
 *   headcount… Nothing is guessed."
 *
 *   Consequences, all three at once: `enterprise` never matched, so mega (212
 *   companies / 129,810 roles) and large (724 / 175,821) never rendered — 52%
 *   of the section and every recognisable large employer invisible; the two
 *   bands that did render carried role counts under headcount labels; and no
 *   row in the payload carries an employee field at all, so the sourcing
 *   promise described work nobody does. Epic Games rendered under "Startups &
 *   small teams — under 100 employees".
 *
 * Nothing errored. This is the same shape as tracking_days -> observed_days on
 * the Ghost Job Index and posted_coverage_pct before it: a renamed field does
 * not throw, it silently disables the thing gated on it, and an absence reads
 * as a deliberately withheld statistic.
 *
 * So these tests guard the CLASS, not the instance: the UI must derive its
 * bands from the payload, and no surface may promise headcount sourcing that
 * the SQL does not perform.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const EXPLORE = readFileSync(resolve(__dirname, "../pages/Explore.tsx"), "utf8");
/** Explore.tsx with comments stripped — assertions about what the code DOES
 *  must not be satisfiable (or defeated) by prose describing what it no longer
 *  does. Every removal note here names the thing it removed. */
const CODE = EXPLORE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const LOCALES = resolve(__dirname, "../i18n/locales");
const MIG = resolve(__dirname, "../../supabase/migrations");

/** The answers the page offers, PARSED FROM THE ARRAY IT ITERATES rather than
 *  retyped here. Every guard below that has to enumerate the answers reads this
 *  — a retyped list fixes the day's red and leaves the NEXT answer unguarded,
 *  which is how `scale` stayed in three lists after its section was deleted.
 *  Read off comment-stripped code so a removal note listing old ids cannot
 *  satisfy it. */
const INTENT_IDS = (): string[] => {
  const m = CODE.match(/const INTENTS: readonly Intent\[\] = \[([^\]]+)\];/);
  expect(m, "the INTENTS array literal moved — re-anchor, do not inline a list").toBeTruthy();
  const ids = [...m![1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  // TWO, NOT SEVEN. Five of the seven answers were twelve-employer
  // leaderboards holding 0.19% of the board and were deleted 2026-09-09; what
  // is left is the field grid (the default) and the employer check. The floor
  // is what makes the parse meaningful — a regex that matched nothing would
  // otherwise turn every loop below into a vacuous pass.
  expect(ids.length, "no intents parsed out of INTENTS").toBeGreaterThanOrEqual(2);
  return ids;
};

/** `heldFor`'s body — the ONE predicate that decides what the duration answer
 *  shows and what it holds back. Two tests below slice it, and both used to end
 *  the slice at `function rankedFillClaims`, which no longer exists: indexOf
 *  returned -1, `slice(start, -1)` handed back almost the whole file, and the
 *  `not.toBe("")` anchor check passed on it. The exclusion could have been
 *  deleted from heldFor and both tests would still have found the string
 *  further down. That is the repo's own -1 defect, so the slice is BOUNDED as
 *  well as located, and one helper serves both callers so a future rename is
 *  one edit rather than two. */
const gateSlice = (): string => {
  const start = CODE.indexOf("const heldFor =");
  expect(start, "the hiring gate moved — re-anchor, do not delete").toBeGreaterThan(-1);
  const end = CODE.indexOf("function rankedDurationClaims", start);
  expect(end, "the gate's end anchor is gone — re-anchor, do not widen").toBeGreaterThan(start);
  const gate = CODE.slice(start, end);
  expect(gate, "the hiring gate moved — re-anchor, do not delete").not.toBe("");
  expect(gate.length, "the gate slice is implausibly long — the anchor drifted")
    .toBeLessThan(3000);
  return gate;
};
const localeFiles = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));

/** The latest migration that DEFINES something matching `fragment`.
 *
 *  Matches only CREATE OR REPLACE definitions. It used to match ANY mention of
 *  "FUNCTION public.x", which broke the moment a migration merely ALTERed one:
 *  ALTER FUNCTION public.get_hiring_trends() SECURITY DEFINER made that file
 *  the "latest" hit, bodyOf then sliced for a $$ terminator that was not
 *  there, and four unrelated guards failed on a file containing no function
 *  body at all. A definition lookup has to ask for a definition. */
const latestWith = (fragment: string) => {
  const hit = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(resolve(MIG, f), "utf8"))
    .filter((t) => t.includes(fragment)).pop();
  if (!hit) throw new Error(`no migration contains: ${fragment}`);
  return hit;
};

/**
 * RE-HOMED, NOT DELETED. This describe used to assert that the size-band UI
 * derived its bands from the payload — because a renamed SQL band key does not
 * throw, it silently disables the thing gated on it, and mega+large (52% of the
 * section) rendered nothing for weeks.
 *
 * There is no size-segments section left to disable. Explore.tsx has no
 * `segments` state, no `orderedBands`, no `type Segments`, no `explore.seg*`
 * key and no get_size_segments call on either the cache path or the live
 * fallback; 20260908135000 drops the collection from refresh_explore_cache and
 * REVOKEs anon EXECUTE on every overload by catalog lookup, so the wrong-shaped
 * answer cannot even be asked for. The BANDS are gone; THE CLASS IS NOT.
 *
 * Its live instance is the check answer's feed column. get_company_suggest
 * returned (name, tokens) alone until 20260908136000, so every read of
 * `feed_total` resolved to undefined and the page told every single-board
 * reader "we hold no dated reading of this employer's own total" — a confident
 * falsehood about our own holdings, produced by exactly the same mechanism: an
 * absent column read as a fact rather than as our own deploy window. So the
 * class is asserted there, and the removal is pinned beneath it so the broken
 * section cannot come back by accident.
 */
describe("an absent payload column disables a claim, it never becomes one", () => {
  it("distinguishes a missing column from a missing reading", () => {
    // `!== undefined`, NOT a falsy check, and that distinction is the whole
    // guard: PostgREST sends a NULL column as a PRESENT key, so `undefined`
    // means the deployed function does not return the column at all — a fact
    // about our deploy, never about the employer. `!!h.feed_total` or
    // `h.feed_total ?? …` would fold a genuine null reading into the same
    // branch and re-create the falsehood.
    expect(CODE, "the feed column's presence must be the discriminator")
      .toMatch(/const hasFeedColumn = h\.feed_total !== undefined;/);
    expect(CODE, "a falsy check cannot tell an absent column from a null reading")
      .not.toMatch(/const hasFeedColumn = (?:!!|Boolean\(|h\.feed_total \?\?)/);
  });

  it("the sentence about the employer is gated on the column being there", () => {
    // Three outcomes, three sentences, and they must not borrow each other's:
    // a gap we can state, a multi-board employer we may not add up, and a
    // single-board employer we hold no dated reading for. The third is the one
    // that shipped as a falsehood, and it is the one that has to be gated.
    expect(CODE, "the unknown-total sentence is not gated on the column")
      .toMatch(/\{single && !feed && hasFeedColumn && \(/);
    for (const k of ["checkFeedGap2", "checkFeedMulti", "checkFeedUnknown"]) {
      expect(CODE, `explore.${k} is not rendered — the three-way split collapsed`)
        .toMatch(new RegExp(`t\\("explore\\.${k}"`));
    }
  });

  it("the size-band section stayed removed, in code and in the cache contract", () => {
    // Not nostalgia: the bands are cut on sum(on_board) while the card printed
    // max(on_board), so this section was WRONG rather than merely unused. The
    // removal is the fix, and a half-restored version — state back, renderer
    // gone — is how the silent-blanking defect returns.
    for (const dead of [/orderedBands/, /type Segments\b/, /t\("explore\.seg[A-Za-z]/, /get_size_segments/]) {
      expect(CODE, `the retired size-band section is back: ${dead}`).not.toMatch(dead);
    }
    // And a cache still carrying the collection must not raise a staleness
    // banner about a section that does not exist.
    expect(CODE, "the segments collection must stay on the retired list")
      .toMatch(/UNRENDERED_CACHE_PARTS[\s\S]{0,200}"segments"/);
  });
});

describe("no surface promises headcount the SQL never reads", () => {
  // Comments stripped. This assertion previously matched the phrase
  // "WAS GREATEST(sum(on_board), sum(feed_total))" inside a comment EXPLAINING
  // that the banding had changed — so it kept passing while asserting the
  // opposite of what the code did, and only failed once Lovable re-stamped the
  // migration and dropped the comments. A guard that a comment can satisfy is
  // not a guard.
  const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_size_segments").replace(/^\s*--.*$/gm, "");

  it("the RPC bands on the served count the labels name", () => {
    // The coupling this test exists to hold: bands are cut on what the board
    // serves, and the labels below say "open roles". If banding ever moves back
    // to the advertised feed total, the labels must move with it — that pairing
    // is what produced "1,000+ open roles" over companies averaging 597.
    expect(sql).toMatch(/sum\(on_board\)::int AS effective/);
    expect(sql, "banded on the advertised total again")
      .not.toMatch(/GREATEST\(sum\(on_board\), sum\(feed_total\)\)::int AS effective/);
    expect(sql).toMatch(/WHEN effective >= 1000 THEN 'mega'/);
  });

  it("no locale still ships a band label or a headcount promise at all", () => {
    // STRENGTHENED, NOT RETIRED. These were two loops of the shape
    // `const v = e[k]; if (!v) continue;` over keys the rebuild deleted from
    // all nine locale files — four green tests iterating nothing, which is the
    // "guard passes while the thing it describes is gone" shape this repo keeps
    // being bitten by. Absence is now asserted directly, which is strictly more
    // than the old "if it exists it must not say employees": a locale that
    // re-adds segMega saying anything at all fails here, and the section it
    // would label does not exist to render it.
    //
    // The original defect stays on the record: get_size_segments bands on a
    // count of OPEN ROLES, the page labelled the bands by EMPLOYEE COUNT, and
    // segBlurb promised "Every company here states its own headcount… Nothing
    // is guessed" over a payload with no employee field in it.
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of ["segMega", "segLarge", "segMid", "segSmall", "segOther", "segBlurb", "segTitle"]) {
        expect(e[k], `${f} still ships explore.${k} for a section that no longer exists`).toBeUndefined();
      }
    }
  });

  it("the retired enterprise label is gone everywhere, not just in English", () => {
    // A locale value overrides the inline default, so leaving it in eight
    // translations would keep the false label live for those readers — the
    // sources-note lesson.
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      expect(e.segEnterprise, `${f} still carries explore.segEnterprise`).toBeUndefined();
    }
  });
});

describe("the page does not fire a query that cannot finish", () => {
  it("no live get_transparent_employers call remains", () => {
    // 57014 on 100% of attempts, ~27s each, on every page view, for a section
    // that consequently never rendered.
    expect(EXPLORE).not.toMatch(/rpc\("get_transparent_employers"/);
  });

  it("the field grid AND its lifecycle curves are read from the cache instead", () => {
    // THE SAME LESSON, ON THE SECTION THAT REPLACED IT. get_transparent_employers
    // was 27s on every page view for a section that never rendered;
    // get_category_fill_curve is 44s and sits under every tile of the page's
    // DEFAULT view, so it is the one that would have cost the most. Both halves
    // are asserted, because the first shipped without the second: the page read
    // `field_curves` and fell back to the live RPC when the key was absent, and
    // no migration wrote the key — a fallback whose condition is permanently
    // true is not a fallback, it is the only path.
    // BOTH HALVES INVERTED IN THE GRID'S DESIGN PASS, and for opposite reasons.
    //
    //   field_curves — the field-grain lifecycle sentence it fed is gone. It
    //     read the same on most of the eighteen tiles (R(14) 0.128-0.243 as
    //     four strings; medians 27/28/29/30, the last four values before the
    //     estimator censors), and get_category_fill_curve does not filter
    //     absence_basis, so the first completed lap would have started pooling
    //     closures whose closed_at that column's COMMENT bars from any duration
    //     statistic. With no reader, this page must not even name the key.
    //
    //   field_grid, fields — the tile counts and their roll-up now come off the
    //     board's own category facet, in ONE read, out of the row the
    //     destination prints its own entry from. Reading the cache as well
    //     would restore the very defect the reach line was rebuilt to remove:
    //     one quantity, two crons, up to fifty-three minutes apart.
    //
    // The property that survives is the one this guard was really about — NO
    // 44-SECOND SCAN ON A PAGE VIEW — and it is now absolute rather than
    // deferred: the page does not run that query at all.
    // COMMENT-STRIPPED, because every removal on that page is documented in
    // prose that NAMES what it removed — a raw read would fail these on the
    // explanation rather than on the code, the mirror of the trap this file's
    // header describes.
    expect(CODE, "the 44-second scan is back on /explore").not.toMatch(/get_category_fill_curve/);
    expect(CODE, "the tiles are reading the explore cache again").not.toMatch(/obj\(c\.field_curves\)/);
    expect(CODE, "the tiles are reading the explore cache again").not.toMatch(/obj\(c\.fields\)/);
    // field_grid IS READ NOW — for the chips' coverage sentence, never for a
    // tile. The chips printed the BOARD's coverage beside a FIELD's count
    // (identical on every field: 23% on finance and design while the fields
    // really state a work mode on 30.5% and 38.1%), and the only per-field
    // reading on this board is the hourly grid's own filter counts over its
    // own n. The property this line used to protect — no tile number from the
    // cache — is asserted off a real render, with a wrong n fed to the grid,
    // in a-percentage-that-reads-the-same-on-every-field-is-not-a-field-
    // percentage.test.tsx.
    expect(CODE, "the coverage sentence reads the per-field scan; the tiles must not")
      .toMatch(/obj\(c\.field_grid\)/);
    // …and the three keys that lost their reader must not raise a staleness
    // banner about a collection this page does not render, while the one this
    // page DOES render discloses its staleness inside its own sentence.
    expect(EXPLORE).toMatch(/UNRENDERED_CACHE_PARTS[\s\S]{0,400}"fields", "field_curves", "totals"/);
    expect(EXPLORE).toMatch(/SELF_DISCLOSED_CACHE_PARTS = new Set\(\["field_grid"\]\)/);
    // COMMENT-STRIPPED, and the whole reason is in this file's own history: a
    // guard satisfied by prose describing what the code no longer does is the
    // failure this repo has shipped repeatedly. The header of that migration
    // names get_transparent_employers three times explaining why it left.
    // THE BODY, not the file, and not merely comment-stripped. The migration's
    // COMMENT ON is a SQL STRING LITERAL that names get_transparent_employers
    // while explaining why it left — a `--` strip does not touch it, and an
    // assertion satisfied (or failed) by prose describing what the code no
    // longer does is the failure this repo has shipped repeatedly.
    const refreshFile = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache");
    const refresh = refreshFile.slice(refreshFile.indexOf("AS $$"), refreshFile.indexOf("$$;"))
      .replace(/^\s*--.*$/gm, "");
    expect(refresh, "nothing writes the key the page reads").toMatch(/'field_curves', field_curves_v/);
    expect(refresh).toMatch(/public\.get_category_fill_curve\(90, 300\)/);
    expect(refresh).toMatch(/'field_grid', field_grid_v/);
    expect(refreshFile).toMatch(/'field_curves', field_curves_v/);
    // AND THE PAYLOAD THAT LOST ITS READER GOES WITH ITS SECTION.
    // get_explore_cache has exactly one consumer, so a key /explore does not
    // read is a key nothing reads — leaving the scan behind the deleted
    // renderer is the trending-and-newest failure, and it was 240s an hour.
    expect(refresh, "a deleted section's scan is still being paid for")
      .not.toMatch(/get_transparent_employers/);
    expect(refresh, "a deleted section's scan is still being paid for")
      .not.toMatch(/get_salary_benchmarks/);
    expect(EXPLORE, "the retired collections must not raise a staleness banner")
      .toMatch(/UNRENDERED_CACHE_PARTS[\s\S]{0,300}"transparent", "salary"/);
  });

  it("a slow collection cannot blank the others", () => {
    // The cache was all-or-nothing: one failing member aborted the INSERT and
    // froze every section with nothing saying so. Re-aimed at the block that
    // now costs the most and matters the most — the field grid feeds the page's
    // default view, so its failure is the one a reader would notice first.
    const fn = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache");
    expect(fn).toMatch(/field_grid_v jsonb := '\{\}'::jsonb;/);
    expect(fn).toMatch(/RAISE WARNING 'explore cache: field grid unavailable/);
    expect(fn).toMatch(/RAISE WARNING 'explore cache: field curves unavailable/);
  });
});

/**
 * Moving it to the cron did not make it work, and the reasons are two lessons
 * worth keeping. Measured against production 2026-08-10, as anon:
 *
 *   get_transparent_employers(12)  ->  500 / 57014 at 25.46s
 *
 * 25.46s, NOT the 90s the caller had set — proof that a function's own SET
 * clause overrides the caller's for the body's duration, so the wrapper's
 * `SET LOCAL statement_timeout = '90s'` was inert. And 57014 rather than 42501
 * proves anon still held EXECUTE on a query that pins a worker for half a
 * minute.
 */
describe("the cron call is shaped for what the function actually returns", () => {
  // Comments stripped: Lovable re-stamps applied migrations and drops comments,
  // so anything asserted here must be true of the CODE, not of prose about it.
  //
  // Sourced from refresh_explore_cache's own latest migration, not from
  // get_transparent_employers'. This block is about how the CACHE CALLS the
  // function, and the two stopped living in the same file the moment a later
  // migration redefined only the callee — at which point this assertion started
  // reading a file that never contained the call it was checking.
  const SQL = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache").replace(/^\s*--.*$/gm, "");
  const GRID = latestWith("CREATE OR REPLACE FUNCTION public.get_explore_field_grid").replace(/^\s*--.*$/gm, "");

  it("calls a scalar function as a scalar and a set-returning one in FROM", () => {
    // `SELECT jsonb_agg(row_to_json(x)) FROM <scalar fn>(…) x` parses fine —
    // Postgres treats a non-set-returning function in FROM as a one-row table —
    // and yields [{"x":{…}}]. A caller's shape gate passes on that and the
    // section renders one card with every field undefined; a timeout hid
    // exactly that bug here once.
    //
    // BOTH DIRECTIONS, because this ship added one of each.
    // get_explore_field_grid RETURNS jsonb and is assigned; get_category_fill_curve
    // RETURNS TABLE and must be read in FROM, or its rows never materialise.
    expect(SQL).not.toMatch(/FROM\s+public\.get_explore_field_grid/);
    expect(SQL).toMatch(/field_grid_v := COALESCE\(public\.get_explore_field_grid\(\), '\{\}'::jsonb\);/);
    expect(SQL).toMatch(/FROM public\.get_category_fill_curve\(90, 300\) c/);
  });

  it("still returns scalar jsonb — the premise the call shape depends on", () => {
    // If this ever becomes RETURNS TABLE the assertion above inverts. Asserted
    // against the CALLEE'S OWN migration, because the two stopped living in one
    // file the moment a later migration redefined only one of them.
    expect(GRID).toMatch(/FUNCTION public\.get_explore_field_grid\(\)\s*\nRETURNS jsonb/);
  });

  it("rejects a result of the wrong shape rather than publishing it", () => {
    const fn = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache");
    expect(fn).toMatch(/jsonb_typeof\(field_grid_v -> 'fields'\) <> 'object'/);
  });
});

describe("empty and failed are recorded as different things", () => {
  const fn = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache");

  it("the cache says WHY a collection is empty, rather than publishing the emptiness", () => {
    // `[]` meant both "nobody clears the bar" and "the query died" and looked
    // identical, which is why one failure survived weeks unnoticed. The
    // mechanism is now stale_parts plus carry-forward, and the field curves are
    // the sharp case: at FIELD grain this estimator passes comfortably —
    // eighteen rows, n_at_risk in the ten thousands — so an empty result is our
    // scan not answering, never a finding about the board. Publishing `{}`
    // would put "no closure record we can read for this field yet" under every
    // one of eighteen tiles on the strength of our own outage.
    expect(fn).toMatch(/IF field_curves_v = '\{\}'::jsonb THEN/);
    expect(fn).toMatch(/stale := stale \|\| 'field_curves'::text;/);
    expect(fn).toMatch(/field_curves_v := COALESCE\(prev -> 'field_curves', '\{\}'::jsonb\);/);
  });
});

describe("the query is made cheap and private, not merely patient", () => {
  const SQL = latestWith("CREATE OR REPLACE FUNCTION public.get_transparent_employers").replace(/^\s*--.*$/gm, "");

  it("gets a budget larger than the 25s that was actually binding", () => {
    const m = /RETURNS jsonb[\s\S]{0,300}?SET statement_timeout = '(\d+)(min|s)'/.exec(SQL);
    expect(m, "no statement_timeout on get_transparent_employers").toBeTruthy();
    const seconds = m![2] === "min" ? Number(m![1]) * 60 : Number(m![1]);
    expect(seconds).toBeGreaterThan(25);
    // Must stay inside refresh_explore_cache's own 10min ceiling, or a slow run
    // takes down the seven collections that already work.
    expect(seconds).toBeLessThan(600);
  });

  it("computes the median only for the rows it returns", () => {
    // percentile_cont is an ordered-set aggregate that sorts each group. It was
    // running for every qualifying company when at most 12 are ever returned —
    // that, not the grouping, is what cost 25s+.
    expect(SQL).toMatch(/LEFT JOIN LATERAL/);
    const beforeLateral = SQL.slice(0, SQL.indexOf("LEFT JOIN LATERAL"));
    expect(beforeLateral, "percentile_cont still runs before the LIMIT")
      .not.toMatch(/percentile_cont/);
  });

  it("counts only postings the board will actually serve", () => {
    // Both predicates, matching buildQuery and the sourcesFacet. Without them
    // the >=20 floor and the 80% ratio describe a population no reader can
    // reach — one quantity with two numbers.
    //
    // Sliced to the CTE that decides WHO QUALIFIES rather than searched
    // file-wide: the first version of this test asserted the strings appeared
    // anywhere, and passed with the qualifying filter deleted, because the
    // median LATERAL still carried its own copy. Caught by mutation, not by
    // reading.
    const agg = SQL.slice(SQL.indexOf("WITH agg AS ("), SQL.indexOf("top AS ("));
    expect(agg, "agg CTE not located").toContain("GROUP BY company_token");
    expect(agg).toMatch(/missing_since IS NULL/);
    expect(agg).toMatch(/effective_posted >= now\(\) - interval '30 days'/);

    // The median must be drawn from the same population it is reported beside.
    const lateral = SQL.slice(SQL.indexOf("LEFT JOIN LATERAL"));
    expect(lateral).toMatch(/p\.missing_since IS NULL/);
    expect(lateral).toMatch(/p\.effective_posted >= now\(\) - interval '30 days'/);
  });

  it("is no longer executable by anon", () => {
    // Nothing on a request path calls it; a 4-minute aggregate any anonymous
    // caller can start is a worker-exhaustion lever, not an API.
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.get_transparent_employers\(int\) FROM PUBLIC, anon, authenticated;/);
    const afterRevoke = SQL.slice(SQL.indexOf("REVOKE ALL ON FUNCTION public.get_transparent_employers"));
    expect(afterRevoke, "re-granted to anon after the revoke")
      .not.toMatch(/GRANT EXECUTE ON FUNCTION public\.get_transparent_employers\(int\) TO [^;]*anon/);
  });

  it("the dead drill-through is gone, not merely hidden", () => {
    // get_size_segment_companies 57014s on every band AND pages a different
    // population (headcount bands) than the section it sat under.
    //
    // Asserted against CODE with comments stripped: the removal note names the
    // RPC in prose, and the first version of this test matched that and
    // "failed" on a file that was already correct. A guard that cannot tell an
    // explanation from a call site is worse than no guard.
    expect(CODE).not.toMatch(/get_size_segment_companies/);
    expect(CODE).not.toMatch(/loadSegAll/);
  });
});

/**
 * EVERY COUNT ON EXPLORE MUST DESCRIBE WHAT THE BOARD WILL ACTUALLY SERVE.
 *
 * The board serves `missing_since IS NULL AND effective_posted >= now() - 30
 * days`. get_transparent_employers was corrected on 2026-08-10; its siblings
 * were not, so a card said "412 open now" and the /jobs/company page it links
 * to — which does apply both predicates — showed fewer.
 *
 * And the band headings were arithmetically false in a way that was my own
 * doing: the labels were changed from "1,000+ employees" to "1,000+ open roles"
 * while the banding stayed on GREATEST(on_board, feed_total), the company's own
 * ADVERTISED total. Measured live 2026-08-11: mega = 223 companies / 133,129
 * open roles = 597 per company, printed under "1,000+ open roles".
 */
describe("Explore counts only what the board serves", () => {
  const SERVED = /missing_since IS NULL/;
  const WINDOW = /effective_posted >= now\(\) - interval '30 days'/;

  // Functions that COUNT POSTINGS for a figure Explore renders. Trending and
  // newest are deliberately absent: their open_roles comes from
  // job_board_company_snapshots, so the fix belongs in the snapshot writer and
  // needs a backfill plan (trending is a difference across snapshot rows, so a
  // one-sided change fabricates a collapse for 7-14 days).
  const COUNTERS = [
    "get_size_segments",
    "get_actively_hiring_companies",
    "get_entry_level_companies",
    "get_salary_benchmarks",
    "get_transparent_employers",
  ];

  /** THAT function's body alone — from its header to its own closing `$$;`.
   *  Slicing merely from indexOf(name) runs to end-of-file, so a LATER
   *  function's predicates satisfy an earlier one's assertion: mutation-tested
   *  by deleting the predicates from get_size_segments, which the first version
   *  of this helper passed. Same defect as the transparent migration's
   *  serving-predicate test earlier the same day, made twice. */
  const bodyOf = (fn: string) => {
    const sql = latestWith(`CREATE OR REPLACE FUNCTION public.${fn}`).replace(/^\s*--.*$/gm, "");
    const start = sql.indexOf(`FUNCTION public.${fn}`);
    expect(start, `${fn} not found`).toBeGreaterThan(-1);
    const end = sql.indexOf("$$;", start);
    expect(end, `${fn} body has no terminator`).toBeGreaterThan(start);
    return sql.slice(start, end);
  };

  for (const fn of COUNTERS) {
    it(`${fn} applies both serving predicates`, () => {
      const body = bodyOf(fn);
      expect(body, `${fn} counts postings the board refuses to show`).toMatch(SERVED);
      expect(body, `${fn} has no 30-day window`).toMatch(WINDOW);
    });
  }

  it("the actively-hiring open-roles count is itself filtered", () => {
    // The figure beside a fill count originally came from a LATERAL with no
    // predicate at all. The function-level check above passes as soon as ANY
    // clause carries the predicates, so the open-roles source gets its own
    // assertion — whatever form it takes.
    //
    // That source is now the `open_now` CTE rather than a lateral: the lateral
    // is what forced the pool to be pre-truncated to 60 employers, which made
    // every small employer unrankable. This asserts the PREDICATES, which is
    // the invariant, rather than the mechanism, which was free to change.
    const body = bodyOf("get_actively_hiring_companies");
    const open = body.slice(body.indexOf("open_now AS ("), body.indexOf("fills AS ("));
    expect(open, "open_now CTE not located").toContain("GROUP BY company_token");
    expect(open).toMatch(SERVED);
    expect(open).toMatch(WINDOW);
  });

  it("the size-segments base CTE is itself filtered", () => {
    const body = bodyOf("get_size_segments");
    const co = body.slice(body.indexOf("WITH co AS ("), body.indexOf("named AS ("));
    expect(co, "co CTE not located").toContain("GROUP BY p.company_token");
    expect(co).toMatch(SERVED);
    expect(co).toMatch(WINDOW);
  });

  it("bands are cut on the same quantity the heading names", () => {
    const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_size_segments").replace(/^\s*--.*$/gm, "");
    // The label says "open roles ... on our board"; on_board is that number.
    expect(sql).toMatch(/sum\(on_board\)::int AS effective/);
    expect(sql, "banding back on the advertised feed total")
      .not.toMatch(/GREATEST\(sum\(on_board\), sum\(feed_total\)\)::int AS effective/);
  });

  it("remote_pct draws numerator and denominator from the same column", () => {
    // remote=true is a strict subset of work_mode='remote' (5.2%-11.3%
    // narrower), so mixing them makes the ratio one of two populations.
    const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_size_segments").replace(/^\s*--.*$/gm, "");
    expect(sql).toMatch(/count\(\*\) FILTER \(WHERE p\.work_mode = 'remote'\)::int AS remote_n/);
  });

  it("salary benchmarks still report per-currency, never a mixed median", () => {
    // The highest-SORTING migration for this function carries an older,
    // currency-less body; production emits `currency`. Lovable re-stamps old
    // content with new timestamps, so filename order does not track what is
    // deployed — rebuilding from the "latest" file would have silently reverted
    // per-currency medians and made "Never converted, never mixed" false.
    const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_salary_benchmarks").replace(/^\s*--.*$/gm, "");
    expect(sql).toMatch(/RETURNS TABLE \(category text, currency text, n integer, median_annual_min numeric\)/);
    expect(sql).toMatch(/GROUP BY category, salary_currency/);
  });
});

describe("Explore is reachable without a wide viewport", () => {
  const FOOTER = readFileSync(resolve(__dirname, "../components/Footer.tsx"), "utf8");
  const HEADER = readFileSync(resolve(__dirname, "../components/Header.tsx"), "utf8");
  const SHELL = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");

  it("the footer links /explore", () => {
    // The header wraps its ENTIRE nav in `hidden sm:flex` and the app has no
    // hamburger anywhere, so under 640px the footer is the only navigation that
    // renders. /explore was in neither: the page existed, was prerendered and
    // was sitemapped, and no phone could reach it by any link in the product.
    expect(FOOTER).toMatch(/to="\/explore"/);
  });

  it("the header nav is still viewport-gated, so the footer link is load-bearing", () => {
    // If a mobile menu ever lands this can relax — but until then, deleting the
    // footer link silently removes the only mobile path.
    expect(HEADER).toMatch(/hidden sm:flex/);
  });

  it("the prerendered shell links /explore", () => {
    // /explore is prerendered and sitemapped at priority 0.8 daily, but no
    // served page linked to it, so non-JS crawlers saw a sitemap-only orphan —
    // the condition Footer.tsx's own comment warns about.
    const shell = SHELL.slice(SHELL.indexOf("const shell ="), SHELL.indexOf("</footer>"));
    expect(shell).toMatch(/href="\/explore"/);
  });
});

describe("no locale ships a string the page cannot render", () => {
  it("the retired segment fields are gone from code and from all nine locales", () => {
    // get_size_segments' `top` object emits exactly company / company_token /
    // on_board / company_total. The 2026-07-27 rewrite dropped the
    // company_profiles join, taking employees / employee_basis / yc_batch with
    // it; the frontend kept reading them, so those branches were dead and
    // ycAbbrev never executed once. Four keys were translated nine times for
    // strings that could not appear.
    expect(CODE).not.toMatch(/r\.employees/);
    expect(CODE).not.toMatch(/r\.yc_batch/);
    expect(CODE).not.toMatch(/ycAbbrev/);
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of ["segEmp", "segBasisYc", "segBasisPr", "segYcChip"]) {
        expect(e[k], `${f} still ships explore.${k}`).toBeUndefined();
      }
    }
  });

  it("the capped re-post badge says as much as the uncapped one, in every locale", () => {
    // A locale VALUE overrides the inline t() default, and all nine defined
    // repostBadgeCapped as a bare "{{n}}+ re-lists of the same role" — dropping
    // the role title, the event total and the window that the uncapped badge
    // carries. The capped branch fires for the WORST re-posters, so the most
    // egregious employers got the least informative badge.
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      const capped = e.repostBadgeCapped;
      if (!capped) continue;
      for (const v of ["{{title}}", "{{events}}", "{{d}}", "{{n}}"]) {
        expect(capped, `${f} explore.repostBadgeCapped drops ${v}: ${capped}`).toContain(v);
      }
    }
  });

  it("every count in a shared sentence is grouped the same way", () => {
    // Rendered "3842 on our board · 12,000 company-wide" — one raw, one
    // grouped, in one sentence, because only `total` went through a formatter.
    //
    // RE-POINTED FROM `n: onBoard`, WHICH WENT WITH THE SIZE-BAND SECTION, AND
    // WIDENED FROM ONE SENTENCE TO THE CLASS. The live successor is
    // explore.openBoth on the duration card — "{{n}} roles open on our board ·
    // {{total}} on the employer's own feed" — exactly the old shape, plus five
    // more sentences carrying a count. Every one of them is found and every
    // COUNT-shaped interpolation in it must go through nf(); a new two-count
    // sentence added to this list is covered without editing the assertion.
    //
    // Percentages, spans and floors are deliberately not required to be
    // grouped: `pct`, `days`, `d`, `e`, `o` are bounded small numbers where a
    // separator would be noise, and forcing one would be a formatting opinion
    // rather than this guard's property.
    // RE-POINTED WITH THE PAGE, NOT SHRUNK. openBoth, transparentBadge,
    // entryBadgeShare and recycleEvidence belonged to the deleted employer
    // leaderboards; the sentences that carry counts now are the reach line, the
    // closure record's three denominators and the two employer-check numbers.
    // RE-POINTED AGAIN, AND AGAIN NOT SHRUNK. fieldsReach and fieldsReachWhole
    // were the reach fraction under the section header; the grid is a partition
    // of the board's own facet now, so a fraction of it could only read 100%.
    // The population sentence above the fold replaced both, and it carries the
    // same six-figure counts — basisWhole one, basisPartial three.
    // RE-POINTED ONCE MORE, STILL NOT SHRUNK: basisWhole/basisPartial took new
    // keys when the sentence stopped counting the uncategorised bucket as a
    // field (it interpolates BOARD_CATEGORY_SLUGS.length now) and stopped
    // claiming a board total /jobs publishes differently. basisCarried is the
    // third form of the same sentence, for counts carried through a failed
    // facet pass, and it carries {{n}} exactly as the other two do.
    // RE-POINTED ONCE MORE, AND AGAIN NOT SHRUNK. basisWhole2/basisPartial2/
    // basisCarried took THIRD keys when their mechanism clause changed meaning:
    // they said the bucket held "the roles whose field we could not read from
    // the title", which blames the employer's title for a coverage gap in OUR
    // OWN frozen rule set. And the grid became a list of rows with a bar on
    // each, which added three count-bearing sentences — barBasisAnchor (the
    // bucket the bars are measured against), barBasisSpread (the largest field
    // against the smallest, which is what the ratio actually divides) and
    // halfLine (where the cumulative count over the seventeen fields passes
    // half). All are covered here for the same reason as the
    // rest: a six-figure count rendered ungrouped is "639424" in a sentence.
    const COUNT_KEYS = ["basisWhole3", "basisPartial3", "basisCarried2",
                        "barBasisAnchor", "barBasisSpread",
                        "halfLine",
                        // closureBasis2 is GONE (its inSlice was always null, so
                        // it could never render) and closureFinding took a
                        // second key when it gained its 90-day window; the two
                        // partial-outage sentences interpolate a count of our
                        // own failed probes and are held to the same grouping.
                        "closureBasisNoTotal2", "closureFinding2", "closureOpen",
                        "closureOpenCapped", "fillOpen", "checkFeedGap2", "repostWarn",
                        "rolesPartial", "chipsPartial"];
    /** The whole `t("explore.<key>", …)` call, found by BALANCING PARENTHESES
     *  from the call's own bracket rather than by a fixed window. A fixed
     *  window is a guess about how long the thing being checked happens to be,
     *  and this file has already been bitten by one — `slice(i, i + 2200)`
     *  missed a card at offset 2352. */
    const callsFor = (key: string): string[] => {
      const out: string[] = [];
      const re = new RegExp(`t\\("explore\\.${key}"`, "g");
      for (let m = re.exec(CODE); m; m = re.exec(CODE)) {
        const open = CODE.indexOf("(", m.index);
        let depth = 0, i = open;
        for (; i < CODE.length; i++) {
          if (CODE[i] === "(") depth += 1;
          else if (CODE[i] === ")") { depth -= 1; if (depth === 0) break; }
        }
        expect(depth, `explore.${key} call has no closing bracket`).toBe(0);
        out.push(CODE.slice(m.index, i + 1));
      }
      return out;
    };
    let sites = 0;
    for (const key of COUNT_KEYS) {
      const calls = callsFor(key);
      expect(calls.length, `explore.${key} is not rendered — re-point this list, do not shrink it`)
        .toBeGreaterThan(0);
      for (const call of calls) {
        sites += 1;
        // DOUBLE-QUOTED LITERALS BLANKED FIRST. The English default is prose
        // and prose can look like an argument: explore.repostWarn opens
        // "Re-lists roles: {{events}} …", whose `roles:` matched the argument
        // scanner and reported the sentence itself as an ungrouped count. A
        // guard that reads its own copy as code is the mirror of a guard
        // satisfied by a comment.
        const args = [...call.replace(/"(?:[^"\\]|\\.)*"/g, '""')
          // WIDENED WITH THE NEW SENTENCES' OWN ARGUMENT NAMES. The closure
          // record's three denominators are `rows`, `asked` and `readable`, its
          // finding is `closers`, and the reach line's denominator is `board`;
          // none of those existed when this list was written, so leaving it
          // alone would have watched the six-figure numbers on the page go
          // ungrouped while the list still read as though it covered them.
          // AND WIDENED AGAIN with the population sentence's own names. The
          // reach fraction's `board` gave way to `all`, `tiled` and `untiled`
          // when the grid became a partition of the board's category facet and
          // a fraction of it could only ever read 100%.
          // AND WIDENED AGAIN with the bar sentences' own argument names.
          // barBasisAnchor carries topN, barBasisSpread carries smallN and
          // biggestN, halfLine carries above, fieldsTotal and below — six more
          // six-figure counts, every one of which would render ungrouped
          // without this. `ratio`, `k` and `rest`
          // are deliberately absent: they are bounded small numbers (34, 3, 14)
          // where a thousands separator would be noise, exactly like `pct` and
          // `days` above.
          .matchAll(/\b(n|total|open|entry|events|roles|rows|asked|readable|closers|board|all|tiled|untiled|topN|smallN|biggestN|above|below|fieldsTotal):\s*([^,\n]+)/g)];
        expect(args.length, `explore.${key} interpolates no count at all: ${call}`).toBeGreaterThan(0);
        for (const [, name, value] of args) {
          expect(value, `explore.${key} interpolates ${name} raw: ${value.trim()}`).toContain("nf(");
        }
      }
    }
    expect(sites, "count-bearing call sites not found — the finder broke").toBeGreaterThanOrEqual(9);
  });
});

/**
 * ONE ANSWER AT A TIME.
 *
 * Measured before this change: 31,935px (~40 screens), 120 company cards, ZERO
 * interactive controls, and six of eight sections rendering the same 12-card
 * grid differing only in sort order. The collections are unchanged and still
 * come from one cached row; what changed is that the reader picks which one is
 * on screen.
 */
describe("Explore offers a choice instead of forty screens", () => {
  it("renders the intent switcher, and it is wrapped rather than a scroller", () => {
    // A nowrap row hides half the options behind a swipe nobody knows to make —
    // the same class of defect as the header nav being `hidden sm:flex` with no
    // hamburger, which made this page unreachable on a phone entirely.
    expect(CODE).toMatch(/role="tablist"/);
    // Tolerant of the callback's arity: this asserts the chip row is rendered
    // from `shown`, not how many arguments the map callback happens to take.
    // It broke when an index param was added for arrow-key navigation — a
    // legitimate change failing a test that was pinned to a signature rather
    // than to the behaviour it cares about.
    // Mapped straight off INTENTS. The `shown` indirection existed to hold a
    // data-derived subset; the rebuild deleted the derivation outright, which
    // is strictly stronger — there is no data term left to get wrong — so the
    // assertion follows the construction rather than the variable name.
    expect(CODE).toMatch(/\{INTENTS\.map\(\(i(?:,\s*\w+)?\) =>/);
    const chips = CODE.slice(CODE.indexOf('role="tablist"'), CODE.indexOf("explore.searchAll"));
    expect(chips).toMatch(/flex flex-wrap/);
    expect(chips, "chip row must not be a horizontal scroller").not.toMatch(/overflow-x-auto|flex-nowrap/);
  });

  it("keeps every answer in the DOM, hidden — never conditionally unmounted", () => {
    // /explore is prerendered and sitemapped at priority 0.8 daily. Unmounting
    // five of six answers would drop ~90 company links out of the document for
    // crawlers and out of reach of Ctrl-F.
    //
    // DERIVED FROM INTENTS, NOT RETYPED. The old literal list named `scale`,
    // which is gone, and could not have named `check` or `aged`, which are new
    // — so retyping it would fix today's red and leave tomorrow's answer
    // unguarded. Parsing the array the page itself iterates means a new intent
    // added WITHOUT a hidden-gated body fails here, which is the property.
    const intents = INTENT_IDS();
    const hides = [...CODE.matchAll(/hidden=\{intent !== "(\w+)"\}/g)].map((m) => m[1]);
    for (const i of intents) {
      expect(hides, `no hidden-gated body for intent "${i}"`).toContain(i);
    }
    expect(hides, "an answer is gated on something other than the active intent")
      .toHaveLength(intents.length);
    expect(CODE, "an answer is conditionally unmounted rather than hidden")
      .not.toMatch(/\{intent === "\w+" && </);
  });

  it("the chosen answer is in the URL", () => {
    expect(CODE).toMatch(/searchParams\.set\("i", next\)/);
    // replaceState, not push: switching answers is not a navigation, and six
    // history entries would make the back button feel broken.
    expect(CODE).toMatch(/history\.replaceState/);
  });

  it("never offers an answer that would open empty, and never derives a control from data", () => {
    // TWO PROPERTIES, AND BOTH SURVIVED THE REBUILD UNDER A DIFFERENT
    // MECHANISM, so the assertions move to the new mechanism rather than being
    // deleted with the old one.
    //
    // (a) CONTROLS ARE NOT DERIVED FROM DATA. While the fetch is in flight every
    //     collection is empty, so availability is UNKNOWN, not false. Deriving
    //     the chips from it during load rendered two chips that then jumped to
    //     seven and pushed `active` to `check`, hiding the hiring skeleton for
    //     the whole 540ms it existed to cover. The old fix gated the derivation
    //     on `loading`; the rebuild removed the derivation, which is stronger —
    //     there is no data term left to get wrong. Pinned in its POSITIVE form,
    //     because "no availability record" alone would be satisfied by a page
    //     that derived the chips some other way.
    // THE DERIVATION IS GONE ENTIRELY, which is stronger than gating it: the
    // chip row maps INTENTS, a module constant, and the active answer IS the
    // state variable. Pinned in its positive form, because "no availability
    // record" alone would be satisfied by a page deriving the chips some other
    // way.
    expect(CODE, "the chip row must not be derived from any collection")
      .toMatch(/\{INTENTS\.map\(/);
    expect(CODE, "the active answer must not be derived from any collection")
      .toMatch(/const \[intent, setIntent\] = useState<Intent>\(DEFAULT_INTENT\);/);
    const derive = CODE.slice(CODE.indexOf('role="tablist"'), CODE.indexOf("explore.searchAll"));
    expect(derive, "a data term crept back into the chip row")
      .not.toMatch(/loading|available/);
    // `INTENTS.length` is the arrow-key modulo and is the CONSTANT's length, so
    // the ban is on a COLLECTION's length — the shape that made two chips
    // appear during load and then jump to seven.
    expect(derive, "a collection's length crept back into the chip row")
      .not.toMatch(/\b(fields|hiring|entry|salary|transparent|cHits|tiles)\.length/);
    expect(CODE, "the availability record is back — it cannot come back ungated")
      .not.toMatch(/available\[/);
    // (b) A CHIP MUST NEVER OPEN ONTO BLANK SPACE. Previously enforced by
    //     hiding the chip; now enforced by every answer owning a WRITTEN
    //     REFUSAL, so an empty collection is a sentence rather than a
    //     disappearance and the URL→answer mapping stays total. Without this
    //     half, the next answer added without a refusal ships a chip that opens
    //     onto nothing and no test goes red.
    const bodies = INTENT_IDS().map((id) => {
      const start = CODE.indexOf(`hidden={intent !== "${id}"}`);
      expect(start, `no hidden-gated body for "${id}"`).toBeGreaterThan(-1);
      const next = CODE.indexOf('hidden={intent !== "', start + 1);
      return [id, CODE.slice(start, next === -1 ? CODE.length : next)] as const;
    });
    for (const [id, body] of bodies) {
      // `fields` is exempt and only `fields`: it is a chip row of links that
      // always renders, with no collection behind it that can come back empty.
      if (id === "fields") continue;
      expect(body, `the "${id}" answer can open onto blank space — it owns no written refusal`)
        .toMatch(/<Refusal|explore\.checkNone/);
    }
  });

  it("the two provenance-flawed collections are gone from the page", () => {
    // Both took open_roles from job_board_company_snapshots, whose writer
    // applies neither serving predicate, so their badges could overstate what
    // the click-through shows. "Just added" also rested "get in early" on
    // first_added — the date WE discovered the board.
    expect(CODE).not.toMatch(/rows=\{trending\}/);
    expect(CODE).not.toMatch(/rows=\{newest\}/);
    expect(CODE).not.toMatch(/get_trending_companies/);
    expect(CODE).not.toMatch(/get_newest_companies/);
  });

  // REMOVED WITH THE THING IT MEASURED. "only one size band's cards render at a
  // time" pinned the size-band accordion (`const open = activeBand === band`),
  // which kept 36 of 48 cards out of the viewport while all four aggregates
  // stayed visible. There are no bands and no accordion; every surviving answer
  // is a flat twelve-card grid already gated by `hidden={active !== …}`, which
  // the test above asserts for every intent. The viewport concern has no
  // successor on this page, so there is nothing to re-home it onto — recorded
  // here rather than deleted silently, so a future accordion knows this guard
  // existed.

  it("the escape to /jobs sits with the chips, not at the bottom", () => {
    const head = CODE.slice(0, CODE.indexOf('hidden={intent !== "hiring"}'));
    expect(head, "the /jobs link must be above the answers").toMatch(/to="\/jobs"/);
    expect(CODE, "the old bottom CTA card should be gone").not.toMatch(/explore\.ctaLine/);
  });
});

describe("a card's number and the page it opens agree", () => {
  it("all /jobs links come from the single builder", () => {
    // Cards hardcoded `/jobs/company/{token}?from=explore` in six places, which
    // is how the entry-level badge promised 38 roles over a destination showing
    // 900. THE BUILDER CHANGED WITH THE PAGE: the twelve-card grids are gone
    // and every board link is now a JobSearchParams object mapped TWICE —
    // searchToBoardBody for the count, searchToQuery for the href — which is
    // the property that made the count and the destination one query.
    expect(CODE).toMatch(/import \{ searchName, searchToBoardBody, searchToQuery, type JobSearchParams \}/);
    // The wrapper takes a SECOND argument now — `back`, the address of the
    // slice the reader is leaving, so /jobs' Back-to-Explore returns them to
    // the panel rather than to a cold grid. It is not filter state and does not
    // touch the mapper; the property this guard is for is that the FILTERS
    // still arrive as one JobSearchParams object.
    expect(CODE, "the count and the link must come from one params object")
      .toMatch(/const toBoard = \(p: JobSearchParams, back\?: string\): string =>/);
    expect(CODE).toMatch(/searchToQuery\(p\)/);
    // NOT ONE HAND-BUILT BOARD URL. Template-literal /jobs hrefs are what this
    // guard exists to stop; the one exception is the closure link, which builds
    // a comma-separated `company` list through URLSearchParams and is checked
    // by its own guard for the 12-token cap Jobs.tsx round-trips.
    // EXACTLY ONE hand-built board URL: the closure link, which carries a
    // comma-separated `company` list the mapper has no field for. Pinned as a
    // COUNT so a second one cannot appear beside it unnoticed.
    const hand = [...CODE.matchAll(/to=\{`\/jobs\?/g)];
    expect(hand.length, "a board link was hand-built instead of mapped").toBe(1);
    expect(CODE).toMatch(/company: closure\.tokens\.join\(","\)/);
  });

  it("every board link carries the way back to Explore", () => {
    // Jobs.tsx renders its "Back to Explore" affordance only on `from=explore`.
    // The deleted employer cards spelled that param by hand; routing everything
    // through the shared saved-search mapper — which does not emit it, and
    // should not, being shared with /jobs itself — dropped it from every link
    // on the page. One wrapper owns the spelling.
    // THE SPELLING MOVED INSIDE THE WRAPPER; THE PROPERTY DID NOT. toBoard now
    // also carries `back` — the address of the exact slice the reader left, so
    // /jobs' Back-to-Explore returns them to the panel rather than to a cold
    // grid — so the tail is built with URLSearchParams instead of being
    // concatenated. What this guard is for is that ONE function owns the
    // spelling of from=explore and nothing bypasses it, which is asserted
    // directly below rather than by pinning a template literal.
    const tb = /const toBoard = [\s\S]{0,400}?\n\};\n/.exec(CODE)?.[0] ?? "";
    expect(tb, "the from=explore wrapper is gone").toBeTruthy();
    expect(tb, "the wrapper stopped emitting from=explore").toMatch(/from: "explore"/);
    expect(tb, "the wrapper stopped routing through the shared mapper").toMatch(/searchToQuery\(p\)/);
    const uses = [...CODE.matchAll(/to=\{(?:toBoard|fieldHref)\(/g)];
    expect(uses.length, "the wrapper exists but nothing routes through it").toBeGreaterThanOrEqual(4);
    expect(CODE, "a board link bypassed the wrapper that adds from=explore")
      .not.toMatch(/to=\{searchToQuery\(/);
    // A SECOND SPELLING NOW EXISTS, AND IT IS DELIBERATE. A field tile links to
    // /jobs/field/:id rather than /jobs?category=id, because only the lander
    // prints the field's own count — the generic board's hero prints the
    // BOARD-WIDE total over a one-field list. fieldHref is the ONE place that
    // route is spelled, it asks the destination's own predicate before using
    // it, and it falls back to the mapper for the uncategorised bucket, which
    // has no lander. Both halves carry from=explore.
    const fh = /const fieldHref = [\s\S]{0,400}?\n\};\n/.exec(CODE)?.[0] ?? "";
    expect(fh, "the field route is not spelled in one place").toBeTruthy();
    expect(fh, "the row does not ask the lander's own predicate").toMatch(/isBoardCategory\(id\)/);
    expect(fh).toMatch(/\/jobs\/field\/\$\{id\}\?\$\{tail\.toString\(\)\}/);
    expect(fh, "the lander branch stopped emitting from=explore").toMatch(/from: "explore"/);
    expect(fh, "the bucket with no lander must fall back to the mapper").toMatch(/toBoard\(\{ category: id \}, back\)/);
  });

  it("appends no filter Jobs.tsx does not read", () => {
    // `fresh` is WRITTEN by Jobs.tsx and never read back, so a fresh=day link
    // would promise a 24-hour window and deliver an unfiltered board.
    expect(CODE).not.toMatch(/fresh=day/);
    // THE PAY FLOOR IS ALLOWED NOW, AND ONLY IN ONE SHAPE. "states pay" and
    // "pays at least $X" are different populations over different columns —
    // salary_min_annual against salary_rank_usd — and the old rule banned the
    // floor outright because nothing on the page could disclose the difference.
    // The constraint chips can: each names the filterCoverage key for ITS OWN
    // column and prints the server's figure for it. So the floor may appear as
    // a chip bound to salaryFloor coverage, and nowhere else.
    // ONE, NOT TWO. The chip no longer names a coverage key of its own; the
    // floor's population is disclosed by the pay FAMILY, whose floorCol binds
    // salary_rank_usd's per-field count (pay_floor_n) and quotes it only when
    // it rounds differently from the stated-pay column.
    const floors = [...CODE.matchAll(/salaryFloor/g)];
    expect(floors.length, "the pay floor appears somewhere other than its own chip").toBe(1);
    expect(CODE).toMatch(/id: "pay80k", label: "\$80,000\+", patch: \{ salaryFloor: 80_000 \} \}/);
    expect(CODE, "the $80k chip is not bound to the floor column's per-field count")
      .toMatch(/floorCol: "pay_floor_n"[\s\S]{0,200}"pay80k"/);
    // And it must not be quoted against the wider column, which overstates a
    // floor's reach by about half again.
    expect(CODE, "a pay floor quoting the states-pay population overstates its reach")
      .not.toMatch(/floorCol: "stated_pay_n"/);
    expect(CODE).not.toMatch(/salaryFloor[^\n]*hasStatedPay/);
  });
});

describe("every interpolation a badge passes exists in every locale", () => {
  // THE LOCALE-OVERRIDE TRAP, guarded generically. A locale VALUE beats the
  // inline t() default, so a key whose translation omits {{open}} renders a
  // sentence with a hole in it — silently, in eight languages nobody on the
  // team reads. This is why the reworded badges got NEW keys.
  // RE-POINTED TO THE KEYS THE PAGE ACTUALLY RENDERS.
  //
  // `repostAcross` is referenced nowhere in Explore.tsx and was deleted from all
  // nine locales; its {{roles}} denominator — the clause that separates a
  // diagnosis from a libel — survives inside explore.repostWarn, which the
  // REQUIRED map in the last describe covers in every locale, so the property
  // did not lose a home.
  //
  // `entryBadgeRatio` was worse than stale: it is still DEFINED in all nine
  // locales while Explore.tsx has stopped referencing it, so this guard was
  // green over dead copy. The live badge is explore.entryBadgeShare, and it
  // carries a third placeholder the old one did not.
  const NEW_KEYS: Record<string, string[]> = {
    // RE-POINTED WITH THE PAGE. entryBadgeShare belonged to the deleted
    // beginner leaderboard; the sentences carrying interpolations now are the
    // reach line, the closure record's basis and finding, the lifecycle line
    // under a tile and the two employer-check numbers.
    // RE-POINTED AGAIN. fieldsReach was the reach fraction and fieldCurveMedian2
    // the field-grain lifecycle sentence; both are retired with the design pass
    // on the grid (a partition has no fraction to publish, and the lifecycle
    // line read alike on most of the eighteen tiles besides being about to pool
    // inadmissible lap_backfill closures). What carries interpolations in their
    // place is the one population sentence above the fold.
    // RE-POINTED, NOT SHRUNK. The pair took new keys when the sentence changed
    // meaning twice over: it interpolates the field count from
    // BOARD_CATEGORY_SLUGS.length instead of spelling "eighteen" (which also
    // counted the bucket the method panel says is not a field), and it claims
    // only what the facet proves rather than a board total /jobs publishes from
    // a different, separately-patched field. basisCarried is the same sentence
    // for counts carried through a failed facet pass -- it has no {{time}},
    // because the whole point of it is that the pass stamp is NOT when these
    // were counted; the time it does have rides basisCarriedWhen.
    // RE-POINTED A THIRD TIME. The three basis sentences took THIRD keys when
    // the clause describing the bucket changed meaning -- "the roles whose
    // field we could not read from the title" blames the employer's title for
    // a coverage gap in OUR OWN rule set, which categorize() has frozen at v9
    // by design -- and the grid became a list of rows with a bar on each, which
    // added the two sentences that explain what a bar's length means.
    basisWhole3: ["{{n}}", "{{fields}}", "{{time}}"],
    basisPartial3: ["{{tiled}}", "{{all}}", "{{untiled}}", "{{fields}}", "{{time}}"],
    basisCarried2: ["{{n}}", "{{fields}}", "{{when}}"],
    basisCarriedWhen: ["{{time}}"],
    barBasisAnchor: ["{{topLabel}}", "{{topN}}"],
    barBasisSpread: ["{{smallLabel}}", "{{smallN}}", "{{biggestLabel}}", "{{biggestN}}", "{{ratio}}"],
    halfLine: ["{{k}}", "{{above}}", "{{fieldsTotal}}", "{{rest}}", "{{below}}"],
    closureBasisNoTotal2: ["{{rows}}", "{{asked}}", "{{readable}}"],
    closureFinding2: ["{{closers}}", "{{readable}}", "{{min}}", "{{days}}"],
    checkFeedGap2: ["{{total}}", "{{when}}", "{{gap}}"],
  };
  // Every key here is checked in ALL NINE locale files. closureFinding2 was
  // minted on 2026-09-10 by the chip-coverage pass and the locale pass landed
  // in the same change, so there is no window to hold it to en/en-GB — a guard
  // left at that strength could never report the next dropped {{days}}.
  for (const [key, vars] of Object.entries(NEW_KEYS)) {
    it(`${key} keeps every placeholder in all nine locales`, () => {
      const files = localeFiles;
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
        expect(e[key], `${f} is missing explore.${key}`).toBeTruthy();
        for (const v of vars) {
          expect(e[key], `${f} explore.${key} drops ${v}: ${e[key]}`).toContain(v);
        }
      }
    });
  }

  it("every intent chip has a label in every locale", () => {
    // TWO HALVES, and only one of them is currently met.
    //
    // The retired-claim half IS safe: intentHiring ("Will actually hire me"),
    // intentGhost and intentScale were deleted from all nine locales in this
    // change, so no language can still advertise a claim the page stopped
    // making — which is exactly why the three renamed chips got NEW keys
    // instead of being edited in place.
    //
    // The reader's-language half is NOT met, and this guard is red on purpose
    // until it is: intentDuration, intentDates and intentAged exist in no
    // locale file, including en.json, so eight languages get an English chip.
    // All three carry inline defaults so nothing renders a raw key — a
    // degradation, not a defect — but the chip row is the page's navigation and
    // the exemption list below is for SENTENCES, not for controls. THE FIX IS
    // IN THE LOCALES, not in a widened exemption here: this change already
    // writes all nine files (it deletes ~25 retired explore keys from each), so
    // the premise that they are owned by another workflow does not hold for it.
    //
    // Keys are READ OFF THE INTENT_LABEL RECORD rather than retyped, so a chip
    // renamed again is covered without editing this list — the failure mode
    // that put `intentScale` in this list months after its section died.
    const at = CODE.indexOf("const INTENT_LABEL");
    expect(at, "the INTENT_LABEL record moved — re-anchor, do not inline a list").toBeGreaterThan(-1);
    const end = CODE.indexOf("\n  };", at);
    expect(end, "INTENT_LABEL has no terminator").toBeGreaterThan(at);
    const block = CODE.slice(at, end);
    expect(block.length, "the INTENT_LABEL slice is implausibly long — the anchor drifted")
      .toBeLessThan(1500);
    const keys = [...block.matchAll(/t\("explore\.(\w+)"/g)].map((m) => m[1]);
    expect(keys.length, "no chip labels parsed out of INTENT_LABEL")
      .toBe(INTENT_IDS().length);
    // searchAll is the escape hatch beside the chips and belongs to the same row.
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of [...keys, "searchAll"]) expect(e[k], `${f} is missing explore.${k}`).toBeTruthy();
    }
    // And the retired claims must not come back through a locale value, which
    // is the half that is already green and must stay that way.
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of ["intentHiring", "intentGhost", "intentScale"]) {
        expect(e[k], `${f} still carries the retired chip label explore.${k}`).toBeUndefined();
      }
    }
  });
});

describe("every per-answer action lands on a filter Jobs actually applies", () => {
  const JOBS = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

  it("Jobs reads ?fresh= from the URL, not only writes it", () => {
    // It was written on every change and never read back, so a shared "posted
    // today" link produced an unfiltered board. Explore's ghost answer was
    // going to link to it.
    expect(JOBS).toMatch(/const f = initial\.get\("fresh"\);/);
    expect(JOBS).toMatch(/f === "day" \|\| f === "week" \? f : ""/);
  });

  it("Jobs reads ?activelyHiring= from the URL", () => {
    expect(JOBS).toMatch(/useState\(initial\.get\("activelyHiring"\) === "1"\)/);
  });

  it("Jobs accepts a comma-separated company list, capped", () => {
    // The server has always taken an array here; the client only ever sent a
    // single-element one, so a collection could not be a destination. Verified
    // live: four tokens returned 5,491 rows with ignored=None.
    expect(JOBS).toMatch(/company\.split\(","\)/);
    expect(JOBS).toMatch(/\.slice\(0, 12\)/);
    expect(JOBS, "every request site must send the token list")
      .not.toMatch(/companies: company \? \[company\] : undefined/);
  });

  it("a multi-company filter renders as a count, not a wall of tokens", () => {
    expect(JOBS).toMatch(/companyTokens\.length > 1/);
    expect(JOBS).toMatch(/jobsPage\.companiesChip/);
  });

  it("Explore's links use only params Jobs reads", () => {
    // RE-AIMED AT THE MAPPER. The per-answer action buttons went with the
    // sections; every board link is now a JobSearchParams object, so the
    // question "does Jobs read this param?" is answered once, in
    // searchToQuery, rather than at each call site. What this guard checks is
    // that no call site went round it — the one hand-built URL left is the
    // closure link, and its keys are pinned here by name.
    const patchKeys = new Set([
      ...[...CODE.matchAll(/patch: \{ (\w+):/g)].map((m) => m[1]),
      // `[^}]*` stops at the FIRST brace, which is the spread's own closer in
      // `toBoard({ category: id, ...(role ? { q: role } : {}), ... })` — so the
      // keys after a conditional spread were never being read. Balanced from
      // the call's own bracket instead, and the trailing `back` argument (an
      // address, not a filter) is cut off with it.
      ...[...CODE.matchAll(/toBoard\(\{/g)].flatMap((m) => {
        const open = CODE.indexOf("{", m.index!);
        let depth = 0;
        let i = open;
        for (; i < CODE.length; i++) {
          if (CODE[i] === "{") depth += 1;
          else if (CODE[i] === "}") { depth -= 1; if (depth === 0) break; }
        }
        return [...CODE.slice(open + 1, i).matchAll(/(?:^|[\s,])(\w+):/g)].map((x) => x[1]);
      }),
    ]);
    expect(patchKeys.size, "no board-link params found — the finder broke").toBeGreaterThan(3);
    const READ_BY_JOBS = ["q", "location", "remote", "workMode", "company", "category",
      "includeUncategorised", "sendableOnly", "experience", "country", "salaryFloor",
      "maxAgeDays", "salaryCeiling", "payBasis", "hasStatedPay", "includeUnstatedPay",
      "maxYears", "department", "vendor", "employmentType", "excludeAgencies"];
    for (const k of patchKeys) {
      expect(READ_BY_JOBS, `Explore sends ${k} — confirm job-search-params maps it`).toContain(k);
    }
    // The one hand-built URL, and every key on it is a param Jobs round-trips.
    // ANCHORED BACKWARDS FROM THE LINK'S OWN TERMINATOR. Searching forwards for
    // the FIRST `new URLSearchParams({` in the file stopped being the closure
    // link the moment another one appeared above it (the /explore address this
    // page hands the board so the board can hand it back), and the slice then
    // spanned a thousand lines of unrelated object literals — every `word:` in
    // them read as a param this link sends.
    const closureEnd = CODE.indexOf("}).toString()");
    expect(closureEnd, "the hand-built closure link moved — re-anchor, do not widen").toBeGreaterThan(-1);
    const closure = CODE.slice(CODE.lastIndexOf("new URLSearchParams({", closureEnd), closureEnd);
    expect(closure.length, "the closure-link slice is implausibly long — the anchor drifted")
      .toBeLessThan(600);
    for (const k of [...closure.matchAll(/(\w+):/g)].map((m) => m[1])) {
      // `back` joins the allow-list: it is the /explore address the reader came
      // from, round-tripped by Jobs.tsx's lander rewrite and validated there as
      // a path on this site before it reaches an href.
      expect(["q", "category", "company", "from", "back"], `the closure link sends ?${k}=`).toContain(k);
    }
  });

  it("no action carries a count it cannot stand behind", () => {
    // The collection holds 12 rows, which is not the size of the population a
    // number would imply, and only a live aggregate could state the real one.
    const block = CODE.slice(CODE.indexOf("const ACTION"), CODE.indexOf("const INTENT_LABEL"));
    expect(block).not.toMatch(/\{\{n\}\}|\{\{count\}\}|\{\{total\}\}/);
  });
});

describe("the transparent-pay list is winnable by a recognisable employer", () => {
  const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_transparent_employers").replace(/^\s*--.*$/gm, "");
  const body = sql.slice(sql.indexOf("FUNCTION public.get_transparent_employers"), sql.indexOf("$$;"));

  it("ranks by roles stating pay, not by percentage", () => {
    // Ranking by percentage with LIMIT 12 gave every slot to 100%-of-~50-role
    // boards — measured live, all twelve were exactly 100% and the largest was
    // 267 roles — so a company stating pay on 95% of 4,000 could never place.
    expect(body).toMatch(/ORDER BY pay_n DESC, total DESC/);
    expect(body, "still ranking by percentage")
      .not.toMatch(/ORDER BY \(100\.0 \* pay_n \/ GREATEST\(total, 1\)\) DESC/);
  });

  it("the aggregate is ordered the same way it was selected", () => {
    // Otherwise the twelve chosen rows get re-sorted by a different rule than
    // the one that chose them.
    expect(body).toMatch(/ORDER BY t\.pay_n DESC, t\.total DESC/);
  });

  it("the 80% claim on the card is unchanged", () => {
    // The fix must change WHO is shown, never what the badge asserts.
    expect(body).toMatch(/HAVING count\(\*\) >= 20/);
    expect(body).toMatch(/100\.0 \* count\(\*\) FILTER \(WHERE salary IS NOT NULL\) \/ count\(\*\) >= 80/);
  });
});

describe("both copies of Explore's title describe the page that exists", () => {
  // /explore's title and description live in TWO places: Explore.tsx's <SEO>
  // for the client render, and scripts/prerender-seo.mjs for what crawlers
  // receive. Deleting the trending and newest collections corrected the first
  // and missed the second, so after deploy document.title read the new sentence
  // while the served HTML still advertised "Trending Companies" — a page
  // promising crawlers two sections it does not contain.
  const SHELL = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
  /** The WHOLE /explore entry — title, description, jsonLd AND the prerendered
   *  body — ending at the entry's own terminator rather than a fixed count.
   *
   *  This was `slice(i, i + 2200)`, and a "Fastest-growing boards" card sat in
   *  the prerendered BODY at offset 2352. Missed by 152 characters, so the
   *  guard passed while the served HTML advertised a collection deleted that
   *  morning — to exactly the audience that cannot run the JS proving
   *  otherwise. A fixed window is not a boundary, it is a guess about how long
   *  the thing you are checking happens to be, and it rots the moment anyone
   *  adds a line above the part that matters. */
  const entry = (() => {
    const start = SHELL.indexOf('path: "/explore"');
    expect(start, "/explore entry not found in prerender-seo.mjs").toBeGreaterThan(-1);
    const end = SHELL.indexOf("});", start);
    expect(end, "/explore entry has no terminator").toBeGreaterThan(start);
    const slice = SHELL.slice(start, end);
    // The body is what ships to crawlers, so it must be inside the slice — if
    // this ever fails the guard has silently stopped covering the thing it is for.
    expect(slice, "slice does not reach the prerendered body").toContain("content:");
    // HTML comments stripped as well as //. A removal note that NAMES the
    // removed collection is prose, and prose must not be able to fail — or
    // satisfy — an assertion about shipped markup. Twice today a guard read a
    // comment instead of code.
    return slice.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
  })();

  it("the prerendered copy names no deleted collection", () => {
    // WIDENED AFTER THE THIRD OCCURRENCE, which is the number that matters
    // here. Round one named only trending/newest, so it stayed green while the
    // prerendered /explore kept shipping "Companies that actually fill roles"
    // and "Serial re-posters" to crawlers. Round two added those, and stayed
    // green again while the served document advertised all FIVE employer
    // leaderboards over a page whose render is an eighteen-tile field grid —
    // because none of the five headings was in the pattern. Every heading this
    // page has ever deleted is named below; a future removal adds its own
    // alternative in the same commit, and the rule is that the pattern grows
    // when a section goes, never when a test goes red.
    //
    // AUDIT THIS PATH WITH A GOOGLEBOT UA, NEVER IN A BROWSER: a browser runs
    // the React render and cannot see the served document at all, which is how
    // two of these three occurrences survived a manual check.
    const GONE = new RegExp([
      // round one
      "Trending Companies", "trending boards", "fastest-growing",
      // round two
      "re-poster", "Who Fills Roles", "actually fill (the )?roles",
      "real fill signal", "Hiring at scale",
      // round three — the five twelve-card employer leaderboards, deleted
      // 2026-09-09 because they reached 0.19% of the board
      "How long do I have", "crossed day 30", "passed our 30-day cap",
      "Who states pay", "beginner (actually )?has a( real)? chance",
      "Where the pay is", "not what they look like", "Six answers",
      "recycles dates", "Explore Employers",
      // round four — the FIELD-GRAIN lifecycle line, deleted 2026-09-09 from
      // every tile and from the page face, because R(14) spanned 0.128-0.243
      // across eighteen fields and rendered as four strings, and because the
      // estimator was about to start pooling lap_backfill closures whose
      // closed_at the column's own COMMENT calls inadmissible. The slice-grain
      // closureRecordOf sentence STAYS and is deliberately not named here.
      "How [Ll]ong [Rr]oles [Ll]ast", "how long (its |these |the )?roles last",
      "clears the estimator's bar", "Half the roles we watched",
      "gone within (this many|N) days",
      // ...and the cadence claim that died with the same commit: the tiles
      // stopped coming off the hourly explore cache and now come off
      // refresh_job_board_facets (cron 7,22,37,52 * * * *).
      "measured in an hourly scan", "refreshed hourly",
    ].join("|"), "i");
    const code = entry.replace(/^\s*\/\/.*$/gm, "");
    expect(code, `prerender-seo.mjs still advertises a removed collection`).not.toMatch(GONE);
    // AND THE SAME PATTERN AGAINST /llms.txt, which exists to be QUOTED
    // VERBATIM by answer engines and was the second surface nobody claimed. Its
    // /explore bullet described "six answers about a board" — every clause of
    // it a deleted section, including the twelve-card framing the rebuild was
    // built to remove.
    const llms = readFileSync(resolve(__dirname, "../../public/llms.txt"), "utf8");
    const bullet = llms.split("\n").find((l) => l.includes("](/explore)")) ?? "";
    expect(bullet, "public/llms.txt no longer describes /explore at all").not.toBe("");
    expect(bullet, "public/llms.txt still advertises a removed collection").not.toMatch(GONE);
    // ...and it describes what the page IS, so the citation and the page agree.
    expect(bullet).toMatch(/field/i);
    expect(bullet, "the standing closure caveat must travel with the citation")
      .toMatch(/NEVER MEANS SOMEONE WAS HIRED/);
  });

  it("neither does the client-side copy, in any locale", () => {
    const GONE = /Trending Companies|hiring fastest|newly added/i;
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of ["seoTitle2", "seoDescription2", "subhead2", "subhead3"]) {
        if (e[k]) expect(e[k], `${f} explore.${k}`).not.toMatch(GONE);
      }
    }
  });

  /* A REGEX OVER ENGLISH CANNOT GUARD NINE LANGUAGES.
   *
   * Every prose pattern above is English, so it reads exactly one of the nine
   * locale files and is blind to the eight that carry the same claim in their
   * own words -- which is how "und wie lange Stellen bestehen" and "cuánto
   * duran las vacantes" would have survived a green round-four sweep of the
   * English copy.
   *
   * The language-independent fact is the KEY. A retired sentence takes a new
   * key (the standing rule at the top of Explore.tsx), and the old key must
   * then be DELETED from every locale rather than left orphaned: a locale
   * VALUE overrides an inline English default, so an orphaned key keeps the
   * retired claim one careless t() away from rendering in seven languages.
   * This assertion is mechanical, needs no translator, and cannot go stale. */
  /* THE FIELD COUNT IS INTERPOLATED, NOT SPELLED, IN EVERY LANGUAGE.
   *
   * "eighteen fields" was a hardcoded English word inside translated prose in
   * nine files, and it was wrong twice over: it counted the uncategorised
   * bucket as a field, which the page's own method panel denies in so many
   * words ("It is not a field") and the prerendered document contradicts
   * ("Seventeen fields plus the roles whose field we could not read"); and it
   * could not move. Adding a slug to BOARD_CATEGORY_SLUGS would have rendered
   * nineteen tiles under nine sentences still saying eighteen, with typecheck
   * and every other guard green, because the number lived only inside prose.
   *
   * The count now comes from BOARD_CATEGORY_SLUGS.length at render time. This
   * asserts the placeholder is present and no spelled-out count has crept back
   * -- which is a check a regex over English CAN make, because {{fields}} is
   * the same token in all nine files. */
  it("the field count in the basis sentence is interpolated, never spelled", () => {
    const SPELLED = /\b(sixteen|seventeen|eighteen|nineteen|twenty)\b/i;
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      // THIRD KEYS, same property. The clause naming the bucket changed
      // meaning (see the note on the mechanism clause), so the sentences were
      // re-minted rather than edited; the spelled-count ban follows them.
      // REQUIRED IN ALL NINE, not merely checked where defined: a "skip the
      // locales that lack it" clause makes the guard unable to notice the very
      // thing it exists for, and the locale pass has landed.
      for (const k of ["basisWhole3", "basisPartial3", "basisCarried2"]) {
        expect(e[k], `${f} explore.${k} is missing`).toBeTruthy();
        expect(e[k], `${f} explore.${k} must interpolate {{fields}}`).toContain("{{fields}}");
        // English spellings only -- the point is that nobody re-introduces the
        // literal in the source language and translates it outward again.
        if (f.startsWith("en")) {
          expect(e[k], `${f} explore.${k} spells a field count`).not.toMatch(SPELLED);
        }
      }
    }
  });

  it("a retired copy key survives in no locale, in any language", () => {
    const RETIRED: Array<[string, string]> = [
      // round four, 2026-09-09: the field-grain lifecycle claim
      ["explore", "seoTitle4"],      // "...and How Long Roles Last"
      ["jobsPage", "orientExplore"], // "...and how long its roles last"
    ];
    for (const f of localeFiles) {
      const doc = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")) as Record<string, Record<string, unknown>>;
      for (const [ns, key] of RETIRED) {
        expect(doc[ns]?.[key], `${f} still carries the retired key ${ns}.${key}`).toBeUndefined();
      }
    }
  });
});

/**
 * THE 0.34% GAP. Explore's six browsing answers surface 85 distinct employers;
 * the board carries 24,931. The lifecycle data that makes this product
 * different is tracked for all of them and was exposed only for the handful
 * that top a twelve-row list. The lookup covers the rest.
 */
describe("the employer lookup covers the whole board, honestly", () => {
  const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_company_suggest").replace(/^\s*--.*$/gm, "");
  // $$; anchored to the function start. Searching from 0 finds whichever
  // function is FIRST in the migration — two live in this one — which yielded a
  // negative slice and an assertion that could never match.
  const fnAt = sql.indexOf("FUNCTION public.get_company_suggest");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));

  it("never returns the facet count to the client", () => {
    // companiesFacet.count is count(*) GROUP BY company_token with NEITHER
    // serving predicate. It may rank and match; publishing it would put a
    // number on screen that the destination contradicts.
    //
    // RE-HOMED, NOT RELAXED. This asserted the whole RETURNS TABLE spelling
    // `(name text, tokens text[])`, which made it a guard against the function
    // returning ANYTHING — including the two counts the check answer states and
    // could not render without (20260908136000). The property it exists for is
    // narrower and is asserted directly: the facet count may rank and match, and
    // may not be returned.
    expect(body, "the facet count must not become a returned column")
      .not.toMatch(/\bc\b\s+AS\s|AS\s+facet_count|'count'\)::int\s+AS\s+open_roles/);
    expect(body, "the returned open count must apply BOTH serving predicates")
      .toMatch(/AS open_roles/);
    const openExpr = body.slice(body.indexOf("SELECT count(*)::int"), body.indexOf("AS open_roles"));
    expect(openExpr, "open_roles is not counted off job_board_postings").toMatch(/FROM public\.job_board_postings/);
    expect(openExpr, "open_roles drops the missing_since predicate").toMatch(/missing_since IS NULL/);
    expect(openExpr, "open_roles drops the freshness predicate").toMatch(/effective_posted >= now\(\) - interval '30 days'/);
    expect(CODE, "Explore must not render a count on a lookup result")
      .not.toMatch(/h\.count|hit\.count/);
  });

  it("the employer's own advertised total is never summed across boards", () => {
    // job_board_verifications is ONE ROW PER BOARD, UPSERTed on every fetch, so
    // it has no history: two boards' totals were read on two different days and
    // adding them makes a number with no date basis. The SQL refuses it, and so
    // does the page — two call sites for one rule, deliberately.
    expect(body).toMatch(/array_length\(m\.tokens, 1\) = 1 THEN v\.feed_total/);
    expect(body).toMatch(/array_length\(m\.tokens, 1\) = 1 THEN v\.verified_at/);
    expect(CODE).toMatch(/const single = h\.tokens\.length === 1;/);
    // And the stamp travels with the number, or neither is published.
    expect(body, "feed_total_at is the date basis and cannot be dropped").toMatch(/AS feed_total_at/);
  });

  it("matches off the cached facets row, and any aggregate it adds is bounded", () => {
    // A request-path aggregate over 605k postings is the 26s-per-view mistake.
    // The MATCH still touches one job_board_meta row and no table besides, so
    // the typeahead's ranking cost is unchanged; the postings count runs only
    // for the at-most-eight merged names that survive the LIMIT, keyed on
    // job_board_postings_company_token_idx. The property is the BOUND, not the
    // absence — asserting the absence is what would have kept the check answer
    // permanently unable to state its own numbers.
    expect(body).toMatch(/FROM public\.job_board_meta m/);
    expect(body).toMatch(/WHERE m\.k = 'facets'/);
    expect(body, "the merged-name set must be capped before anything is counted")
      .toMatch(/GROUP BY h\.name[\s\S]*?LIMIT 8/);
    expect(body, "an unbounded postings scan is back on the request path")
      .not.toMatch(/FROM public\.job_board_postings p\s*(?!\s*WHERE p\.company_token = ANY)/);
    expect(body).toMatch(/WHERE p\.company_token = ANY \(m\.tokens\)/);
  });

  it("merges an employer's several feeds into one row", () => {
    // PwC has four boards; four identical "PwC" rows is a worse answer than one.
    expect(body).toMatch(/GROUP BY h\.name/);
    expect(body).toMatch(/array_agg\(h\.token/);
  });

  it("enforces the 3-character floor server-side, not only in the input", () => {
    expect(body).toMatch(/length\(q\.s\) >= 3/);
  });

  it("the chip is always offered — it does not depend on the hourly cron", () => {
    // The facets row is written by the edge-function refresh pass. When pg_cron
    // died for five hours today every other answer froze; this one would not.
    //
    // `check: true,` was a member of the deleted `available` record. The
    // property is now met MORE broadly than the guard asked — no chip depends
    // on any collection — so the assertion moves to the construction that
    // supplies it rather than being dropped. Dropping it is what would leave
    // this chip one "only show the lookup when we have data" optimisation away
    // from breaking again.
    expect(CODE).toMatch(/INTENTS: readonly Intent\[\] = \["fields", "check"\];/);
    expect(CODE, "the chip row must not be derived from any collection")
      .toMatch(/\{INTENTS\.map\(/);
    // And the lookup's own body must sit outside every loading/length gate: it
    // is the one answer that can still be right when the cron is dead.
    const start = CODE.indexOf('hidden={intent !== "check"}');
    expect(start, "the check answer's body moved — re-anchor, do not delete").toBeGreaterThan(-1);
    const body = CODE.slice(start, CODE.indexOf('hidden={intent !== "', start + 1));
    expect(body.length, "the check body slice is empty or unbounded").toBeGreaterThan(200);
    expect(body, "the employer lookup was put behind the cache read")
      .not.toMatch(/\bloading\b|hiring\.length/);
  });

  it("says what is true when nothing matches, instead of an empty box", () => {
    expect(CODE).toMatch(/explore\.checkNone/);
    expect(CODE).toMatch(/cState === "ok" && cHits\.length === 0/);
  });

  it("a BROKEN lookup never renders as a claim about the employer", () => {
    // THE BUG THIS CAUGHT, live. With the RPC undeployed, searching "wegman"
    // printed "We don't carry that employer's job board" — a confident false
    // statement about a company with 498 open roles. supabase-js RESOLVES on a
    // PostgREST error rather than throwing, so `data === null` arrived in the
    // success path and a two-state boolean folded failure into absence.
    //
    // This is the defect the whole page has been paying down: a section that
    // timed out looked identical to a section with nothing to show.
    expect(CODE, "lookup state must be tri-state, not a boolean")
      .toMatch(/useState<"idle" \| "ok" \| "error">/);
    expect(CODE, "a non-array reply must be treated as failure, not emptiness")
      .toMatch(/if \(r\.error \|\| !Array\.isArray\(r\.data\)\) \{ setCHits\(\[\]\); setCState\("error"\); return; \}/);
    expect(CODE).toMatch(/cState === "error" &&/);
    expect(CODE).toMatch(/explore\.checkErr/);

    // And the two sentences must stay distinct in every locale — an error
    // message that borrows the not-carried wording re-creates the bug in
    // translation.
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      expect(e.checkErr, `${f} is missing explore.checkErr`).toBeTruthy();
      expect(e.checkErr, `${f} checkErr must not equal checkNone`).not.toBe(e.checkNone);
    }
  });

  it("queries on keystroke only, debounced — never on page load", () => {
    // THE END ANCHOR WAS DEAD AND THIS TEST WAS GREEN OVER NOTHING. `const
    // bands =` went with the size-segments section, so indexOf returned -1 and
    // the slice ran from the effect's first line to the END OF THE FILE: both
    // assertions below would have been satisfied by an `if (s.length < 3)` or a
    // `setTimeout(` anywhere in the remaining 900 lines, with the debounce
    // deleted. That is this repo's own "a closing bracket whose indexOf
    // returned -1" defect, live and passing.
    //
    // Re-anchored inside the effect's own scope, and BOUNDED as well as
    // non-empty, so the next dead anchor fails loudly instead of widening.
    const start = CODE.indexOf("const s = cq.trim();");
    expect(start, "the typeahead effect moved — re-anchor, do not delete").toBeGreaterThan(-1);
    const end = CODE.indexOf("}, [cq]);", start);
    expect(end, "the typeahead effect has no terminator").toBeGreaterThan(start);
    const block = CODE.slice(start, end);
    expect(block, "debounce block not located").not.toBe("");
    expect(block.length, "the debounce slice is implausibly long — the anchor drifted")
      .toBeLessThan(2000);
    expect(block, "the 3-character floor is gone from the client").toMatch(/if \(s\.length < 3\)/);
    expect(block, "the debounce is gone — this fires on every keystroke").toMatch(/setTimeout\(/);
  });
});

describe("the page the lookup points at answers honestly", () => {
  const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_company_hiring_health").replace(/^\s*--.*$/gm, "");
  // Anchored — see the note in the suggest block. get_company_suggest is
  // defined ABOVE this function in the same migration, so an unanchored search
  // returned its terminator and sliced backwards.
  const fnAt = sql.indexOf("FUNCTION public.get_company_hiring_health");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));

  it("open_roles applies BOTH serving predicates", () => {
    // It filtered only missing_since, so the card stated a bigger number than
    // the board it links to — on the page a reader opened to decide whether to
    // trust us.
    const live = body.slice(body.indexOf("live AS ("), body.indexOf("closed AS ("));
    expect(live).toMatch(/missing_since IS NULL/);
    expect(live).toMatch(/effective_posted >= now\(\) - interval '30 days'/);
  });

  it("tracking_days is per company, not the age of the whole closure log", () => {
    // `span` had NO company filter, so every employer reported the same window.
    // For a board carried a week that renders "90 days tracked, 0 filled", and
    // silence reads as a verdict.
    const span = body.slice(body.indexOf("span AS ("), body.indexOf("live AS ("));
    expect(span).toMatch(/c\.company_token = t\.t/);
    expect(span, "span must not scan the whole closure log unfiltered")
      .not.toMatch(/FROM public\.job_board_closures\s*\)/);
  });
});

/**
 * "WILL ACTUALLY HIRE ME" WAS A SIZE RANKING WEARING A LIFECYCLE BADGE.
 *
 * ORDER BY filled DESC ranks by the absolute number of roles closed, so the
 * answer to "who will actually hire me" was "the biggest employers". And the
 * candidate pool was pre-cut to the top 60 by raw fills BEFORE open roles were
 * known, so no small employer could place regardless of the final sort.
 */
describe("the hiring answer ranks by odds, not by size", () => {
  const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies").replace(/^\s*--.*$/gm, "");
  const fnAt = sql.indexOf("FUNCTION public.get_actively_hiring_companies");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));

  it("ranks on a bounded rate over a common window, not on a throughput ratio", () => {
    // THIS ASSERTION MOVED BECAUSE THE THING IT PINNED WAS WRONG, not because
    // the property changed. `filled * 100.0 / o.n` is closure throughput over
    // an inventory of open roles: unbounded (Accenture scored 2,496%), with a
    // different denominator per employer, and comparing an 11-day row with a
    // 50-day one as though their counts were one measurement. R(14) from
    // get_company_fill_curve is a share of the employer's own risk set at one
    // fixed horizon — bounded in [0,1], one denominator, one window.
    expect(body).toMatch(/ORDER BY cv\.fill_rate_14 DESC/);
    expect(body, "the throughput ratio is back — it is not a rate of anything")
      .not.toMatch(/ORDER BY \(f\.filled \* 100\.0 \/ o\.n\)/);
    expect(body, "ranked on absolute fills again — that is a size ranking")
      .not.toMatch(/ORDER BY f\.filled DESC, o\.n DESC\s*\n\s*LIMIT/);
    // Ties break toward the better-evidenced employer, not the bigger one.
    expect(body).toMatch(/\(cv\.fill_rate_14_hi - cv\.fill_rate_14_lo\) ASC/);
  });

  it("the nested fill-curve call is bounded, and by something", () => {
    // The first draft of the rewrite passed ARRAY(SELECT company_token FROM
    // fills) — every admissible employer — into a function whose own header
    // budgets it at ~200 tokens, with `LIMIT GREATEST(p_limit, 1)` applied in
    // the OUTER query afterwards. refresh_explore_cache calls this with
    // p_limit = 2000, so the outer limit bounded nothing and the 57014 this
    // migration exists to remove was still reachable on the one path whose
    // failure deletes the section.
    const curve = body.slice(body.indexOf("curve AS ("), body.indexOf("SELECT f.company"));
    expect(curve, "the curve is called with an unbounded token array")
      .toMatch(/LIMIT \d+\)\)/);
    expect(curve, "and the cut is ordered by evidence depth, not by board size")
      .toMatch(/ORDER BY a\.dated_n DESC/);
  });

  it("no longer pre-cuts the pool before open roles are known", () => {
    // The truncation, not the ORDER BY, is what made the tail unrankable.
    const fills = body.slice(body.indexOf("fills AS ("), body.indexOf("SELECT f.company"));
    expect(fills, "fills CTE still truncates before ranking")
      .not.toMatch(/LIMIT GREATEST\(p_limit, 1\) \* 3/);
  });

  it("counts open roles in one grouped scan, not a per-company lateral", () => {
    // The lateral is why the pre-truncation existed; removing it is what makes
    // ranking every qualifier affordable.
    expect(body).toMatch(/open_now AS \(/);
    expect(body).toMatch(/JOIN open_now o ON o\.company_token = f\.company_token/);
    expect(body, "lateral count is back — the pool will have to be cut again")
      .not.toMatch(/JOIN LATERAL/);
  });

  it("open roles use both serving predicates", () => {
    const open = body.slice(body.indexOf("open_now AS ("), body.indexOf("fills AS ("));
    expect(open).toMatch(/missing_since IS NULL/);
    expect(open).toMatch(/effective_posted >= now\(\) - interval '30 days'/);
  });

  it("floors the denominator high enough that the ratio means something", () => {
    // MEASURED, not chosen. The first draft floored at 10 and turned "ranks by
    // size" into "ranks by smallness" — every one of the top 12 had fewer than
    // 100 open roles, topped by 580% on a 10-role board. Measured across the
    // 300 top-filling employers (median open_roles = 21):
    //   floor  10 -> 12 of 12 cards under 100 open, top ratio 580%
    //   floor  50 ->  8 of 12 under 100 open, top ratio 456%
    //   floor 100 ->  0 of 12 under 100 open, top ratio 251%, 25+ eligible
    //   floor 150 ->  only 7 eligible, cannot fill twelve slots
    const m = /WHERE o\.n >= (\d+)/.exec(body);
    expect(m, "no open-roles floor on the ranking").toBeTruthy();
    const floor = Number(m![1]);
    expect(floor, "floor too low — a small denominator hands the list to tiny boards")
      .toBeGreaterThanOrEqual(100);
    // Above ~150 the eligible pool measured 7, which cannot fill a 12-row list.
    expect(floor, "floor too high — not enough employers qualify to fill the list")
      .toBeLessThanOrEqual(120);
  });

  it("the ranking ratio is never printed", () => {
    // "251 fills per 100 open roles" is true and reads as nonsense: it is a
    // throughput-to-inventory ratio, not a probability, and a reader would take
    // it as one. It sorts; the card states the two raw numbers instead.
    expect(CODE).not.toMatch(/per 100|fillRate|fillsPer/);
  });

  it("the published median comes from posted_at alone", () => {
    // COALESCE(posted_at, first_seen) is correct as a FILTER and is the
    // 2.8-day-median incident as a published number — it substitutes our
    // discovery time for the employer's posting date.
    const pct = body.slice(body.indexOf("percentile_cont"), body.indexOf("AS p50_days_open"));
    expect(pct).toMatch(/c\.closed_at - c\.posted_at/);
    expect(pct, "median computed over COALESCEd dates").not.toMatch(/COALESCE/);
  });

  it("tracking_days is per company, not the age of the whole closure log", () => {
    // Second place this defect was written; get_company_hiring_health carried
    // it until 20260811223000.
    expect(body).toMatch(/EXTRACT\(DAY FROM now\(\) - min\(c\.closed_at\)\)/);
    expect(body, "span CTE over the unfiltered closure log is back")
      .not.toMatch(/FROM public\.job_board_closures\s*\n\s*\),/);
  });

  it("the field-grain lifecycle line is gone, and no client here re-derives the estimator", () => {
    // THE GATE MOVED DOWN A GRAIN WITH ITS SECTION, AND THEN THE SECTION LEFT.
    // The field-grain lifecycle line was retired in the grid's design pass, for
    // two independent reasons:
    //
    //   IT DID NOT SEPARATE THE TILES. R(14) spans 0.128-0.243 across the
    //   eighteen fields and rendered as four distinct strings; the medians were
    //   27/28/29/30 — the last four values the estimator can emit before it
    //   censors at the support cap. Twelve tiles, four strings, one statement.
    //
    //   ITS INPUT WAS ABOUT TO STOP BEING ADMISSIBLE. get_category_fill_curve
    //   reads closed_at and does not filter absence_basis; a lap_backfill row's
    //   closed_at is barred by that column's own COMMENT from any duration,
    //   tenure or fill-speed statistic, and the first completed lap starts
    //   writing them.
    //
    // The estimator's thresholds are still pinned with their boundary proofs in
    // src/test/the-estimator-that-must-agree-with-arithmetic.test.ts, and the
    // client half of the gate now belongs to /jobs, which still publishes the
    // claim. What this file owns is the absence: no gate, because no claim.
    expect(CODE, "a fill claim has returned to /explore").not.toMatch(/\bcanStateFillRate\b/);
    expect(CODE, "the estimator's own thresholds were re-derived on the client")
      .not.toMatch(/n_at_risk_14\s*[<>]=|fills_le_14\s*[<>]=/);
    expect(CODE, "the field curve is being fetched again").not.toMatch(/get_category_fill_curve/);
    // /jobs still owns and applies the single predicate. Removing a claim from
    // one surface is not permission to loosen the gate on the other.
    const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
    expect(jobs).toMatch(/export function canStateFillRate/);
    expect(jobs).toMatch(/rpc\("get_category_fill_curve"\)/);
  });
});

describe("the page behaves while it is still loading, and for keyboard users", () => {
  it("shows tile-shaped placeholders instead of nothing", () => {
    // Before the cache read returns, a visitor saw a heading, chips and empty
    // space — which on this page is indistinguishable from a section that is
    // broken, and this page has earned that reading elsewhere. The grid the
    // skeleton stands in for changed from twelve employer cards to eighteen
    // field tiles; the property did not.
    // RE-ANCHORED WITH THE SOURCE, NOT DELETED. The grid's counts moved from
    // the hourly explore cache to the board's own category facet, so the thing
    // being waited on changed name; the property — tile-shaped placeholders
    // rather than empty space — did not. The condition also has to distinguish
    // "not read yet" from "read and failed", or a failed read would leave the
    // skeleton up for ever.
    expect(CODE).toMatch(/\{!facet && !facetFailed \? \(/);
    expect(CODE, "the placeholder must be tile-shaped, not a spinner")
      .toMatch(/animate-pulse/);
  });

  it("the skeleton is announced once, not as eighteen empty rows", () => {
    const at = CODE.indexOf("{!facet && !facetFailed ? (");
    expect(at, "the skeleton moved — re-anchor, do not delete").toBeGreaterThan(-1);
    const sk = CODE.slice(at, at + 900);
    expect(sk).toMatch(/role="status" aria-live="polite"/);
    expect(sk).toMatch(/aria-hidden="true"/);
  });

  it("the skeleton clears however the facet read answered", () => {
    // A LOADING FLAG THAT ONLY CLEARS ON SUCCESS LEAVES THE SKELETON UP FOR
    // EVER on the failure path. The state is now the ANSWER rather than a flag:
    // `facet` on success, `facetFailed` on failure, and the skeleton's
    // condition requires both to be empty — so there is no branch in which
    // neither is set once the read has resolved. readCategoryFacet itself
    // catches, so a throw resolves to null and takes the failure path.
    expect(CODE).toMatch(/if \(!f\) \{ setFacetFailed\(true\); return; \}/);
    expect(CODE).toMatch(/setFacet\(f\);/);
    const fn = /async function readCategoryFacet[\s\S]*?\n\}/.exec(CODE)?.[0] ?? "";
    expect(fn, "the facet reader is gone").toBeTruthy();
    expect(fn, "a throw must resolve to the failure path, not escape it")
      .toMatch(/\} catch \{\s*return null;\s*\}/);
  });

  it("role=tablist comes with the arrow keys it promises", () => {
    // Shipping the role without the keys is worse than shipping neither: a
    // screen reader announces "tab, 1 of 7" and the keys the user is then told
    // to press do nothing.
    expect(CODE).toMatch(/role="tablist"/);
    expect(CODE).toMatch(/e\.key === "ArrowRight"/);
    expect(CODE).toMatch(/e\.key === "ArrowLeft"/);
    // Roving tabindex, so Tab enters the group once rather than stopping on
    // every chip.
    expect(CODE).toMatch(/tabIndex=\{intent === i \? 0 : -1\}/);
  });
});

describe("no number is published without the sample behind it", () => {
  it("the measured-at date renders in the reader's language", () => {
    // toLocaleString(undefined) resolves to the BROWSER's locale, which is
    // independent of the language the reader picked — so the one visible date
    // on a German page rendered in English, inside a German sentence.
    expect(CODE).toMatch(/toLocaleString\(i18n\.language/);
    expect(CODE, "date still uses the browser locale").not.toMatch(/toLocaleString\(undefined/);
  });

  it("the pay-median section is gone, and so is the arithmetic behind it", () => {
    // WHAT THIS GUARD USED TO PROTECT, AND WHY IT MOVED. The SQL medianed
    // whichever roles state USD pay with no floor, so ONE USD posting was
    // enough to publish "median floor $X" for an employer whose other 300 roles
    // say nothing; the fix was a PAY_MEDIAN_MIN_USD_N floor tested BEFORE the
    // null median, so the refusal outlived the number it refused.
    //
    // The section is deleted — twelve employer cards over a 965,897-posting
    // board — and the rule this page enforces on itself is that a removed
    // section's COMPUTATION goes with it, because arithmetic with no rendered
    // sentence is a number waiting to be re-rendered by someone who does not
    // know why it left. So the assertion inverts: the gate, its constant, its
    // column and the cache block that fed it must all be absent, and a
    // re-render cannot happen quietly.
    expect(CODE, "the pay-median claim builder came back without its section")
      .not.toMatch(/PAY_MEDIAN_MIN_USD_N|median_usd_floor|usd_n/);
    const refreshFile = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache");
    const body = refreshFile.slice(refreshFile.indexOf("AS $$"), refreshFile.indexOf("$$;"))
      .replace(/^\s*--.*$/gm, "");
    expect(body, "the cron still pays for a payload with no reader")
      .not.toMatch(/get_transparent_employers|get_salary_benchmarks/);
  });
});

describe("the page says when it was measured", () => {
  it("renders the stamp on the row the counts came out of", () => {
    // THE DATE BASIS FOLLOWED THE NUMBERS. It used to be the hourly explore
    // cache's `computed_at`, because the tiles were drawn from that cache. They
    // are drawn from the board's own category facet now, and the honest stamp
    // is that reply's `refreshedAt` — the row the eighteen counts were grouped
    // into. Keeping the cache's timestamp over facet counts would have been a
    // date basis belonging to a different scan, which is the exact failure the
    // reach line was rebuilt to remove.
    expect(CODE, "the page dates its counts from a scan they did not come from")
      .not.toMatch(/setComputedAt\(c\.computed_at\)/);
    expect(CODE).toMatch(/refreshedAt/);
    // `facet.at`, no longer `facet?.at`. The optional chain was the shape of
    // the bug beside it: `at` used to be nullable and the sentence interpolated
    // it as "" when absent, publishing eighteen exact six-figure integers under
    // "counted  in the board's own scan". readCategoryFacet now refuses a
    // stamp-less row outright, so `at` is a plain string and the sentence
    // cannot render without one.
    expect(CODE).toMatch(/facet\.at/);
    expect(CODE, "a missing stamp must fail the read, not render an empty date")
      .not.toMatch(/facet\?\.at \? new Date/);
    // basisWhole2 / basisPartial2 / basisCarried, NOT asOfCounts2 and NOT
    // asOfCounts. The keys are re-minted whenever the sentence's MEANING
    // changes -- it no longer dates an hourly cache, it carries the population,
    // it interpolates the field count rather than spelling it, and it has a
    // third form for counts carried through a failed facet pass. A locale VALUE
    // beats an inline default, so editing an older key in place would have left
    // eight languages asserting a basis this page stopped having.
    expect(CODE).toMatch(/t\("explore\.basis(?:Whole3|Partial3|Carried2)"/);
    // basisWhole2/basisPartial2/basisCarried join the dead list: their
    // mechanism clause blamed the employer's title for a coverage gap in our
    // own frozen rule set, so they were re-minted rather than edited in place.
    for (const dead of ["asOfCounts", "asOfCounts2", "basisWhole", "basisPartial",
                        "basisWhole2", "basisPartial2", "basisCarried"]) {
      expect(CODE, `the retracted ${dead} sentence is being called again`)
        .not.toMatch(new RegExp(`t\\("explore\\.${dead}"`));
    }
  });

  it("only with a real reading — no facet, no claim", () => {
    // The sentence renders only when the facet answered, and a failed read gets
    // its OWN sentence rather than silence: eighteen tiles with no numbers and
    // no explanation reads as a broken page, and the links all still work.
    // `reach && facet &&`. The second conjunct is redundant at runtime (reach is
    // null whenever facet is) and is written so the compiler can see that
    // facet.at exists on this branch -- which makes the stamp's presence a
    // type-level fact on the one sentence obliged to carry it.
    expect(CODE).toMatch(/\{reach && facet && \(/);
    expect(CODE).toMatch(/\{facetFailed && \(/);
    expect(CODE).toMatch(/t\("explore\.basisNone"/);
  });

  it("no surface still says the lists are computed live", () => {
    expect(CODE).not.toMatch(/computed live/);
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of ["subhead", "seoDescription"]) {
        if (e[k]) expect(e[k], `${f} explore.${k}`).not.toMatch(/computed live/i);
      }
    }
  });
});

/**
 * PENDING TRANSLATION — AN EXEMPTION THAT IS VISIBLE RATHER THAN IMPLIED.
 *
 * Every key below is referenced in Explore.tsx with an inline English fallback,
 * `t("explore.x", "English")`, and is absent from en.json. That is a real gap
 * and it is named here rather than silently tolerated: an untranslated key
 * renders its English default in all nine languages, which is a degradation, not
 * a defect — the reader gets a true sentence in the wrong language rather than a
 * raw key or a stale claim.
 *
 * WHY THE LIST EXISTS AT ALL. src/i18n/locales/*.json is owned by a concurrent
 * workflow for the duration of this change, so this one cannot write the keys it
 * introduces. The alternatives were both worse: leaving the guard red hides the
 * NEXT key that goes missing for the real reason (repostBadgeCapped shipped
 * referenced-but-undefined in all nine locales, on the branch that fires for the
 * worst re-posters — that is what this guard is for), and deleting the guard
 * removes the only check that catches it.
 *
 * SO THE EXEMPTION IS BOUNDED THREE WAYS. It is an explicit list, not a prefix
 * or a pattern — a key not on it still fails. Every entry must carry an inline
 * English default at its call site, asserted below, so nothing on this list can
 * render as a bare key. And the list is asserted to be EXACTLY the outstanding
 * set: once the locale pass lands these keys, this test fails until the list is
 * emptied, so the exemption cannot outlive the reason for it.
 *
 * ADDED 2026-09-06 with the hiring-section rewrite. EMPTIED 2026-09-08 with the
 * six-section rebuild, which is the outcome this guard's third bound was
 * written to force: the locale pass landed every key in en.json, so the
 * exemption has outlived its reason and comes off in the same change. The list
 * stays declared, empty, rather than being deleted — the next change that needs
 * one has to add its keys here in the open, where the three bounds below apply.
 *
 * IT MAY NOT GROW ITS WAY OUT OF A RED TEST. The rebuild referenced 98 new keys
 * at once; adding all of them here would have turned a bounded exemption into a
 * blanket one, which is the weakening the guard exists to prevent. The cap
 * below is what makes that argument have to be had out loud.
 */
// TOUCHED AND EMPTIED AGAIN ON 2026-09-09 by the closure-record third state.
// The slice section stated the SIZE of its gap (`asked` and `readable` as two
// numbers) and never what the gap IS: the employers in it are the boards bigger
// than one visit can read, whose closures are not observable to us at all, and
// reading their absence as inactivity is the same defect the board's hiring chip
// was shipping at 59% of inventory. Its two keys (closureUnreadable,
// closureNone2) sat here for the length of one locale pass and came off the
// moment they landed in en.json — which is the third bound doing exactly its
// job, and the reason the list is declared rather than deleted.
const PENDING_LOCALE_KEYS = [] as const as readonly string[];

/** The exemption's own ceiling. It is deliberately small: a handful of keys
 *  awaiting one locale pass is a degradation, a hundred is a page shipping in
 *  the wrong language with a test saying that is fine. */
const PENDING_LOCALE_CAP = 40;

describe("every t() key the page uses exists in English", () => {
  it("has no key referenced only in code", () => {
    // explore.repostBadgeCapped shipped referenced-but-undefined in all nine
    // locales, on the branch that fires for the worst real re-posters.
    const en = (JSON.parse(readFileSync(resolve(LOCALES, "en.json"), "utf8")).explore ?? {}) as Record<string, string>;
    const used = [...EXPLORE.matchAll(/t\("explore\.([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    expect(used.length, "no explore t() keys found — regex broken").toBeGreaterThan(10);
    const missing = [...new Set(used)].filter((k) => !(k in en) && !PENDING_LOCALE_KEYS.includes(k));
    expect(missing, `referenced in Explore.tsx but absent from en.json: ${missing.join(", ")}`).toEqual([]);
    // AND THE EXEMPTION MAY NOT SWALLOW THE FAILURE. A list that can grow to
    // the size of the gap is not a bound, it is a mute button — this rebuild
    // introduced 98 keys at once and the temptation was exactly that.
    expect(PENDING_LOCALE_KEYS.length,
      `PENDING_LOCALE_KEYS has grown past ${PENDING_LOCALE_CAP} — land the keys in en.json instead of exempting them`)
      .toBeLessThanOrEqual(PENDING_LOCALE_CAP);
  });

  it("the pending list is exactly the outstanding set — it cannot outlive its reason", () => {
    // A stale exemption is a hole. When the locale pass lands a key, it must
    // come off this list in the same change, and this is what forces that.
    const en = (JSON.parse(readFileSync(resolve(LOCALES, "en.json"), "utf8")).explore ?? {}) as Record<string, string>;
    const used = new Set([...EXPLORE.matchAll(/t\("explore\.([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
    const landed = PENDING_LOCALE_KEYS.filter((k) => k in en);
    expect(landed, `translated now — remove from PENDING_LOCALE_KEYS: ${landed.join(", ")}`).toEqual([]);
    const orphaned = PENDING_LOCALE_KEYS.filter((k) => !used.has(k));
    expect(orphaned, `no longer referenced — remove from PENDING_LOCALE_KEYS: ${orphaned.join(", ")}`).toEqual([]);
  });

  it("every key the page uses renders English rather than a raw key", () => {
    // GENERALISED FROM THE EXEMPTION LIST TO EVERY KEY, because the list is now
    // empty and a loop over an empty list asserts nothing — the vacuous-guard
    // shape this file keeps finding elsewhere. The property was never really
    // about the exemption: a `t("explore.x")` with no second argument renders
    // the KEY to a visitor, and eight locales are currently missing 114 of
    // these keys, so the inline default IS what most readers see. It has to
    // exist for all of them, not only for the ones on a list.
    const used = [...new Set([...EXPLORE.matchAll(/t\("explore\.([A-Za-z0-9_]+)"/g)].map((m) => m[1]))];
    expect(used.length, "no explore t() keys found — regex broken").toBeGreaterThan(10);
    const bare = used.filter((k) => !new RegExp(`t\\("explore\\.${k}",\\s*\n?\\s*"`).test(EXPLORE));
    expect(bare, `no inline English fallback — these render a raw key: ${bare.join(", ")}`).toEqual([]);
  });
});

/**
 * ITEMS 3-5: A WARNING THAT TRAVELS, COUNTS ON THE FIELD CHIPS, AND
 * DENOMINATORS UNDER EVERY ANSWER.
 *
 * All three add NUMBERS to a page whose entire remaining debt is numbers that
 * contradict the thing they sit next to. So each gets a guard for the specific
 * way it could go false:
 *
 *   the churn warning  — could defame a large employer (rank vs rate), or read
 *                        as a clean bill on a miss;
 *   the field counts   — could contradict the page they open (the serving API
 *                        caps its count at 10,000; SQL does not);
 *   the denominators   — could drift from the collection they describe, or
 *                        render "0" when their scan failed.
 */
describe("the churn warning is gated on a rate and never reads as a clean bill", () => {
  const bodyOf = (fn: string) => {
    const sql = latestWith(`CREATE OR REPLACE FUNCTION public.${fn}`).replace(/^\s*--.*$/gm, "");
    const start = sql.indexOf(`FUNCTION public.${fn}`);
    expect(start, `${fn} not found`).toBeGreaterThan(-1);
    const end = sql.indexOf("$$;", start);
    expect(end, `${fn} body has no terminator`).toBeGreaterThan(start);
    return sql.slice(start, end);
  };

  it("gates on re-lists PER ROLE, not on a top-N by raw events", () => {
    // The measured reason this matters: over the 300 highest-event employers,
    // the median is 2.7 re-lists per affected role, and the two LARGEST by raw
    // events sit below it (ALTEN 769 events at 2.6/role, BAYADA 594 at 2.2).
    // A top-N-by-events gate would have warned about both — ordinary churn at
    // scale — while missing BoxLunch & Hot Topic at 193.7 per role across 3.
    // Ranking by size under a claim about CONDUCT does not misrank, it defames.
    const body = bodyOf("get_repost_index");
    expect(body).toMatch(/sum\(n\)::numeric\s*\/\s*GREATEST\(count\(\*\), 1\)\s*>=\s*5/);
    // And an absolute floor, or 2 roles re-listed 5 times each qualifies.
    expect(body).toMatch(/sum\(n\)\s*>=\s*25/);
    // No rank anywhere: an ORDER BY + LIMIT here would reintroduce exactly the
    // size gate the ratio exists to replace.
    expect(body).not.toMatch(/ORDER BY[\s\S]*LIMIT/);
  });

  it("only indexes employers whose roles the board still serves", () => {
    // job_board_closures carries no serving predicate, so without this an
    // employer whose postings all aged out keeps a warning it can never be
    // seen next to.
    const body = bodyOf("get_repost_index");
    expect(body).toMatch(/JOIN live l ON l\.company_token = a\.company_token/);
    const live = body.slice(body.indexOf("live AS ("));
    expect(live).toMatch(/missing_since IS NULL/);
    expect(live).toMatch(/effective_posted >= now\(\) - interval '30 days'/);
  });

  it("bounds its lookback, which the collection RPC does not", () => {
    // get_repost_churn_companies' `sup` CTE has no time bound at all, so an
    // employer that churned once and reformed carries it forever. A no-op
    // today (the closure log starts 2026-07-14) and the difference between a
    // measurement and a grudge later.
    expect(bodyOf("get_repost_index")).toMatch(/closed_at >= now\(\) - interval '180 days'/);
  });

  it("states the role count in the same sentence as the event count", () => {
    // 581 re-lists across 3 roles is one job advertised forever; 769 across
    // 298 is a large employer with ordinary churn. Read as a bare count they
    // are indistinguishable and the second employer is defamed. This must
    // never degrade to a tooltip or a second line.
    const m = CODE.match(/t\("explore\.repostWarn",\s*"([^"]+)"/);
    expect(m, "explore.repostWarn default not found").toBeTruthy();
    expect(m![1]).toContain("{{events}}");
    expect(m![1]).toContain("{{roles}}");
  });

  it("renders nothing at all on a miss — no clean bill, no green tick", () => {
    // A miss means "did not clear a rate gate of 5 per role on 25+ events",
    // which includes every employer whose board we have watched for a week.
    // Asserted against comment-stripped source: the prose above the helper
    // says these words precisely to explain why they may not be rendered.
    for (const phrase of [/no re-?post/i, /does not re-?post/i, /never re-?lists/i,
                          /clean record/i, /no churn/i, /doesn't re-?post/i]) {
      expect(CODE, `clean-bill copy: ${phrase}`).not.toMatch(phrase);
    }
    expect(CODE).toMatch(/if \(!Array\.isArray\(hit\) \|\| hit\.length < 3\) return null;/);
  });

  it("the warning reaches the one surface that still names an employer approvingly", () => {
    // THE POINT OF THE WARNING, AND WHY ITS SCOPE ARGUMENT IS GONE. It used to
    // take an `on` parameter because six answers named employers and three of
    // them needed suppressing: it is worthless under a chip that IS a warning,
    // and it must not sit under a card that recommends on a fill record while
    // disqualifying on churn.
    //
    // Five of those six answers were deleted. One surface still names an
    // employer approvingly — the employer check — so the warning has exactly
    // one call site, the scope argument has nothing left to discriminate, and
    // keeping it would be a parameter with one legal value. The property it
    // enforced is now structural: there is nowhere else to put the warning.
    expect(CODE).toMatch(/const repostWarn = \(token: string \| undefined\): string \| null =>/);
    // ONE invocation (the declaration reads `repostWarn = (`, with a space, so
    // it does not match) — a second would mean a second approving surface.
    const calls = [...CODE.matchAll(/repostWarn\(/g)];
    expect(calls.length, "the churn warning gained a second surface — re-open the scope question").toBe(1);
    expect(CODE, "the warning must reach the surface that names an employer approvingly")
      .toMatch(/const worst = worstToken \? repostWarn\(worstToken\) : null;/);
  });

  it("checks every one of a merged employer's feeds, worst first", () => {
    // get_company_suggest merges by display name (PwC has four ATS feeds), and
    // the index is keyed by TOKEN — so reading tokens[0] alone would miss the
    // churn whenever it lives on a sibling feed.
    expect(CODE).toMatch(/h\.tokens\s*\.filter\(\(tk\) => Array\.isArray\(repostIndex\[tk\]\)\)/);
    expect(CODE).toMatch(/\(repostIndex\[b\]!\[0\] \?\? 0\) - \(repostIndex\[a\]!\[0\] \?\? 0\)/);
  });
});

describe("field chips count exactly what their destination counts", () => {
  const DENOM = (() => {
    const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_explore_denominators").replace(/^\s*--.*$/gm, "");
    const start = sql.indexOf("FUNCTION public.get_explore_denominators");
    return sql.slice(start, sql.indexOf("$$;", start));
  })();
  const cte = (name: string, until: string) =>
    DENOM.slice(DENOM.indexOf(`${name} AS (`), DENOM.indexOf(`${until} AS (`));

  it("applies the serving predicates and NOTHING else", () => {
    // job-board/index.ts applies exactly .gte(dateCol, freshCutoff) and
    // .is("missing_since", null) — no showcase_excluded, no company <> ''.
    // Adding either here would put a number on a chip that its own
    // destination contradicts, which is the defect this page spent the week
    // removing. The company-level pools in `co` DO exclude them, because that
    // is the pool the twelve cards were drawn from — the asymmetry is the
    // point, so it is asserted in both directions.
    const fld = cte("fld", "board");
    expect(fld).toMatch(/missing_since IS NULL/);
    expect(fld).toMatch(/effective_posted >= now\(\) - interval '30 days'/);
    expect(fld, "field counts exclude rows the field page shows").not.toMatch(/showcase_excluded/);
    expect(fld, "field counts exclude rows the field page shows").not.toMatch(/company <> ''/);
    const co = cte("co", "fld");
    expect(co, "the card pool must exclude what the cards exclude").toMatch(/showcase_excluded/);
    expect(co).toMatch(/company <> ''/);
  });

  it("mirrors the serving API's count cap across runtimes", () => {
    // THE CROSS-RUNTIME GUARD. The serving API stops counting at COUNT_CAP and
    // replies countCapped, so /jobs/field/marketing renders "10,000+".
    // get_explore_denominators counts in SQL and is not capped, so an uncapped
    // chip would read "38,412" and open a page saying "10,000+" — the same
    // card-contradicts-destination failure, merely inverted. Two runtimes, one
    // number: parsed from both sources and compared, never asserted as a
    // literal in one place.
    const fn = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    const server = fn.match(/const COUNT_CAP = ([\d_]+);/);
    const client = EXPLORE.match(/const SERVE_COUNT_CAP = ([\d_]+);/);
    expect(server, "COUNT_CAP not found in job-board").toBeTruthy();
    expect(client, "SERVE_COUNT_CAP not found in Explore").toBeTruthy();
    expect(Number(client![1].replace(/_/g, ""))).toBe(Number(server![1].replace(/_/g, "")));
  });

  it("formats a capped count the way the destination formats it", () => {
    const cap = Number(EXPLORE.match(/const SERVE_COUNT_CAP = ([\d_]+);/)![1].replace(/_/g, ""));
    const fieldCount = (n: number, loc: string) =>
      n >= cap ? `${cap.toLocaleString(loc)}+` : n.toLocaleString(loc);
    expect(fieldCount(cap, "en-US")).toBe("10,000+");
    expect(fieldCount(cap + 28_412, "en-US")).toBe("10,000+");
    expect(fieldCount(4246, "en-US")).toBe("4,246");
  });

  it("omits a thin field rather than printing a small or zero count", () => {
    // A field with nine postings is a categoriser artifact; printing "9" beside
    // Engineering invites a reader to conclude the board is empty in their area
    // when it is the label that is thin. Below the floor the key is absent and
    // the chip renders bare — the link still works, it just claims nothing.
    expect(DENOM).toMatch(/FROM fld WHERE n >= 50/);
    expect(CODE).toMatch(/typeof n === "number" && n > 0 &&/);
  });
});

describe("every answer states the pool it was drawn from, and zero is silence", () => {
  const REFRESH = (() => {
    const sql = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache").replace(/^\s*--.*$/gm, "");
    const start = sql.indexOf("FUNCTION public.refresh_explore_cache");
    return sql.slice(start, sql.indexOf("$$;", start));
  })();

  it("counts the pool with the SAME scan that produces the tiles", () => {
    // Not a second query. Duplicating a predicate gives it a fresh chance to
    // drift, and every duplicated predicate in this file's history has
    // eventually disagreed with its original.
    //
    // THE TWELVE-ROW SLICES ARE GONE WITH THEIR SECTIONS — `FILTER (WHERE r.rn
    // <= 12)` over get_actively_hiring_companies(2000) and
    // get_repost_churn_companies(9000) produced four employer leaderboards
    // holding 0.19% of the board. The property lands on the field grid instead,
    // where it matters more: a tile's count and the reach sentence's two terms
    // all come off get_explore_field_grid's ONE pass, so the numerator and
    // denominator of the page's only fraction cannot be two scans at two
    // instants.
    expect(REFRESH, "a twelve-row slice came back").not.toMatch(/FILTER \(WHERE r\.rn <= 12\)/);
    expect(REFRESH, "the per-field counts must be a projection of the grid, not a second scan")
      .toMatch(/jsonb_object_agg\(kv\.key, \(kv\.value ->> 'n'\)::int\)\s*\n\s*FROM jsonb_each\(field_grid_v -> 'fields'\) kv/);
    const grid = latestWith("CREATE OR REPLACE FUNCTION public.get_explore_field_grid").replace(/^\s*--.*$/gm, "");
    // board.n and tiled_n over one statement — the reach sentence's own pair —
    // and the floor that separates them declared once.
    expect(grid).toMatch(/'tiled_n',\s*\(SELECT COALESCE\(sum\(n\), 0\)::int FROM tiles\)/);
    expect(grid).toMatch(/'board', \(SELECT jsonb_build_object\(/);
    expect(grid).toMatch(/tiles AS \(SELECT \* FROM agg WHERE n >= 50\)/);
    // AND THE CHIP'S OWN COLUMN. remote_n counts the `remote` boolean, which is
    // NOT NULL on every row and therefore reads as full coverage; the chip
    // binds work_mode = 'remote', a different and smaller population under a
    // ~28% denominator. Both are returned, and the one the chip may quote is
    // the one named for the mode.
    expect(grid).toMatch(/count\(\*\) FILTER \(WHERE s\.work_mode = 'remote'\)::int AS remote_mode_n/);
    expect(grid).toMatch(/count\(\*\) FILTER \(WHERE s\.work_mode IS NOT NULL\)::int AS work_mode_n/);
  });

  it("builds the pay denominator from the 20-role rule ALONE", () => {
    // THE TRAP. get_transparent_employers' agg CTE has
    //   HAVING count(*) >= 20 AND 100.0 * pay_n / count(*) >= 80
    // so counting its rows yields the NUMERATOR twice and a "median" around
    // 90% instead of the board's real rate. The denominator must be built from
    // the >=20 condition on its own.
    const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_explore_denominators").replace(/^\s*--.*$/gm, "");
    const pool = sql.slice(sql.indexOf("'pay_pool_n'"), sql.indexOf("'pay_n'"));
    expect(pool).toMatch(/WHERE total >= 20/);
    expect(pool, "the 80% gate leaked into its own denominator").not.toMatch(/80/);
  });

  it("strips a failed counter instead of publishing it as zero", () => {
    // A broken instrument must never render as a fact about the thing it
    // measures — "the 12 best of 0 employers" is the page asserting something
    // false about the board because its own scan died.
    expect(REFRESH).toMatch(/jsonb_strip_nulls/);
    // hiring_n and repost_pool_n went with the leaderboards they counted.
    // repost_flagged_n survives one more ship — see the migration's own note —
    // and is the one totals key still built this way.
    for (const k of ["repost_flagged_n"]) {
      expect(REFRESH, `${k} can publish a zero`).toMatch(new RegExp(`'${k}',\\s*NULLIF\\(`));
    }
    for (const gone of ["hiring_n", "repost_pool_n"]) {
      expect(REFRESH, `${gone} outlived the section it counted`).not.toContain(`'${gone}'`);
    }
    expect(latestWith("CREATE OR REPLACE FUNCTION public.get_explore_denominators")).toMatch(/jsonb_strip_nulls/);
  });

  it("every optional block degrades without taking the payload down", () => {
    // The cache row must still be written when any one collection fails, or a
    // single slow scan freezes every answer on the page.
    //
    // Counted on the QUERY_CANCELED arm, not WHEN OTHERS, since 2026-08-12:
    // per the PostgreSQL docs, "OTHERS matches every error type except
    // QUERY_CANCELED and ASSERT_FAILURE" — and statement_timeout raises
    // QUERY_CANCELED. A handler without the explicit arm does not catch the
    // one error these blocks exist to survive; the caches died whole on
    // timeouts for two days while visibly "wrapped".
    const qc = REFRESH.match(/WHEN QUERY_CANCELED THEN/g) ?? [];
    expect(qc.length, "a block cannot catch the timeout it exists to survive").toBeGreaterThanOrEqual(5);
    const wo = REFRESH.match(/WHEN OTHERS THEN/g) ?? [];
    expect(wo.length, "the OTHERS arm went missing").toBeGreaterThanOrEqual(qc.length);
  });

  it("renders a claim only when the number behind it arrived, and stays silent otherwise", () => {
    // A missing key is a FAILED SCAN and must produce silence, never "the 12
    // best of 0 employers". Every note this guard was written for belonged to a
    // deleted section; the page's one surviving fraction is the reach line, and
    // it inherits the property in a stronger form.
    //
    // BOTH TERMS FROM ONE SCAN, OR NO SENTENCE. get_explore_field_grid
    // publishes tiled_n and board.n over a single pass for exactly this
    // fraction. The first version of this line summed the rendered tiles and
    // divided by totals.postings_n — get_explore_denominators' own board CTE, a
    // different function at a different instant — under copy ending "as counted
    // in the same hourly scan". During an ingest tick that pair comes out
    // either way: covered above board tripped the wholeness branch and
    // published "every posting we can serve — all N of them" as an equality
    // neither statement proved.
    // BOTH TERMS FROM ONE MAP, OR NO SENTENCE — and now they cannot be
    // anything else. The grid is a partition of the board's own category facet
    // (`GROUP BY category` over the serving population, no floor), so the
    // population and the tiled total are two sums over ONE object with ONE
    // `refreshedAt`. There is no second scan left to divide by, which is why
    // the fraction became a population and the percentage disappeared.
    expect(CODE).toMatch(/const reach = useMemo\(\(\) => \{\s*\n\s*if \(!facet\) return null;/);
    expect(CODE, "a missing reading must produce no sentence, not a smaller claim")
      .toMatch(/if \(all <= 0 \|\| tiled <= 0\) return null;/);
    expect(CODE, "the population is being read from a second scan")
      .not.toMatch(/totals\.postings_n\s*[;),]/);
    // A chip's coverage percentage is a different thing and stays: it is the
    // share of the board that STATES the column a filter binds, which varies
    // per filter and is not a fraction of a partition.
    expect(CODE, "a fraction of a partition can only read 100% — it must not be published")
      .not.toMatch(/pct:\s*reach\./);
    expect(CODE, "the reach percentage came back").not.toMatch(/\* 1000\) \/ 10/);
    // AND THE UNCAPPED BOARD COUNT MUST NOT RETURN AS A TILE-LEVEL SENTENCE.
    // It printed get_explore_denominators' uncapped count as "open across the
    // board right now" while every tile beneath it is formatted through
    // SERVE_COUNT_CAP — one sentence contradicting the eighteen numbers under
    // it and the page each one opens. The reach line states the mismatch in
    // words instead.
    expect(CODE, "a board-wide count is back above the tiles")
      .not.toMatch(/fields:\s*totals\.postings_n/);
    // AND THE CAP IS OFF THE TILES. It is COUNT_CAP — the ceiling on a FILTERED
    // count — and a grouped facet is not a filtered count. Running the tiles
    // through it made six of eighteen render "10,000+" under a header
    // promising an ordering by size. It survives for the priced role rows and
    // chips, which really are filtered counts, and there alone.
    expect(CODE, "the tiles are being formatted through the serving cap again")
      .not.toMatch(/tileCount/);
    expect(CODE).toMatch(/pricedLabel = useCallback[\s\S]{0,320}SERVE_COUNT_CAP/);
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      expect(e.noteFields, `${f} still ships explore.noteFields`).toBeUndefined();
    }
  });

  it("the new cache keys are read as objects, never trusted from null", () => {
    // typeof null === "object" is the trap: it would put null into a Record and
    // throw on the first read. Each is required to be a non-null, non-array
    // object before it is trusted.
    expect(CODE).toMatch(/const obj = \(v: unknown\) => !!v && typeof v === "object" && !Array\.isArray\(v\);/);
    // NARROWED TO WHAT THE PAGE STILL READS. `fields` and `totals` were the
    // tile counts and their denominator; both now come off the board's own
    // category facet in one read with the page a tile opens, so the cache is
    // consulted for the churn index alone.
    // …and for the per-field grid the chips' coverage sentence reads its
    // SHARES from — never a tile number; see the render guard.
    for (const k of ["c.repost_index", "c.field_grid"]) {
      expect(CODE).toContain(`obj(${k})`);
    }
    for (const k of ["c.fields", "c.totals", "c.field_curves"]) {
      expect(CODE, `${k} is being read again — one quantity, two scans`).not.toContain(`obj(${k})`);
    }
  });

  it("no translation of the new copy can drop a placeholder", () => {
    // THE REAL RISK, and it is not that a locale is missing — it is that a
    // locale HAS the key with a value that loses a number. A locale value
    // overrides the inline default silently, so a translation of
    // explore.repostWarn that drops {{roles}} renders "Re-lists roles: 581
    // re-postings" with no denominator: the bare-count libel, in one language,
    // with the English page still reading correctly. Same for the pay note,
    // where losing {{pool}} turns a fraction into a bare claim.
    //
    // Checked against EVERY locale that defines the key, so a translation
    // landing later is held to the same rule as today's English.
    // RE-POINTED TO THE LIVE SENTENCES. Four of the eight keys here
    // (noteHiring, noteEntry, noteGhost, noteFields) are retired and were
    // deleted from all nine locales in this change; a fifth, noteGhostFlagged,
    // was GREEN OVER DEAD COPY — still defined in all nine locales while
    // Explore.tsx had moved to noteRecycleFlagged. The property is unchanged
    // and the list is longer, not shorter.
    // RE-POINTED WITH THE PAGE, AND THE LIST IS LONGER RATHER THAN SHORTER.
    // The eight note* keys belonged to the deleted leaderboards' pool
    // sentences; what carries interpolations now is the reach line, the whole
    // of the closure record, the lifecycle line under a tile, the two
    // employer-check numbers and the two role-row refusals.
    const REQUIRED: Record<string, string[]> = {
      repostWarn: ["{{events}}", "{{roles}}"],
    // RE-POINTED, NOT SHRUNK. The pair took new keys when the sentence changed
    // meaning twice over: it interpolates the field count from
    // BOARD_CATEGORY_SLUGS.length instead of spelling "eighteen" (which also
    // counted the bucket the method panel says is not a field), and it claims
    // only what the facet proves rather than a board total /jobs publishes from
    // a different, separately-patched field. basisCarried is the same sentence
    // for counts carried through a failed facet pass -- it has no {{time}},
    // because the whole point of it is that the pass stamp is NOT when these
    // were counted; the time it does have rides basisCarriedWhen.
    // AND RE-POINTED A THIRD TIME, to basisWhole3/basisPartial3/basisCarried2.
    // The three took new keys again when the clause describing the bucket
    // changed MEANING: "the roles whose field we could not read from the title"
    // says the employer's title was unreadable, when categorize() returns
    // "other" because no regex in OUR OWN rule set matched — a coverage gap in
    // a vocabulary frozen at v9 by design. Editing them in place would have
    // left every other language telling readers the employers' data was bad.
      basisWhole3: ["{{n}}", "{{fields}}", "{{time}}"],
      basisPartial3: ["{{tiled}}", "{{all}}", "{{untiled}}", "{{fields}}", "{{time}}"],
      basisCarried2: ["{{n}}", "{{fields}}", "{{when}}"],
      basisCarriedWhen: ["{{time}}"],
      // The grid became a list of rows with a bar on each, and both sentences
      // that explain the bars carry counts that must survive translation. A
      // barBasisAnchor that lost {{topN}} would say a bar is measured "against the
      // largest bucket on the board" and never say how big that is, which is
      // the anchorless-bar defect the sentence exists to close; a halfLine that
      // lost {{k}} would claim "these fields hold more than half" of a board
      // without saying how many fields.
      barBasisAnchor: ["{{topLabel}}", "{{topN}}"],
      // AND THE RATIO CARRIES ITS OWN TWO TERMS. The spread sentence divides
      // the largest FIELD by the smallest field; it used to print the largest
      // BUCKET's count beside the smallest field's and then a ratio computed
      // from neither pair, so a reader dividing the two numbers in front of
      // them got a different answer from the one on the page. {{biggestN}} is
      // the term that makes the arithmetic followable and it must survive
      // translation like the rest.
      barBasisSpread: ["{{smallLabel}}", "{{smallN}}", "{{biggestLabel}}", "{{biggestN}}", "{{ratio}}"],
      halfLine: ["{{k}}", "{{above}}", "{{fieldsTotal}}", "{{rest}}", "{{below}}"],
      methodTileMethod3: ["{{cap}}", "{{n}}"],
      closureBasisNoTotal2: ["{{rows}}", "{{asked}}", "{{readable}}"],
      closureFinding2: ["{{closers}}", "{{readable}}", "{{min}}", "{{days}}"],
      closureBasisNote2: ["{{min}}"],
      closureOpen: ["{{n}}"],
      closureOpenCapped: ["{{n}}", "{{closers}}"],
      rolesBelowFloor: ["{{min}}"],
      // THE CHIP-COVERAGE PASS. chipCoverage ("stated on {{pct}}%") is retired:
      // it printed the board's share beside a field's count. What replaced it
      // is one sentence per panel naming the field, the scan's time and four
      // shares; a counts-basis line naming the field, the window, the cache
      // bound and the cap; two partial-outage sentences; a Where note; and the
      // role title and note that say what the rows are.
      panelCountsBasis: ["{{field}}", "{{window}}", "{{min}}", "{{cap}}"],
      rolesTitle2: ["{{field}}"],
      rolesPartial: ["{{n}}", "{{total}}"],
      chipsPartial: ["{{n}}", "{{total}}"],
      chipsCoverageField: ["{{field}}", "{{time}}", "{{workMode}}", "{{pay}}", "{{experience}}", "{{employmentType}}"],
      chipsCoveragePayFloor: ["{{payFloor}}"],
      chipsCoverageRole: ["{{role}}"],
      chipsCoverageNone: ["{{field}}"],
      whereNote: ["{{field}}"],
      methodLiveMethod2: ["{{min}}"],
      fillOpen: ["{{n}}"],
      checkFeedGap2: ["{{total}}", "{{when}}", "{{gap}}"],
      checkFeedMulti: ["{{n}}"],
      staleParts: ["{{parts}}"],
    };
    // THE ENGLISH CLAUSE, RESHAPED RATHER THAN DELETED. `typeof en[key] ===
    // "string"` is unsatisfiable for any key still on PENDING_LOCALE_KEYS, and
    // a guard left red for the length of a locale window is how someone
    // eventually deletes it. The obligation is the same either way — SOME
    // English string carries every placeholder — so it is asserted against
    // en.json where the key has landed and against the INLINE DEFAULT where it
    // has not. There is no state in which nothing is checked.
    const en = (JSON.parse(readFileSync(resolve(LOCALES, "en.json"), "utf8")).explore ?? {}) as Record<string, string>;
    for (const [key, placeholders] of Object.entries(REQUIRED)) {
      let english = en[key];
      if (typeof english !== "string") {
        const m = CODE.match(new RegExp(`t\\("explore\\.${key}",\\s*"([^"]+)"`));
        expect(m, `explore.${key} is in neither en.json nor an inline default`).toBeTruthy();
        english = m![1];
      }
      for (const ph of placeholders) {
        expect(english, `the English text for explore.${key} drops ${ph}: ${english}`).toContain(ph);
      }
    }
    // And the retired sentences must not linger in any locale, where a value
    // would override an inline default the page no longer has a call site for.
    for (const f of localeFiles) {
      const ex = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const dead of ["noteHiring", "noteEntry", "noteGhost", "noteGhostFlagged", "noteFields",
                          "noteDurationPool", "noteDurationShown", "noteRecyclePool",
                          "noteRecycleFlagged", "noteAged", "noteEntryShare", "notePay",
                          "notePayBoard", "closureBasis", "closureBasisNoTotal",
                          "asOfCounts", "fieldCurveMedian"]) {
        expect(ex[dead], `${f} still ships the retired explore.${dead}`).toBeUndefined();
      }
    }
    for (const f of localeFiles) {
      const ex = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const [key, placeholders] of Object.entries(REQUIRED)) {
        if (typeof ex[key] !== "string") continue;
        for (const ph of placeholders) {
          expect(ex[key], `${f} explore.${key} drops ${ph}`).toContain(ph);
        }
      }
    }
  });
});

describe("the refresh budget covers the scans it runs", () => {
  /** '4min' -> 240, '90s' -> 90. Anything else is a parse failure, not a zero:
   *  silently reading an unrecognised unit as 0 would make this whole test
   *  pass by measuring nothing. */
  const secs = (v: string): number => {
    const m = v.match(/^(\d+)\s*(s|min)$/);
    if (!m) throw new Error(`unparseable statement_timeout: ${v}`);
    return Number(m[1]) * (m[2] === "min" ? 60 : 1);
  };

  const timeoutOf = (fn: string): number => {
    const sql = latestWith(`CREATE OR REPLACE FUNCTION public.${fn}`).replace(/^\s*--.*$/gm, "");
    const start = sql.indexOf(`FUNCTION public.${fn}`);
    // Header only — from the signature to the body opener. A statement_timeout
    // set on some LATER function in the same file must not be read as this
    // one's, which is what an unbounded slice would do.
    const head = sql.slice(start, sql.indexOf("AS $$", start));
    const m = head.match(/statement_timeout = '([^']+)'/);
    return m ? secs(m[1]) : 0;
  };

  it("the outer ceiling is at least the sum of every inner ceiling", () => {
    // A CALLEE'S OWN statement_timeout OVERRIDES THE CALLER'S — proved on this
    // codebase when a 90s caller ran a function that capped itself at 25s and
    // died at 25.46s. So each scan below is capped individually and NOTHING
    // caps their sum but the outer value. When the sum exceeds it, a slow hour
    // aborts the whole function and rolls back the INSERT: every collection
    // lost, including the healthy ones, presenting as a frozen page with no
    // error a reader could see.
    //
    // This commit added 270s of new worst case (denominators 180 + index 90)
    // to a 600s ceiling that already carried 415s. Derived from the source
    // rather than pinned, so adding a scan fails here instead of at 03:07.
    const sql = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache").replace(/^\s*--.*$/gm, "");
    const start = sql.indexOf("FUNCTION public.refresh_explore_cache");
    const body = sql.slice(start, sql.indexOf("$$;", start));

    const outer = timeoutOf("refresh_explore_cache");
    expect(outer, "refresh_explore_cache has no statement_timeout at all").toBeGreaterThan(0);

    const called = [...new Set([...body.matchAll(/public\.(get_[a-z_]+)\s*\(/g)].map((m) => m[1]))];
    // FOUR, NOT SIX. Three blocks whose sections were deleted went with them
    // (transparent 240s, salary 180s, ageout_basis 20s), which is most of why
    // the sum below fell from 730s to 335s. The floor is only here so a broken
    // regex cannot make the sum vacuously zero.
    expect(called.length, "no callees found — the regex broke").toBeGreaterThanOrEqual(4);

    const inner = called.map((fn) => [fn, timeoutOf(fn)] as const);
    for (const [fn, t] of inner) {
      expect(t, `${fn} has no statement_timeout, so it is unbounded inside the refresh`).toBeGreaterThan(0);
    }
    const sum = inner.reduce((a, [, t]) => a + t, 0);
    expect(outer, `inner ceilings total ${sum}s but the refresh budget is ${outer}s: ` +
      inner.map(([f, t]) => `${f}=${t}s`).join(", ")).toBeGreaterThanOrEqual(sum);
  });
});
