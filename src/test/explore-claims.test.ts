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
const localeFiles = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));

const latestWith = (fragment: string) => {
  const hit = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(resolve(MIG, f), "utf8"))
    .filter((t) => t.includes(fragment)).pop();
  if (!hit) throw new Error(`no migration contains: ${fragment}`);
  return hit;
};

describe("bands come from the payload, never from a hardcoded list", () => {
  it("does not iterate a literal band list", () => {
    // The bug in one line. A literal here cannot be kept in step with the SQL,
    // and when it drifts the section half-disappears in silence.
    expect(EXPLORE).not.toMatch(/\["enterprise",\s*"mid",\s*"small"\]/);
    expect(EXPLORE).toMatch(/orderedBands\(segments\)/);
  });

  it("the Segments type is open, so a renamed key still type-checks and renders", () => {
    expect(EXPLORE).toMatch(/type Segments = Record<string, Segment \| undefined>;/);
  });

  it("an unrecognised band falls back to a label instead of vanishing", () => {
    expect(EXPLORE).toMatch(/t\("explore\.segOther"/);
  });

  it("orders by roles-per-company — the dimension the bands are cut on", () => {
    // Ordering by TOTAL open roles looks equivalent and is not: the small band
    // holds 15,513 companies, so its aggregate outweighs mega's 212 and the
    // headings render "200-999, Under 50, 1,000+, 50-199". Verified live
    // before this was corrected.
    expect(CODE).toMatch(/open_roles \?\? 0\) \/ Math\.max\(b\[1\]\.companies, 1\)/);
  });

  it("sorts biggest-band-first on the live band shape", () => {
    // Exercised as data, not as a regex: the real payload's four bands must
    // come back mega, large, mid, small.
    const bands: Record<string, { companies: number; open_roles: number }> = {
      mid:   { companies: 1724,  open_roles: 120029 },
      mega:  { companies: 212,   open_roles: 129810 },
      large: { companies: 724,   open_roles: 175821 },
      small: { companies: 15513, open_roles: 157980 },
    };
    const order = Object.entries(bands)
      .sort((a, b) => b[1].open_roles / Math.max(b[1].companies, 1) - a[1].open_roles / Math.max(a[1].companies, 1))
      .map(([k]) => k);
    expect(order).toEqual(["mega", "large", "mid", "small"]);
  });
});

describe("no surface promises headcount the SQL never reads", () => {
  // Comments stripped. This assertion previously matched the phrase
  // "WAS GREATEST(sum(on_board), sum(feed_total))" inside a comment EXPLAINING
  // that the banding had changed — so it kept passing while asserting the
  // opposite of what the code did, and only failed once Lovable re-stamped the
  // migration and dropped the comments. A guard that a comment can satisfy is
  // not a guard.
  const sql = latestWith("FUNCTION public.get_size_segments").replace(/^\s*--.*$/gm, "");

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

  it("every locale's band labels describe open roles, not employees", () => {
    const EMPLOYEE_WORD = /employee|Mitarbeitende|empleado|salari|medewerker|funcionári|empleyado|कर्मचारी/i;
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of ["segMega", "segLarge", "segMid", "segSmall"]) {
        const v = e[k];
        if (!v) continue;
        expect(v, `${f} explore.${k} still labels a role-count band by employees: ${v}`)
          .not.toMatch(EMPLOYEE_WORD);
      }
    }
  });

  it("no locale still claims sourced headcounts in the blurb", () => {
    const CLAIM = /states its own headcount|nennt seine eigene Mitarbeiterzahl|indica su propia plantilla|Nothing is guessed/i;
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      if (!e.segBlurb) continue;
      expect(e.segBlurb, `${f} explore.segBlurb still promises headcount sourcing`).not.toMatch(CLAIM);
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
    expect(latestWith("FUNCTION public.refresh_explore_cache")).toMatch(/'transparent', transparent/);
  });

  it("a slow collection cannot blank the other six", () => {
    // The cache was all-or-nothing: one failing member aborted the INSERT and
    // froze every section with nothing saying so.
    const fn = latestWith("FUNCTION public.refresh_explore_cache");
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
  const SQL = latestWith("FUNCTION public.refresh_explore_cache").replace(/^\s*--.*$/gm, "");
  const CALLEE = latestWith("FUNCTION public.get_transparent_employers").replace(/^\s*--.*$/gm, "");

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
    const fn = latestWith("FUNCTION public.refresh_explore_cache");
    expect(fn).toMatch(/jsonb_typeof\(transparent\) <> 'array'/);
  });
});

describe("empty and failed are recorded as different things", () => {
  const fn = latestWith("FUNCTION public.refresh_explore_cache");

  it("the cache says WHY transparent is empty", () => {
    // `[]` meant both "nobody clears 80%" and "the query died" and looked
    // identical, which is why the failure survived weeks unnoticed.
    expect(fn).toMatch(/'transparent_status', transparent_status/);
    expect(fn).toMatch(/transparent_status text := 'ok';/);
    expect(fn).toMatch(/transparent_status := 'failed: ' \|\| left\(SQLERRM, 120\)/);
  });
});

describe("the query is made cheap and private, not merely patient", () => {
  const SQL = latestWith("FUNCTION public.get_transparent_employers").replace(/^\s*--.*$/gm, "");

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
    const sql = latestWith(`FUNCTION public.${fn}`).replace(/^\s*--.*$/gm, "");
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
    const sql = latestWith("FUNCTION public.get_size_segments").replace(/^\s*--.*$/gm, "");
    // The label says "open roles ... on our board"; on_board is that number.
    expect(sql).toMatch(/sum\(on_board\)::int AS effective/);
    expect(sql, "banding back on the advertised feed total")
      .not.toMatch(/GREATEST\(sum\(on_board\), sum\(feed_total\)\)::int AS effective/);
  });

  it("remote_pct draws numerator and denominator from the same column", () => {
    // remote=true is a strict subset of work_mode='remote' (5.2%-11.3%
    // narrower), so mixing them makes the ratio one of two populations.
    const sql = latestWith("FUNCTION public.get_size_segments").replace(/^\s*--.*$/gm, "");
    expect(sql).toMatch(/count\(\*\) FILTER \(WHERE p\.work_mode = 'remote'\)::int AS remote_n/);
  });

  it("salary benchmarks still report per-currency, never a mixed median", () => {
    // The highest-SORTING migration for this function carries an older,
    // currency-less body; production emits `currency`. Lovable re-stamps old
    // content with new timestamps, so filename order does not track what is
    // deployed — rebuilding from the "latest" file would have silently reverted
    // per-currency medians and made "Never converted, never mixed" false.
    const sql = latestWith("FUNCTION public.get_salary_benchmarks").replace(/^\s*--.*$/gm, "");
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

  it("both counts in the segment badge are grouped the same way", () => {
    // Rendered "3842 on our board · 12,000 company-wide" — one raw, one
    // grouped, in one sentence, because only `total` had .toLocaleString().
    //
    // EVERY onBoard interpolation, not just one: there are two call sites
    // (segOpenBoth and segOpen), and asserting the string appears once let a
    // mutation that un-grouped the first of them pass.
    const sites = [...CODE.matchAll(/\bn: onBoard\b(\.toLocaleString\(\))?/g)];
    expect(sites.length, "onBoard interpolation sites not found").toBeGreaterThanOrEqual(2);
    for (const m of sites) {
      expect(m[1], `an onBoard count is interpolated raw: ${m[0]}`).toBe(".toLocaleString()");
    }
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
    const hides = [...CODE.matchAll(/hidden=\{active !== "(\w+)"\}/g)].map((m) => m[1]);
    for (const i of ["hiring", "pay", "entry", "ghost", "scale", "fields"]) {
      expect(hides, `no hidden-gated body for intent "${i}"`).toContain(i);
    }
  });

  it("the chosen answer is in the URL", () => {
    expect(CODE).toMatch(/searchParams\.set\("i", next\)/);
    // replaceState, not push: switching answers is not a navigation, and six
    // history entries would make the back button feel broken.
    expect(CODE).toMatch(/history\.replaceState/);
  });

  it("never offers an answer that would open empty — once loaded", () => {
    // "Once loaded" is load-bearing. While the fetch is in flight every
    // collection is empty, so availability is UNKNOWN, not false. Deriving the
    // chips from it during load rendered two chips that then jumped to seven,
    // and pushed `active` to `check` — which hid the hiring skeleton for the
    // whole 540ms it existed to cover. Absence of data is not evidence of
    // absence; the rule this page applies to its numbers applies to its
    // controls too.
    expect(CODE).toMatch(/INTENTS\.filter\(\(i\) => available\[i\]\)/);
    expect(CODE).toMatch(/available\[intent\] \? intent :/);
    // Both must be gated on `loading`, or the fallback fires against data that
    // has simply not arrived yet.
    expect(CODE).toMatch(/const shown = loading \? INTENTS :/);
    expect(CODE).toMatch(/const active: Intent = loading \? intent :/);
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

  it("only one size band's cards render at a time", () => {
    // 36 of 48 cards leave the viewport while all four aggregates stay.
    expect(CODE).toMatch(/const open = activeBand === band;/);
    expect(CODE).toMatch(/return open \? \(/);
  });

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
  const NEW_KEYS: Record<string, string[]> = {
    entryBadgeRatio: ["{{entry}}", "{{open}}"],
    repostAcross: ["{{roles}}"],
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
    const keys = ["intentHiring", "intentPay", "intentEntry", "intentGhost", "intentScale", "intentFields", "searchAll"];
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of keys) expect(e[k], `${f} is missing explore.${k}`).toBeTruthy();
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
  const sql = latestWith("FUNCTION public.get_transparent_employers").replace(/^\s*--.*$/gm, "");
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
    const GONE = /Trending Companies|trending boards|fastest-growing/i;
    const code = entry.replace(/^\s*\/\/.*$/gm, "");
    expect(code, `prerender-seo.mjs still advertises a removed collection`).not.toMatch(GONE);
  });

  it("neither does the client-side copy, in any locale", () => {
    const GONE = /Trending Companies|hiring fastest|newly added/i;
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of ["seoTitle2", "seoDescription2", "subhead2"]) {
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
  const sql = latestWith("FUNCTION public.get_company_suggest").replace(/^\s*--.*$/gm, "");
  // $$; anchored to the function start. Searching from 0 finds whichever
  // function is FIRST in the migration — two live in this one — which yielded a
  // negative slice and an assertion that could never match.
  const fnAt = sql.indexOf("FUNCTION public.get_company_suggest");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));

  it("never returns the facet count to the client", () => {
    // companiesFacet.count is count(*) GROUP BY company_token with NEITHER
    // serving predicate. It may rank and match; publishing it would put a
    // number on screen that the destination contradicts.
    expect(body).toMatch(/RETURNS TABLE\(name text, tokens text\[\]\)/);
    expect(CODE, "Explore must not render a count on a lookup result")
      .not.toMatch(/h\.count|hit\.count/);
  });

  it("reads the cached facets row, never an aggregate", () => {
    // A request-path aggregate over 605k postings is the 26s-per-view mistake.
    expect(body).toMatch(/FROM public\.job_board_meta m/);
    expect(body).toMatch(/WHERE m\.k = 'facets'/);
    expect(body).not.toMatch(/FROM public\.job_board_postings/);
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
    expect(CODE).toMatch(/check: true,/);
    expect(CODE).toMatch(/INTENTS: readonly Intent\[\] = \["check",/);
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
    const block = CODE.slice(CODE.indexOf("const s = cq.trim();"), CODE.indexOf("const bands ="));
    expect(block).toMatch(/if \(s\.length < 3\)/);
    expect(block).toMatch(/setTimeout\(/);
  });
});

describe("the page the lookup points at answers honestly", () => {
  const sql = latestWith("FUNCTION public.get_company_hiring_health").replace(/^\s*--.*$/gm, "");
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
  const sql = latestWith("FUNCTION public.get_actively_hiring_companies").replace(/^\s*--.*$/gm, "");
  const fnAt = sql.indexOf("FUNCTION public.get_actively_hiring_companies");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));

  it("ranks on fills per open role", () => {
    expect(body).toMatch(/ORDER BY \(f\.filled \* 100\.0 \/ o\.n\) DESC/);
    expect(body, "ranked on absolute fills again — that is a size ranking")
      .not.toMatch(/ORDER BY f\.filled DESC, o\.n DESC\s*\n\s*LIMIT/);
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

  it("the card shows the clock only on a real sample", () => {
    // A median over four dated closures is noise dressed as a deadline.
    expect(CODE).toMatch(/\(r\.dated_n \?\? 0\) >= 10 && r\.tracking_days >= 21/);
    expect(CODE).toMatch(/explore\.hiringSpeed/);
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

  it("the transparent median needs a sample before it prints", () => {
    // The SQL medians whichever roles state USD pay with no floor, so ONE USD
    // posting was enough to publish "median floor $X" for an employer whose
    // other 300 roles say nothing.
    expect(CODE).toMatch(/r\.median_usd_floor != null && \(r\.open_roles \?\? 0\) >= 20/);
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

describe("every t() key the page uses exists in English", () => {
  it("has no key referenced only in code", () => {
    // explore.repostBadgeCapped shipped referenced-but-undefined in all nine
    // locales, on the branch that fires for the worst real re-posters.
    const en = (JSON.parse(readFileSync(resolve(LOCALES, "en.json"), "utf8")).explore ?? {}) as Record<string, string>;
    const used = [...EXPLORE.matchAll(/t\("explore\.([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    expect(used.length, "no explore t() keys found — regex broken").toBeGreaterThan(10);
    const missing = [...new Set(used)].filter((k) => !(k in en));
    expect(missing, `referenced in Explore.tsx but absent from en.json: ${missing.join(", ")}`).toEqual([]);
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
    const sql = latestWith(`FUNCTION public.${fn}`).replace(/^\s*--.*$/gm, "");
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
    // already a warning. It has to reach the cards that recommend.
    for (const on of ["hiring", "pay", "entry", "scale", "check"]) {
      expect(CODE, `no churn warning on the ${on} answer`).toMatch(
        new RegExp(`repostWarn\\((?:r\\.company_token|worstToken), "${on}"\\)`));
    }
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
    const sql = latestWith("FUNCTION public.get_explore_denominators").replace(/^\s*--.*$/gm, "");
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
    const sql = latestWith("FUNCTION public.refresh_explore_cache").replace(/^\s*--.*$/gm, "");
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
    const sql = latestWith("FUNCTION public.get_explore_denominators").replace(/^\s*--.*$/gm, "");
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
    expect(latestWith("FUNCTION public.get_explore_denominators")).toMatch(/jsonb_strip_nulls/);
  });

  it("every optional block degrades without taking the payload down", () => {
    // The cache row must still be written when any one collection fails, or a
    // single slow scan freezes every answer on the page.
    const handlers = REFRESH.match(/EXCEPTION WHEN OTHERS THEN/g) ?? [];
    expect(handlers.length, "an unwrapped block can abort the whole refresh").toBeGreaterThanOrEqual(5);
  });

  it("renders a note only when its counter arrived", () => {
    for (const [intent, key] of [["hiring", "totals\\.hiring_n"], ["entry", "totals\\.entry_n"],
                                 ["ghost", "totals\\.repost_pool_n"], ["fields", "totals\\.postings_n"]] as const) {
      // Whitespace-tolerant: an exact-indent match would break on a reformat
      // and say the guard failed when only the layout moved.
      expect(CODE, `${intent} note is ungated`).toMatch(
        new RegExp(`${intent}:\\s*${key}\\s*\\?\\s*(t\\(|\\[)`));
    }
    // The pay note needs BOTH halves of its fraction before it may state one.
    expect(CODE).toMatch(/pay: totals\.pay_n && totals\.pay_pool_n/);
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
    const REQUIRED: Record<string, string[]> = {
      repostWarn: ["{{events}}", "{{roles}}"],
      noteHiring: ["{{n}}"],
      notePay: ["{{n}}", "{{pool}}"],
      notePayBoard: ["{{pct}}"],
      noteEntry: ["{{n}}"],
      noteGhost: ["{{n}}"],
      noteGhostFlagged: ["{{n}}"],
      noteFields: ["{{n}}"],
    };
    // English must carry all of them — the page's own key-exists guard above
    // requires it, and this pins the shape as well as the presence.
    const en = (JSON.parse(readFileSync(resolve(LOCALES, "en.json"), "utf8")).explore ?? {}) as Record<string, string>;
    for (const key of Object.keys(REQUIRED)) {
      expect(typeof en[key], `en.json is missing explore.${key}`).toBe("string");
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
