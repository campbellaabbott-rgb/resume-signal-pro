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
  expect(ids.length, "no intents parsed out of INTENTS").toBeGreaterThan(3);
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
    for (const k of ["checkFeedGap", "checkFeedMulti", "checkFeedUnknown"]) {
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
      .toMatch(/RETIRED_CACHE_PARTS[\s\S]{0,200}"segments"/);
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

  it("transparent is read from the cache instead", () => {
    expect(EXPLORE).toMatch(/Array\.isArray\(c\.transparent\)/);
    expect(latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache")).toMatch(/'transparent', transparent/);
  });

  it("a slow collection cannot blank the other six", () => {
    // The cache was all-or-nothing: one failing member aborted the INSERT and
    // froze every section with nothing saying so.
    const fn = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache");
    expect(fn).toMatch(/transparent jsonb := '\[\]'::jsonb;/);
    expect(fn).toMatch(/RAISE WARNING 'explore cache: transparent employers unavailable/);
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
  const CALLEE = latestWith("CREATE OR REPLACE FUNCTION public.get_transparent_employers").replace(/^\s*--.*$/gm, "");

  it("calls the scalar function as a scalar, never in FROM", () => {
    // `SELECT jsonb_agg(row_to_json(x)) FROM get_transparent_employers(12) x`
    // parses fine — Postgres treats a non-set-returning function in FROM as a
    // one-row table — and yields [{"x":[...]}]. Explore's Array.isArray gate
    // passes on that, so the section would have rendered one card with every
    // field undefined. The timeout was hiding a shape bug.
    expect(SQL).not.toMatch(/FROM\s+public\.get_transparent_employers/);
    expect(SQL).toMatch(/transparent := COALESCE\(public\.get_transparent_employers\(12\), '\[\]'::jsonb\);/);
  });

  it("still returns scalar jsonb — the premise the call shape depends on", () => {
    // If this ever becomes RETURNS TABLE, the assertion above inverts. Six
    // sibling collections ARE set-returning and are correctly called with
    // FROM ... row_to_json; this one and get_size_segments are not.
    // CALLEE, not SQL: this is a fact about the function, and it now lives in a
    // different migration from the cache that calls it.
    expect(CALLEE).toMatch(/FUNCTION public\.get_transparent_employers\(p_limit int DEFAULT 12\)\s*\nRETURNS jsonb/);
  });

  it("rejects a non-array result rather than publishing it", () => {
    const fn = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache");
    expect(fn).toMatch(/jsonb_typeof\(transparent\) <> 'array'/);
  });
});

describe("empty and failed are recorded as different things", () => {
  const fn = latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache");

  it("the cache says WHY transparent is empty", () => {
    // `[]` meant both "nobody clears 80%" and "the query died" and looked
    // identical, which is why the failure survived weeks unnoticed.
    expect(fn).toMatch(/'transparent_status', transparent_status/);
    expect(fn).toMatch(/transparent_status text := 'ok';/);
    expect(fn).toMatch(/transparent_status := 'failed: ' \|\| left\(SQLERRM, 120\)/);
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
    const COUNT_KEYS = ["openBoth", "fillOpen", "checkFeedGap", "transparentBadge",
                        "entryBadgeShare", "repostWarn", "recycleEvidence"];
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
          .matchAll(/\b(n|total|open|entry|events|roles):\s*([^,\n]+)/g)];
        expect(args.length, `explore.${key} interpolates no count at all: ${call}`).toBeGreaterThan(0);
        for (const [, name, value] of args) {
          expect(value, `explore.${key} interpolates ${name} raw: ${value.trim()}`).toContain("nf(");
        }
      }
    }
    expect(sites, "count-bearing call sites not found — the finder broke").toBeGreaterThanOrEqual(8);
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
    expect(CODE).toMatch(/\{shown\.map\(\(i(?:,\s*\w+)?\) =>/);
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
    const hides = [...CODE.matchAll(/hidden=\{active !== "(\w+)"\}/g)].map((m) => m[1]);
    for (const i of intents) {
      expect(hides, `no hidden-gated body for intent "${i}"`).toContain(i);
    }
    expect(hides, "an answer is gated on something other than the active intent")
      .toHaveLength(intents.length);
    expect(CODE, "an answer is conditionally unmounted rather than hidden")
      .not.toMatch(/\{active === "\w+" && </);
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
    expect(CODE, "the chip row must not be derived from any collection")
      .toMatch(/const shown = INTENTS;/);
    expect(CODE, "the active answer must not be derived from any collection")
      .toMatch(/const active: Intent = intent;/);
    const derive = CODE.slice(CODE.indexOf("const shown = INTENTS;"),
                              CODE.indexOf("const active: Intent = intent;") + 40);
    expect(derive, "a data term crept back into the chip derivation")
      .not.toMatch(/loading|available|\.length/);
    expect(CODE, "the availability record is back — it cannot come back ungated")
      .not.toMatch(/available\[/);
    // (b) A CHIP MUST NEVER OPEN ONTO BLANK SPACE. Previously enforced by
    //     hiding the chip; now enforced by every answer owning a WRITTEN
    //     REFUSAL, so an empty collection is a sentence rather than a
    //     disappearance and the URL→answer mapping stays total. Without this
    //     half, the next answer added without a refusal ships a chip that opens
    //     onto nothing and no test goes red.
    const bodies = INTENT_IDS().map((id) => {
      const start = CODE.indexOf(`hidden={active !== "${id}"}`);
      expect(start, `no hidden-gated body for "${id}"`).toBeGreaterThan(-1);
      const next = CODE.indexOf('hidden={active !== "', start + 1);
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
    const head = CODE.slice(0, CODE.indexOf('hidden={active !== "hiring"}'));
    expect(head, "the /jobs link must be above the answers").toMatch(/to="\/jobs"/);
    expect(CODE, "the old bottom CTA card should be gone").not.toMatch(/explore\.ctaLine/);
  });
});

describe("a card's number and the page it opens agree", () => {
  it("all /jobs links come from the single builder", () => {
    // Cards hardcoded `/jobs/company/{token}?from=explore` in six places, which
    // is how the entry-level badge promised 38 roles over a destination showing
    // 900.
    expect(CODE).toMatch(/const companyHref = \(token: string, intent: Intent\)/);
    const grid = CODE.slice(CODE.indexOf("function CompanyGrid"), CODE.indexOf("function Section"));
    expect(grid).toMatch(/to=\{companyHref\(r\.company_token, intent\)\}/);
    expect(grid, "CompanyGrid must not build its own URL").not.toMatch(/to=\{`\/jobs\/company/);
  });

  it("the entry-level answer filters its destination to entry roles", () => {
    expect(CODE).toMatch(/intent === "entry" \? `\$\{base\}&experience=entry`/);
  });

  it("appends no filter Jobs.tsx does not read", () => {
    // `fresh` is WRITTEN by Jobs.tsx and never read back, so a fresh=day link
    // would promise a 24-hour window and deliver an unfiltered board.
    expect(CODE).not.toMatch(/fresh=day/);
    // "states pay" and "pays at least $X" are different populations, and the
    // floor is currency-blind.
    expect(CODE).not.toMatch(/salaryFloor/);
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
    entryBadgeShare: ["{{pct}}", "{{open}}", "{{entry}}"],
  };
  for (const [key, vars] of Object.entries(NEW_KEYS)) {
    it(`${key} keeps every placeholder in all nine locales`, () => {
      for (const f of localeFiles) {
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

  it("Explore's actions use only params Jobs reads", () => {
    const actions = [...CODE.matchAll(/to: `\/jobs\?([a-zA-Z]+)=/g)].map((m) => m[1]);
    expect(actions.length, "no per-answer actions found").toBeGreaterThan(0);
    for (const p of actions) {
      expect(["company", "experience", "activelyHiring"], `Explore links ?${p}= — confirm Jobs reads it`).toContain(p);
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
    // WIDENED AFTER THE SECOND OCCURRENCE. This regex named only the first
    // removal (trending/newest), so it stayed green while the prerendered
    // /explore kept shipping "Companies that actually fill roles", "a real fill
    // signal" and "Serial re-posters" to crawlers for a page that renders none
    // of them — the exact "two copies, only one fixed" regression the guard was
    // written after, one removal later. Every collection this page has deleted
    // is named here; a future removal adds its own alternative.
    const GONE = /Trending Companies|trending boards|fastest-growing|re-poster|Who Fills Roles|actually fill (the )?roles|real fill signal|Hiring at scale/i;
    const code = entry.replace(/^\s*\/\/.*$/gm, "");
    expect(code, `prerender-seo.mjs still advertises a removed collection`).not.toMatch(GONE);
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
    expect(CODE).toMatch(/INTENTS: readonly Intent\[\] = \["check",/);
    expect(CODE, "the chip row must not be derived from any collection")
      .toMatch(/const shown = INTENTS;/);
    // And the lookup's own body must sit outside every loading/length gate: it
    // is the one answer that can still be right when the cron is dead.
    const start = CODE.indexOf('hidden={active !== "check"}');
    expect(start, "the check answer's body moved — re-anchor, do not delete").toBeGreaterThan(-1);
    const body = CODE.slice(start, CODE.indexOf('hidden={active !== "', start + 1));
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

  it("the card shows the fill rate only on a real sample", () => {
    // A number over four dated closures is noise dressed as a deadline. The
    // PROPERTY has not moved; the statistic and the gate's address have.
    //
    // The old p50 clock was a median drawn from an observable support of
    // [7, 30] — a 30-day serving cap at the top, a 7-day floor in every fill
    // query at the bottom — so eighteen categories spanning nursing, law,
    // retail and ML research agreed to within 1.4 days over ~600k closures.
    // That is not a fact about hiring, it is our own retention window. R(14)
    // from the Aalen-Johansen curve replaced it, and the sample gate moved
    // SERVER-SIDE into get_company_fill_curve's own `sufficient`: n_at_risk_14
    // >= 25 AND fills_le_14 >= 5 AND CI half-width <= 0.15 AND relists <=
    // fills. Every term is strictly stronger than the old dated_n >= 10, and
    // the half-width term measures directly what the count floor was a proxy
    // for — at the boundary (n=25, fills=5) it lands near 0.17 and REFUSES, so
    // the gate binds rather than decorates. The three SQL thresholds are
    // pinned with their boundary proofs in
    // src/test/the-estimator-that-must-agree-with-arithmetic.test.ts:604-620
    // and :760-771; this guard owns the client half, so the two are one
    // property split across two layers rather than a client gate with nothing
    // behind it.
    //
    // The old second clause, tracking_days >= 21, has no literal successor in
    // `sufficient`. It survives here as DISCLOSURE — the badge's core clause
    // always prints the tracking span beside the rate, which is what
    // docs/hiring-health-model.md §5 prescribes — so it is asserted below on
    // the locale VALUE, not merely on the inline default — and it is ALSO
    // enforced, because `sufficient` never looks at the observation span and
    // lifetimes run from the employer's stated posted_at rather than from our
    // first sighting: a ten-day-deep record can put 25 roles at risk at day 14
    // and pass every term of the server gate. So the client re-applies /jobs'
    // FILL_RATE_MIN_TRACKING_DAYS, and reads it off the CURVE's span, which is
    // the record the rate was estimated over.
    //
    // ONE BAR, ONE DECLARATION. Explore used to re-type this bar as its own
    // FILL_COVERAGE_QUALIFY / FILL_HORIZON_DAYS, which is how two surfaces end
    // up publishing and refusing the same employer: editing one file was
    // silent on the other. The constants are imported now, and a second
    // declaration here is the drift — so the guard forbids one.
    // RE-ANCHORED, AND ON A PREDICATE RATHER THAN ON A JSX PROP STRING.
    //
    // The old anchor sliced CODE between `intent="hiring"` and `intent="pay"`.
    // The hiring answer no longer renders CompanyGrid, so that literal is gone,
    // the slice came back EMPTY, and every assertion below it was passing
    // vacuously against "" — the repo's own "guards that pin spellings pass
    // while the code is dead" shape, inverted: red for a reason unrelated to
    // the property, with the property itself unguarded. The gate has one home
    // now, `heldFor`, and it is anchored there.
    //
    // AND THE END ANCHOR WAS DEAD TOO, WHICH WAS WORSE. `function
    // rankedFillClaims` no longer exists, so indexOf returned -1 and
    // slice(start, -1) handed back almost the entire file — the `not.toBe("")`
    // check passed vacuously and every assertion below was scoped to everything
    // that follows. gateSlice() now bounds the slice as well as locating it.
    const gate = gateSlice();
    // The two bars the SERVER cannot supply, in the one place the client
    // applies them. `sufficient` is the server's finding and reaches this
    // predicate through measureOf; the coverage floor and the observation
    // window are what get_company_fill_curve's COMMENT ON leaves to the caller.
    expect(gate).toMatch(/canStateFillRate\(\{ sufficient: m\.sufficient, dated_coverage: m\.coverage \?\? 0 \}, m\.days\)/);
    expect(gate, "the observation-window floor is the one `sufficient` cannot supply")
      .toMatch(/m\.days >= FILL_RATE_MIN_TRACKING_DAYS/);
    expect(gate, "a row with no measure must be held back, never rendered as a number")
      .toMatch(/return m\.answered \? "undated" : "unmeasured"/);
    // And the section may only render rows this predicate cleared. HiringGrid /
    // fill.shown became DurationGrid / duration.shown when the section stopped
    // leading with R(14); the property — the grid is fed the gated list, never
    // the payload — is unchanged.
    expect(CODE, "the grid must be fed from the gated list, not from the payload")
      .toMatch(/<DurationGrid claims=\{duration\.shown\} \/>/);
    expect(CODE, "the bar must be imported from /jobs, not re-typed here")
      .toMatch(/import \{[^}]*FILL_COVERAGE_MIN[^}]*FILL_RATE_MIN_TRACKING_DAYS[^}]*\} from "@\/pages\/Jobs"/);
    expect(CODE, "a second declaration of the bar is the drift this guard exists to stop")
      .not.toMatch(/const FILL_(?:COVERAGE|HORIZON|RATE)_[A-Z_]+ =/);
    // THE SPAN, PINNED AS A PROPERTY RATHER THAN AS A KEY. It moved out of the
    // badge ("{{d}}d of tracking") and into explore.durEvidence, printed on
    // every card. Two assertions, because either one alone is escapable: the
    // card must interpolate the EMPLOYER'S OWN span, and the claim type must
    // make that span non-optional, so no path can build a median without one.
    const card = CODE.slice(CODE.indexOf("function DurationGrid"), CODE.indexOf("function RecyclingGrid"));
    expect(card, "the duration card moved — re-anchor, do not delete").not.toBe("");
    expect(card.length, "the card slice is implausibly long — the end anchor drifted")
      .toBeLessThan(8000);
    expect(card, "the tracking span must stay beside the figure, on the card")
      .toMatch(/days: c\.windowDays/);
    const claim = CODE.slice(CODE.indexOf("interface DurationClaim"), CODE.indexOf("\n}", CODE.indexOf("interface DurationClaim")));
    expect(claim, "the DurationClaim interface moved — re-anchor, do not delete").not.toBe("");
    expect(claim, "the span must be required, or a median can render without one")
      .toMatch(/\bwindowDays: number;/);
    expect(claim, "the span became optional — a median over an unknown span is not a measurement")
      .not.toMatch(/windowDays\?:/);
    // THE CEILING WORD, not the key name. R(14) is an upper bound — the 24h
    // dedupe deletes superseded closures, so the relist side is a floor and the
    // fill share is a ceiling — and the demotion from headline to evidence line
    // is exactly the kind of edit that drops the marker on the way. Pinned on
    // the inline English default because explore.durRate is in no locale file,
    // so this default is what every reader gets.
    const rate = CODE.match(/t\("explore\.durRate",\s*"([^"]+)"/);
    expect(rate, "explore.durRate default not found — the R(14) line moved").toBeTruthy();
    expect(rate![1], "a ceiling published as a point estimate").toMatch(/^Up to \{\{pct\}\}%/);
    // AND THE MEDIAN'S OWN FLOOR MARKER, which the rebuild made possible and
    // nothing else guards. p50 is censored at FILL_SUPPORT_MAX_DAYS — roles
    // that outlived the cap never enter it — so the median can only be longer,
    // and the "+" is part of the number rather than a hedge beside it.
    expect(card, "the censored median lost its floor marker").toMatch(/\{nf\(c\.p50\)\}\+/);
  });

  it("sufficient/fill_rate_14/dated_coverage are merged in from the curve, not read off the row", () => {
    // The recorded failure of this exact clause: the four gate fields were
    // read straight off the hiring row, which does not carry them. `sufficient
    // === true` was therefore false for every row on every deploy — the badge
    // could not render once, and nine locales were translated for a string
    // with no call path. Assert both halves, so neither can drift back.
    expect(CODE).toMatch(/rpc\("get_company_fill_curve", \{ p_tokens: tokens \}\)/);
    const sql = latestWith("CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies")
      .replace(/^\s*--.*$/gm, "");
    const at = sql.indexOf("CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies");
    expect(at, "get_actively_hiring_companies not found").toBeGreaterThan(-1);
    const returns = sql.slice(at, sql.indexOf("LANGUAGE", at));
    expect(
      returns,
      "if the hiring RPC ever does return the curve fields, drop the merge instead of keeping both",
    ).not.toMatch(/fill_rate_14|dated_coverage|sufficient/);
  });
});

describe("the page behaves while it is still loading, and for keyboard users", () => {
  it("shows card-shaped placeholders instead of nothing", () => {
    // Every answer is gated on collection.length > 0, so before the cache read
    // returned a visitor saw a heading, chips, and empty space — which on this
    // page is indistinguishable from a section that is broken, and this page
    // has earned that reading elsewhere.
    expect(CODE).toMatch(/function GridSkeleton\(\)/);
    expect(CODE).toMatch(/\{loading && hiring\.length === 0 && \(/);
  });

  it("the skeleton is announced once, not as twelve empty rows", () => {
    const sk = CODE.slice(CODE.indexOf("function GridSkeleton"), CODE.indexOf("function Section"));
    expect(sk).toMatch(/role="status" aria-live="polite"/);
    expect(sk).toMatch(/aria-hidden="true"/);
  });

  it("loading clears on BOTH load paths", () => {
    // The cache fast-path returns early; a setLoading only after it would leave
    // the skeleton up forever on the common path.
    expect((CODE.match(/setLoading\(false\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
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
    expect(CODE).toMatch(/tabIndex=\{active === i \? 0 : -1\}/);
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

  it("the transparent median needs its OWN sample before it prints", () => {
    // The SQL medians whichever roles state USD pay with no floor, so ONE USD
    // posting was enough to publish "median floor $X" for an employer whose
    // other 300 roles say nothing.
    //
    // RE-POINTED TO A STRICTLY STRONGER GATE. The old spelling gated on
    // open_roles — the size of a DIFFERENT population from the median's own:
    // total served roles, not roles carrying a pay figure our parser resolved
    // to a US-dollar annual floor. usd_n is that median's actual sample, and it
    // is frequently far smaller (salary_min_annual is populated on roughly a
    // fifth of servable rows while the badge's basis is 80%+ for every employer
    // listed here). So the assertion follows the gate to the right population
    // rather than pinning the wrong one.
    expect(CODE, "the median's floor must be declared once, not inlined")
      .toMatch(/const PAY_MEDIAN_MIN_USD_N = 20;/);
    expect(CODE, "the median is gated on the wrong population's size")
      .toMatch(/usdN < PAY_MEDIAN_MIN_USD_N/);
    expect(CODE, "the sample must come from the median's own column")
      .toMatch(/const usdN = numOr\(r\.usd_n\);/);
    // AND THE ORDERING, WHICH THE SOURCE CALLS LOAD-BEARING. The SQL now nulls
    // the median itself below the floor, so if the null were tested first an
    // employer with three USD postings would render NO LINE AT ALL — and a
    // silence under this heading reads as "states no pay", the opposite of what
    // membership in this list means. The refusal has to outlive the number it
    // refuses.
    expect(CODE.indexOf("usdN < PAY_MEDIAN_MIN_USD_N"),
      "the sample must be tested before the null median, or the refusal disappears")
      .toBeLessThan(CODE.indexOf("if (med === null)"));
    expect(CODE.indexOf("if (med === null)"), "the null-median refusal is gone").toBeGreaterThan(-1);
    // And the weaker, wrong-population bar cannot come back.
    expect(CODE, "the median is gated on the board's size again")
      .not.toMatch(/median_usd_floor != null && \(r\.open_roles/);
  });
});

describe("the page says when it was measured", () => {
  it("renders the cache's own computed_at", () => {
    expect(EXPLORE).toMatch(/setComputedAt\(c\.computed_at\)/);
    expect(EXPLORE).toMatch(/t\("explore\.asOf"/);
  });

  it("only with a real timestamp — no timestamp, no claim", () => {
    expect(EXPLORE).toMatch(/\{computedAt && \(/);
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

  it("does not repeat itself under the answer that already states it", () => {
    expect(CODE).toMatch(/if \(!token \|\| on === "ghost"\) return null;/);
  });

  it("reaches the answers where a reader is being persuaded to trust", () => {
    // The point of item 3: the warning is worthless under the chip that is
    // already a warning. It has to reach the cards that RECOMMEND.
    //
    // `scale` came off the list with its section. The remaining three are the
    // answers that name an employer approvingly, and they all still carry it.
    for (const on of ["pay", "entry", "check"]) {
      expect(CODE, `no churn warning on the ${on} answer`).toMatch(
        new RegExp(`repostWarn\\((?:r\\.company_token|worstToken), "${on}"\\)`));
    }
    // AND WHY THE OTHER THREE ARE EXEMPT, pinned so the list cannot silently
    // shrink again. Two of the three exemptions were already guarded elsewhere;
    // the third — `aged`, a NEW named-employer answer this rebuild added — was
    // not guarded anywhere at all, and its entire safety rests on rankAged
    // filtering through the same predicate that excludes flagged employers from
    // the duration answer. Drop the serialReposters argument from rankAged and,
    // without these two lines, flagged employers appear on the age-out cards
    // with no warning and nothing goes red.
    expect(CODE, "the age-out answer must exclude flagged employers, as the duration answer does")
      .toMatch(/rows\.filter\(\(r\) => heldFor\(r, serialReposters\) === null\)/);
    expect(CODE, "rankAged must be handed the flagged set, or its filter is a no-op")
      .toMatch(/rankAged\(hiring, serialReposters\)/);
    // `ghost` is exempt because those cards state these numbers themselves, in
    // a better-grouped form — repeating them would read as two findings.
    expect(CODE, "the re-listing answer must not repeat the warning it already states")
      .toMatch(/if \(!token \|\| on === "ghost"\) return null;/);
  });

  it("the hiring answer excludes flagged employers instead of warning about them", () => {
    // "hiring" USED TO BE IN THE LIST ABOVE, and it was the wrong remedy for
    // that one answer. The section's own heading promises that employers whose
    // takedowns are mostly re-listings appear under Serial re-posters INSTEAD —
    // and four cards in this very section were rendering "Re-lists roles: 2,242
    // re-postings across 182 roles" underneath a recommendation. A card cannot
    // recommend an employer on its fill record and warn about its churn in the
    // same breath; one of the two has to go, and the gate is what the heading
    // already claimed. So the property is stated positively here rather than
    // deleted: the flagged set is CONSULTED by the one predicate that decides
    // what the section shows, and the exclusion is counted rather than silent.
    // Shares gateSlice() with the fill-rate test above, which is what makes the
    // dead `function rankedFillClaims` end anchor one fix rather than two. Its
    // -1 scoped this assertion to the rest of the file as well.
    const gate = gateSlice();
    expect(gate, "a flagged employer must be excluded from the hiring answer")
      .toMatch(/serialReposters\.has\(r\.company_token\)\) return "reposter"/);
    // THE FULL SPELLING. This was `explore.hiringHeldReposter`, which passes as
    // a PREFIX of the live `hiringHeldReposter2` — so a rename that dropped the
    // sentence's meaning while keeping its stem would not have been caught. The
    // key was re-minted because nine locales carry the old sentence naming a
    // section that no longer exists.
    expect(CODE, "and the exclusion must be counted, never silent")
      .toMatch(/explore\.hiringHeldReposter2/);
    expect(CODE, "the warning must not also render inside the section that disqualifies it")
      .not.toMatch(/repostWarn\((?:r\.company_token|worstToken), "hiring"\)/);
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

  it("counts the pool with the SAME call that produces the cards", () => {
    // Not a second query. Duplicating the HAVING clauses of either RPC gives
    // the >=100 open-roles floor, the 7-day fill definition and the churn
    // disqualification three fresh chances to drift — and every duplicated
    // predicate in this file's history has eventually disagreed with its
    // original. One statement yields both the twelve rows and the count.
    expect(REFRESH).toMatch(/INTO hiring_rows, hiring_n/);
    expect(REFRESH).toMatch(/INTO repost_rows, repost_pool_n/);
    expect(REFRESH).toMatch(/FILTER \(WHERE r\.rn <= 12\)/);
    // And the limits are raised past any real pool, or the count is a count of
    // the LIMIT rather than of the population.
    expect(REFRESH).toMatch(/get_actively_hiring_companies\(2000\)/);
    expect(REFRESH).toMatch(/get_repost_churn_companies\(9000\)/);
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
    for (const k of ["hiring_n", "repost_pool_n", "repost_flagged_n"]) {
      expect(REFRESH, `${k} can publish a zero`).toMatch(new RegExp(`'${k}',\\s*NULLIF\\(`));
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

  it("renders a note only when its counter arrived", () => {
    // A missing key is a FAILED SCAN and must produce silence, never "the 12
    // best of 0 employers". Two of these pairs were STRENGTHENED by the
    // rebuild, so the assertions follow them up rather than being re-pointed
    // flat — a re-point that dropped the new conjuncts would let the
    // strengthening be reverted with nothing going red.
    for (const [intent, key] of [["hiring", "totals\\.hiring_n"],
                                 ["ghost", "totals\\.relisting_pool_n"]] as const) {
      // Whitespace-tolerant: an exact-indent match would break on a reformat
      // and say the guard failed when only the layout moved.
      expect(CODE, `${intent} note is ungated`).toMatch(
        new RegExp(`${intent}:[\\s\\S]{0,120}?${key}\\s*\\?\\s*(t\\(|\\[)`));
    }
    // GHOST GAINED A CARD GATE AS WELL AS A COUNTER GATE. relisting_pool_n
    // comes off the raw RPC rows, BEFORE recyclingClaimOf applies its six
    // refusals, so a payload whose rows all lack a window or a first-seen date
    // yields a 1,204-employer denominator printed directly above a panel
    // holding no cards.
    expect(CODE, "the re-listing pool can be printed above an empty panel")
      .toMatch(/recycled\.length === 0 \? null/);
    // ENTRY GAINED TWO CONJUNCTS, and they are the stat-provenance rule applied
    // exactly: entry_n exists under BOTH the deployed five-role floor and this
    // rebuild's 10-entry/50-open pair, so its PRESENCE cannot say which one
    // produced it — and the frontend deploys before migrations apply. Without
    // these, entry_n degrades to a WRONG NUMBER under a sentence naming floors
    // it was not counted under.
    expect(CODE, "the entry pool is named without the floors it was counted under")
      .toMatch(/entry: totals\.entry_n\s*&&\s*totals\.entry_min_entry === ENTRY_MIN_ENTRY_ROLES\s*&&\s*totals\.entry_min_open === ENTRY_MIN_OPEN_ROLES/);
    // The pay note needs BOTH halves of its fraction before it may state one.
    expect(CODE).toMatch(/pay: totals\.pay_n && totals\.pay_pool_n/);
    // THE FIELDS NOTE IS GONE ON PURPOSE, and its removal is the assertion now.
    // It printed get_explore_denominators' UNCAPPED count as "open across the
    // board right now" while every chip beneath it is formatted through
    // SERVE_COUNT_CAP — one sentence, two runtimes, two numbers, the sentence
    // contradicting the eighteen numbers under it and the page each chip opens.
    expect(CODE, "the uncapped board-wide count is back above the capped chips")
      .not.toMatch(/fields:\s*totals\.postings_n/);
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
    for (const k of ["c.fields", "c.totals", "c.repost_index"]) {
      expect(CODE).toContain(`obj(${k})`);
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
    const REQUIRED: Record<string, string[]> = {
      repostWarn: ["{{events}}", "{{roles}}"],
      noteDurationPool: ["{{n}}", "{{cap}}"],
      noteDurationShown: ["{{shown}}"],
      noteRecyclePool: ["{{n}}", "{{cap}}"],
      noteRecycleFlagged: ["{{n}}"],
      noteAged: ["{{n}}"],
      noteEntryShare: ["{{n}}", "{{e}}", "{{o}}"],
      notePay: ["{{n}}", "{{pool}}"],
      notePayBoard: ["{{pct}}"],
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
      for (const dead of ["noteHiring", "noteEntry", "noteGhost", "noteGhostFlagged", "noteFields"]) {
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
    expect(called.length, "no callees found — the regex broke").toBeGreaterThan(5);

    const inner = called.map((fn) => [fn, timeoutOf(fn)] as const);
    for (const [fn, t] of inner) {
      expect(t, `${fn} has no statement_timeout, so it is unbounded inside the refresh`).toBeGreaterThan(0);
    }
    const sum = inner.reduce((a, [, t]) => a + t, 0);
    expect(outer, `inner ceilings total ${sum}s but the refresh budget is ${outer}s: ` +
      inner.map(([f, t]) => `${f}=${t}s`).join(", ")).toBeGreaterThanOrEqual(sum);
  });
});
