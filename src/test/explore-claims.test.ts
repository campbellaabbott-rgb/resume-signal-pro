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
  const RAW = latestWith("FUNCTION public.get_transparent_employers");
  const SQL = RAW.replace(/^\s*--.*$/gm, "");

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
    expect(SQL).toMatch(/FUNCTION public\.get_transparent_employers\(p_limit int DEFAULT 12\)\s*\nRETURNS jsonb/);
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

  it("the actively-hiring open-roles lateral is itself filtered", () => {
    // The figure beside a fill count comes from a LATERAL that had no predicate
    // at all. The function-level check above passes as soon as ANY clause in
    // the body carries the predicates, so the lateral gets its own assertion.
    const body = bodyOf("get_actively_hiring_companies");
    const lateral = body.slice(body.indexOf("JOIN LATERAL"));
    expect(lateral).toMatch(SERVED);
    expect(lateral).toMatch(WINDOW);
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
    expect(CODE).toMatch(/\{shown\.map\(\(i\) =>/);
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

  it("never offers an answer that would open empty", () => {
    expect(CODE).toMatch(/const shown = INTENTS\.filter/);
    expect(CODE).toMatch(/available\[intent\] \? intent :/);
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
