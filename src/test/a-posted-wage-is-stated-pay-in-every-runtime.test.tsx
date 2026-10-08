/**
 * A POSTED WAGE IS STATED PAY — IN EVERY RUNTIME THAT ANSWERS THE QUESTION.
 *
 * WHAT THIS GUARDS, AND WHY. "States pay" decided what counts as stated pay from
 * the ANNUALISED figure, while the card renders its pay span from the employer's
 * verbatim pay TEXT. So the board printed the wage in bold on rows the control
 * had just classified as silent, and the rows it dropped were not a random slice:
 * the shared parser deliberately refuses a 2,080-hour year for a rate carrying a
 * part-time, casual, per-diem or on-call signal, so the dropped population was
 * disproportionately the part-time and casual work whose seekers most need a
 * posted wage.
 *
 * MEASURED LIVE, anon key, through the board's own read paths, every figure
 * stamped because this corpus moves about 2% an hour:
 *   * Two COMPLETE country strata walked row by row — every row read, nothing
 *     sampled. IE at 2026-09-27T02:01:53Z: 2,575 rows, 312 with pay text, 282
 *     with an annual figure -> 30 postings printing a wage under a control
 *     calling them silent. NZ at 02:02:42Z: 1,455 / 161 / 143 -> 18. Both walks
 *     matched the board's own counted answer for the same stratum EXACTLY (282
 *     and 143, counted at 02:01:02Z and 02:01:04Z), which is what makes them a
 *     measurement rather than a sample.
 *   * The hourly slice, counted per country at 02:00:55Z-02:01:10Z as hourly
 *     against hourly-and-flagged-as-stating-pay: CA 2,170/1,461, GB 1,875/905,
 *     AU 464/168, IE 82/68, NZ 38/23, DE 26/23, NL 24/13.
 *   * Board-wide, ONE scan over 733,190 servable rows at 2026-09-27T02:07:00Z:
 *     207,108 carry pay text, 173,868 an annual figure, 173,826 a figure a pay
 *     floor can compare. So the widened predicate admits 33,240 postings, the
 *     control's published reach moves 23.71% -> 28.25%, and the
 *     annual-but-unconvertible slice the page cannot see is 42 rows.
 *   * Live evidence rows reachable by NO pay control before this change, all
 *     three printing their figure on the card:
 *     teamtailor:hopscotchdaynurseries:8454515 "£15,268.50 - £16,286.40",
 *     oracle:efet~us2~CX_1:224727 "£12.71 to £14.00" (a part-time role), and
 *     oracle:fa-eqvg-saasfaprod1~ocs~CX_1:7518 "£18,389-£19,099".
 *
 * WHY A SECOND FILE. the-pay-controls-say-what-they-compare pins the SENTENCES
 * each control prints, and holds the inverted copy pins. This file pins the
 * PLUMBING the widening depends on, which is where it can go wrong silently:
 * the row audit that reports violations, the coverage key the disclosure reads,
 * the invariant the widening rests on, the three controls that deliberately did
 * NOT move, and the per-page gap sentence that has to print exactly where the
 * board-wide percentages are withheld.
 *
 * TEETH, PROVEN NOT ASSUMED (2026-09-27; each break applied to the file as it
 * stands, this file run, the break reverted by inverse patch — never from a
 * snapshot, because the tree is shared). What went red, by name:
 *   * the row audit reverted to the annualised column -> "an hourly row the
 *     board displays is not a filter violation", while "the row audit still
 *     catches a posting with no pay field at all" stayed green — the pair that
 *     proves the audit was narrowed rather than switched off.
 *   * `cov.salaryText` reverted to `cov.hasStatedPay` in coverageDisclosure ->
 *     "the coverage percentage counts the column the filter binds".
 *   * `salaryText: keep("salaryText")` deleted from the refresh pass -> the same
 *     case, on its other half: the key the disclosure reads is then never
 *     written, so the sentence is dead rather than wrong.
 *   * MEASURED_COVERAGE.hasStatedPay put back to 0.201 -> "the pinned fallback
 *     describes the column the filter now binds".
 *   * nesting_holds deleted from get_filter_coverage's live definition -> "the
 *     database still checks the nesting this widening rests on".
 *   * the salary-sorted exit's unpriced exclusion deleted -> "the pay-sorted
 *     search still excludes what it cannot rank, and says so".
 *   * the gap paragraph's `data-pay-gap` marker moved inside the board-wide
 *     coverage gate -> "the per-page gap prints on a narrowed page, where the
 *     board-wide figures cannot".
 *
 * THE 2026-09-27 REVIEW PASS. Nine findings landed on this file and its subject;
 * five of them said a guard here was resting on the wrong thing, so the
 * corrections are recorded next to the cases they changed. In summary:
 *   * nesting_holds was described as "the one standing proof of the invariant".
 *     It is a comparison of COUNTS and cannot see a row with a figure and no
 *     text behind it, which is the only thing the widening could lose. The
 *     per-row question is published by 20260927041903 and pinned instead.
 *   * the blank-pay-string case said the sensor's extra strictness stops a row
 *     being served. It cannot; all four query arms are bare NOT-NULL tests. What
 *     it costs is a FALSE incident, and the case now says so and requires the
 *     comment beside the code to say so too.
 *   * the SERVER half of the gap sentence was unguarded — a reviewer deleted the
 *     spread that publishes it and the whole 71-file battery stayed green. It is
 *     now transpiled out of the Deno source and CALLED.
 *   * the gap sentence printed on pages with NO pay control active: measured on
 *     20 default-shape live pages, 10 of 20 would have carried it. Gated on both
 *     sides, with a case for the ungated-server state.
 *   * the two runtimes that answer this predicate deploy independently, so the
 *     count and the page could describe populations 33,240 rows apart with
 *     nothing reporting it. The cover is pinned by structure, not by spelling.
 *
 * NEW TEETH, PROVEN 2026-09-27 (each break applied to the tree as it stands, the
 * file run, the break reverted by inverse patch). What went red, by name:
 *   * the spread that publishes payTextWithoutAnnual neutered -> all four cases
 *     in "the server actually produces the number the page promises", with the
 *     message naming the nine-locale copy that promises it.
 *   * the server's pay-control gate removed -> "says nothing at all when no pay
 *     control is in use".
 *   * the client's pay-control gate removed -> "no gap sentence on an ordinary
 *     browse, even when the server sends the field".
 *   * cappedCount's deploy-window stand-down removed, and separately the
 *     category rail's -> "the stated-pay count stands down from the RPC exactly
 *     where the two SQL versions could disagree".
 *   * the per-row counter renamed in the migration, and separately dropped from
 *     the refresh pass -> "the database publishes the PER-ROW invariant this
 *     widening rests on, not just the count nesting".
 *   * the retired "must never be quoted beside a pay control" sentence put back
 *     into the catalogue -> "the catalogue no longer forbids what the board
 *     does".
 *   * the filters.ts comment reverted to claiming the sensor and the query make
 *     one test -> "an empty pay string is reported, and the report is the only
 *     thing it changes".
 *   * the measurement date deleted beside the retired 20.1% (either citation),
 *     and separately a pay fraction pinned in Jobs.tsx's code -> "Jobs.tsx pins
 *     no pay fraction and dates every retired one".
 *   * de.json's tooltip qualifier dropped -> "no locale keeps a pay sentence
 *     that has lost its qualifier", in the sibling file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { codeOf } from "./helpers/strip-comments";
import { liveCommentOn, liveDefinitionOf } from "./helpers/live-sql";
import { filterViolations, normalizeFilters, type AppliedFilters } from "../../supabase/functions/job-board/filters";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "../pages/Jobs";

const root = resolve(__dirname, "../..");
const BOARD_RAW = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");
const BOARD = codeOf(BOARD_RAW);
/** Jobs.tsx twice over: the CODE for anything a guard pins, and the raw file for
 *  the provenance rule, which is about comments by definition. */
const JOBS_RAW = readFileSync(resolve(root, "src/pages/Jobs.tsx"), "utf8");
const JOBS = codeOf(JOBS_RAW);

/** Every filter off, so each case below turns on exactly the one it is about. */
const NONE = normalizeFilters({}, 60).applied;
const withStatedPay: AppliedFilters = { ...NONE, hasStatedPay: true };

/** THE LIVE EVIDENCE ROW, verbatim from the board on 2026-09-27: an hourly wage
 *  the card prints, with no annualised figure behind it, and no stated period —
 *  so it was reachable by the hourly control either. */
const HOURLY_DISPLAYED = {
  id: "oracle:efet~us2~CX_1:224727",
  source: "oracle", token: "efet~us2~CX_1", company: "Hilton",
  title: "Painter and Decorator - Part-time",
  location: "Croydon, Surrey, United Kingdom", country: "GB",
  salary: "£12.71 to £14.00", salaryMinAnnual: null, salaryMaxAnnual: null,
  salaryPeriod: null, salaryCurrency: "GBP",
  workMode: null, employmentType: "part_time", experienceBand: null, minYears: null,
  category: "retail", department: null, agency: false, remote: false,
  postedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), recheckedAt: null,
  applyUrl: "https://example.invalid/2",
};
/** A posting whose employer wrote nothing in the pay field. This one really is
 *  silent about pay, and a stated-pay page serving it is still the defect. */
const SILENT = { ...HOURLY_DISPLAYED, id: "oracle:efet~us2~CX_1:000000", salary: null };
/** An annualised row, so the narrowed audit is never vacuously green. */
const ANNUALISED = {
  ...HOURLY_DISPLAYED,
  id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
  title: "Staff Engineer", category: "engineering", employmentType: "full_time",
  salary: "$120,000 – $150,000", salaryMinAnnual: 120000, salaryMaxAnnual: 150000,
  salaryPeriod: "year", salaryCurrency: "USD",
  applyUrl: "https://example.invalid/1",
};

function mountWith(reply: Record<string, unknown>, url: string) {
  window.history.replaceState({}, "", url);
  rpc.mockImplementation(async () => ({ data: [], error: null }));
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn !== "job-board") return { data: {}, error: null };
    if (b.action === "facets") return { data: { categories: { engineering: 61_204 }, refreshedAt: null }, error: null };
    if (b.action === "list" && (b.facetCounts || b.countOnly)) return { data: { categories: {}, total: 2 } };
    if (b.action === "list") {
      return {
        data: {
          jobs: [ANNUALISED, HOURLY_DISPLAYED], totalAllCompanies: 2, companies: [], companiesCount: 0,
          categories: { engineering: 61_204 }, failedSources: [], failedCount: 0,
          refreshedAt: null, hasMore: false, total: 2,
          ...reply,
        },
      };
    }
    return { data: {} };
  });
  render(<MemoryRouter><Jobs /></MemoryRouter>);
}

// THE WAITING BUDGET, and why it is not a number chosen here:
// helpers/mount-budget.ts. This file had no shared constant at all -- seven
// inline five-second wait literals, each level with vitest's default per-test
// budget of the same five seconds and therefore unreachable, so a stuck wait
// was always reported as a bare test timeout naming nothing rather than as
// the assertion that never came true. They are now the one SLOW. The slowest
// case measured 2309 ms on the 2026-09-30 loaded run.
vi.setConfig(MOUNT_TEST_BUDGET);

const text = () => document.body.textContent ?? "";

describe("the row audit judges a stated-pay page by what the employer published", () => {
  /* GUARDS the p_work_mode-class sensor. filterViolations is what turns "an RPC
   * ignored this filter" into a reported incident, and it is the one check that
   * runs on every served row. Pointed at the annualised column while the query
   * binds the pay field, it reports every legitimately-admitted row as a
   * violation — 33,240 of them board-wide, unsampled — and an integrity channel
   * that floods is one somebody switches off. Exercised, not grepped: the real
   * module, the real applied-filter object, the real evidence row. */
  it("an hourly row the board displays is not a filter violation", () => {
    const v = filterViolations([HOURLY_DISPLAYED, ANNUALISED], withStatedPay);
    expect(
      v.filter((x) => x.field === "hasStatedPay"),
      "the audit flagged a posting whose wage the card prints — the sensor is reading a column the query no longer binds",
    ).toEqual([]);
  });

  it("the row audit still catches a posting with no pay field at all", () => {
    // The pair that proves the audit was NARROWED and not switched off. Without
    // this case, deleting the check entirely would pass the case above.
    const v = filterViolations([SILENT], withStatedPay);
    expect(v.map((x) => x.field), "a row with no pay text under a stated-pay request is still the defect")
      .toContain("hasStatedPay");
  });

  it("an empty pay string is reported, and the report is the only thing it changes", () => {
    // A vendor that sends blanks is not an employer who published a figure, so
    // the audit rejects one. THE QUERY DOES NOT: every arm is a bare NOT-NULL
    // test — the edge builder's and all three SQL bodies' — and PostgREST cannot
    // express a trim, so such a row IS served under this filter and renders no
    // wage on its card. The sensor cannot stop that. What this asymmetry costs is
    // one FALSE incident per page that serves the row, on the unsampled integrity
    // channel; what it buys is that a real ingest defect (clean() strips NUL
    // bytes and the writers' `|| null` maps "" to null, but neither trims) shows
    // up somewhere instead of nowhere. Unobserved today: 0 blank or
    // whitespace-only pay strings in 12,000 rows walked live 2026-09-27T03:30Z.
    // This case pins the asymmetry as DELIBERATE, and the comment on it in
    // filters.ts is required to say so rather than to claim the two tests match.
    const v = filterViolations([{ ...HOURLY_DISPLAYED, salary: "   " }], withStatedPay);
    expect(v.map((x) => x.field)).toContain("hasStatedPay");
    const FILTERS = readFileSync(resolve(root, "supabase/functions/job-board/filters.ts"), "utf8");
    expect(FILTERS, "the sensor is stricter than the query on a blank, and the comment beside it must not claim they are the same test")
      .not.toMatch(/Same NULL-and-blank test the query/);
    expect(FILTERS, "the asymmetry has to be named where the code is, or the next reader reads a false incident as a served row")
      .toMatch(/DELIBERATELY STRICTER THAN THE QUERY/);
  });

  it("the audit says nothing about pay when nobody asked about pay", () => {
    expect(filterViolations([SILENT, HOURLY_DISPLAYED], NONE).filter((x) => x.field === "hasStatedPay")).toEqual([]);
  });
});

describe("the coverage figure counts the column the filter binds", () => {
  /* GUARDS the shape where a disclosure and the count above it describe two
   * different populations. get_filter_coverage counts both pay columns on one
   * scan; the filter binds the wider one, so the sentence has to read the wider
   * one or it understates the control's reach by 4.5 points directly underneath a
   * count taken with the wider predicate.
   *
   * DERIVED FROM THE SOURCE, in both directions, because the two halves fail
   * differently: reading the wrong key prints a WRONG number, and reading a key
   * the refresh pass never stores prints NO number — a disclosure nobody
   * renders, which this repository has shipped before. */
  it("the coverage percentage counts the column the filter binds", () => {
    const read = /out\.hasStatedPay = liveOr\(cov\.(\w+),/.exec(BOARD);
    expect(read, "coverageDisclosure no longer emits a hasStatedPay figure at all").not.toBeNull();
    const key = read![1];
    expect(key, "the states-pay disclosure must read the verbatim pay field's share, not the annualised one")
      .toBe("salaryText");
    // …and that key must actually be written by the pass that builds the block,
    // on BOTH of its paths: the one-scan RPC path and the per-column fallback.
    expect(BOARD, `the refresh pass does not store ${key}, so this disclosure is dead rather than wrong`)
      .toContain(`${key}: keep("${key}")`);
    expect(BOARD, `the fallback path drops ${key}, and the upsert replaces the block whole — the figure would vanish on any pass where the RPC fails`)
      .toContain(`${key}: carryLive("${key}")`);
  });

  it("the pinned fallback describes the column the filter now binds", () => {
    // A constant that silently changes which column it describes is how a number
    // stays plausible while going wrong. 0.201 was the annualised column on
    // 2026-08-25; the pay field read 28.25% on 2026-09-27.
    const m = /hasStatedPay: (0\.\d+),/.exec(BOARD);
    expect(m, "MEASURED_COVERAGE no longer pins a hasStatedPay fallback").not.toBeNull();
    const pinned = Number(m![1]);
    expect(pinned, "the retired 0.201 counted the annualised figure — a different question from the one this filter now asks")
      .not.toBe(0.201);
    // BOUNDED RATHER THAN PINNED to three decimals: the corpus moves, and a guard
    // that fails on a legitimate re-measurement teaches people to edit guards.
    // The annualised share (0.2371 live) sits below this floor, so a silent
    // revert fails; the ceiling catches a fraction written as a percentage.
    expect(pinned, "the fallback must describe the pay-field share (0.2825 live 2026-09-27), not the annualised one (0.2371)")
      .toBeGreaterThan(0.25);
    expect(pinned).toBeLessThan(0.5);
  });

  it("the database publishes the PER-ROW invariant this widening rests on, not just the count nesting", () => {
    // WHAT THE WIDENING ACTUALLY DEPENDS ON: every annualised figure has the
    // employer's text behind it. Measured true on every walk taken for this
    // change — 0 rows with an annual and no text in 4,030 (two complete country
    // strata), in 18,000 (six slices) and in 12,000 (the two structured-pay
    // vendors, 2026-09-27T03:30Z).
    //
    // nesting_holds CANNOT PROVE THAT, and this case used to say it was "the one
    // standing proof of the invariant". It compares COUNTS: 5,000 rows with an
    // annual and no text, beside 207,000 rows with text, leaves it true while the
    // widened predicate silently drops those 5,000 stated-pay rows. Per-row
    // nesting implies the count nesting; the converse is false, so the check was
    // being read as evidence for something it cannot see. 20260927041903
    // publishes the per-row question directly as a count that is zero exactly
    // when the invariant holds, and that is what this pins. nesting_holds stays —
    // it is a cheap sanity check on the same scan — but nothing calls it a proof.
    const { file, body } = liveDefinitionOf("get_filter_coverage");
    expect(body, `${file} no longer publishes the pay-column nesting check`).toContain("nesting_holds");
    expect(body, `${file} no longer counts the verbatim pay field, which is the column the states-pay filter binds`)
      .toContain("'salaryText'");
    expect(body, `${file} does not publish the per-row invariant — nesting_holds alone cannot see a row with a figure and no text behind it`)
      .toContain("'annual_without_text'");
    expect(body, "the per-row count must be the rows with a figure and NO employer text, which is the only population this widening could lose")
      .toMatch(/annual_without_text'[\s\S]{0,200}salary IS NULL AND salary_min_annual IS NOT NULL/);
    // And the refresh pass has to KEEP it, or the number is computed hourly and
    // thrown away — which is exactly what happened to the pay-field count for
    // eighteen days before this change went looking for it.
    expect(BOARD, "the refresh pass drops the per-row invariant, so nothing outside the database can ever read it")
      .toContain("annualWithoutText: typeof fc.annual_without_text");
    expect(BOARD, "the fallback path drops it, and the upsert replaces the coverage block whole — it would vanish on any pass where the one-scan RPC fails")
      .toContain('annualWithoutText: carryLive("annualWithoutText")');
  });

  it("the catalogue no longer forbids what the board does", () => {
    // THE DATABASE'S OWN DESCRIPTION IS THE AUTHORITY A READER GETS, and it said
    // of the pay-text count that no filter binds that column and that it must
    // never be quoted beside a pay control — while this change bound it and
    // quoted it there. A function whose description goes false is the claim-drift
    // shape one runtime over, and it is worse than a stale source comment because
    // the next author reads it out of the live catalogue and believes it.
    const { file, body } = liveDefinitionOf("get_filter_coverage");
    const { comment } = liveCommentOn("get_filter_coverage");
    for (const [what, text] of [["body", body], ["COMMENT", comment]] as const) {
      expect(text, `the live ${what} of get_filter_coverage (${file}) still forbids quoting the pay-field share beside a pay control`)
        .not.toMatch(/must never be quoted beside a pay control/);
    }
    expect(comment, `${file}'s COMMENT must say which control binds the pay field, or the catalogue documents the retired contract`)
      .toMatch(/STATES-PAY FILTER binds/);
    expect(comment, "and it must keep saying that a pay FLOOR quotes the converted column, which did NOT move")
      .toMatch(/pay FLOOR, a pay CEILING or the pay ORDER binds/);
    // The field grid's description carried the same retired sentence about its
    // own pay-text count, and /explore's states-pay chip now reads that count.
    const grid = liveCommentOn("get_explore_field_grid");
    expect(grid.comment, `${grid.file} still tells the next reader that no pay chip may quote the pay-field count`)
      .not.toMatch(/no filter binds[\s\S]{0,120}no pay control may quote/);
    expect(grid.comment, "the grid must name the count the states-pay chip quotes").toMatch(/STATES-PAY FILTER binds/);
  });
});

describe("the controls that compare an amount did not move", () => {
  /* GUARDS the other half of the decision. The floor, the ceiling and the pay
   * order compare an approximate-USD generated column, which does not exist for a
   * rate we declined to annualise — and annualising a part-time wage to close the
   * gap is how a $44/hr rate was once served at a $90k floor as 91,520. They keep
   * excluding those rows on purpose. Widening one of these to match the checkbox
   * would be silently annualising; this is the pin that makes that a red test. */
  it("the floor and the ceiling still compare the converted column", () => {
    expect(BOARD).toContain('q.gte("salary_rank_usd", applied.salaryFloor)');
    expect(BOARD).toContain('q.lte("salary_rank_usd", applied.salaryCeiling)');
    expect(BOARD, "the floor must not follow the checkbox onto the pay text: a text is not an amount and cannot be compared to one")
      .not.toMatch(/applied\.salaryFloor[\s\S]{0,80}\.gte\("salary",/);
  });

  it("the pay-sorted search still excludes what it cannot rank, and says so", () => {
    expect(BOARD).toContain('.not("salary_rank_usd", "is", null)');
    expect(BOARD, "salaryStatedOnly is how the page learns those rows were excluded rather than sorted last")
      .toContain("salaryStatedOnly: true");
  });

  it("all three SQL functions still compare the floor against the converted column", () => {
    for (const fn of ["search_jobs", "count_jobs_capped", "fuzzy_title_search"]) {
      const { file, body } = liveDefinitionOf(fn);
      expect(body, `${fn} has no live definition`).not.toBe("");
      expect(body, `${fn} (live in ${file}) no longer compares the floor against the converted column`)
        .toMatch(/p_salary_floor[\s\S]{0,240}salary_rank_usd/);
    }
  });
});

describe("the server actually produces the number the page promises", () => {
  /* GUARDS THE HALF NOTHING HELD. The client render of the gap sentence was
   * pinned; the SERVER expression that produces the field was not, and a reviewer
   * deleted the whole spread and ran the entire affected battery — 71 files, 1,625
   * tests — green. The two client cases pass because the mocked reply injects the
   * field, so they test the renderer and not its existence. The nine-locale
   * tooltip promises this number exists, so its producer is load-bearing copy.
   *
   * EXERCISED, NOT GREPPED. Both halves are lifted out of the Deno source and
   * CALLED: the computation block and the spread that publishes it. A grep would
   * pass against a spread that computes the wrong thing; this runs the real
   * arithmetic over real row shapes. Extraction failing is itself the failure —
   * if the block or the spread is deleted or renamed, there is nothing to call. */
  type Emitter = (
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    j: unknown[],
  ) => { payTextWithoutAnnual?: { rows: number; of: number } };
  /** LAZY AND MEMOISED, so a deleted producer fails these tests BY NAME instead
   *  of erroring during collection and taking the whole file down with a "no
   *  tests" line — a red that does not say what broke is most of a guard wasted. */
  let built: Emitter | null = null;
  const emit: Emitter = (a, b, j) => {
    if (!built) {
      const i = BOARD.indexOf("const payControlActive");
      if (i < 0) throw new Error("serveList no longer computes payControlActive — the gap sentence has no gate and no producer");
      const k = BOARD.indexOf("const notAnnualised", i);
      const j2 = BOARD.indexOf(".length;", k);
      if (k < 0 || j2 < 0) throw new Error("serveList no longer counts the rows the pay controls cannot compare (notAnnualised is gone)");
      const compute = BOARD.slice(i, j2 + ".length;".length);
      const spread = /\.\.\.\(notAnnualised > 0 \? \{ payTextWithoutAnnual: \{[^}]*\} \} : \{\}\),/.exec(BOARD);
      if (!spread) {
        throw new Error(
          "nothing publishes payTextWithoutAnnual any more — the states-pay tooltip promises this number in nine languages, so deleting the producer makes the copy false",
        );
      }
      // eslint-disable-next-line no-new-func
      built = new Function("applied", "body", "jobs", `${compute}\nreturn { ${spread[0].replace(/,$/, "")} };`) as Emitter;
    }
    return built(a, b, j);
  };
  const PAY_OFF = { hasStatedPay: false, salaryFloor: null, salaryCeiling: null };

  it("counts the rows that print a rate with no yearly figure behind them", () => {
    const out = emit({ ...PAY_OFF, hasStatedPay: true }, {}, [ANNUALISED, HOURLY_DISPLAYED]);
    expect(out.payTextWithoutAnnual, "the server computed no gap on a page that has one").toEqual({ rows: 1, of: 2 });
  });

  it("says nothing on a page where nothing was excluded", () => {
    expect(emit({ ...PAY_OFF, hasStatedPay: true }, {}, [ANNUALISED]).payTextWithoutAnnual).toBeUndefined();
  });

  it("does not count a blank pay field as a printed rate", () => {
    // A whitespace pay field renders no wage, so counting it would publish a
    // number about rows the reader cannot see. The query admits such a row; this
    // sentence must not describe it.
    const out = emit({ ...PAY_OFF, hasStatedPay: true }, {}, [{ ...HOURLY_DISPLAYED, salary: "   " }]);
    expect(out.payTextWithoutAnnual).toBeUndefined();
  });

  it("says nothing at all when no pay control is in use", () => {
    /* THE STATE THAT MADE THIS A DEFECT. The field was emitted whenever any
     * served row carried pay text and no annual figure, which on an ordinary
     * browse is most pages: measured live 2026-09-27T03:29:49Z-03:30:23Z over 20
     * default-shape pages from offset 0 to 494,000, 10 of the 20 carried at least
     * one such row (24 rows of 1,176 served, worst page 4 of 60). So four readers
     * in ten who had touched no pay control were told that three controls they
     * never used could not compare part of the page — a disclosure that does not
     * describe the page it prints under, which is the objection this file's own
     * zero case already makes. */
    expect(emit(PAY_OFF, {}, [ANNUALISED, HOURLY_DISPLAYED]).payTextWithoutAnnual).toBeUndefined();
    // …and it is the PAY controls that open it, all four of them, because each one
    // is a state in which the gap can bite.
    expect(emit({ ...PAY_OFF, salaryFloor: 80_000 }, {}, [HOURLY_DISPLAYED]).payTextWithoutAnnual).toEqual({ rows: 1, of: 1 });
    expect(emit({ ...PAY_OFF, salaryCeiling: 80_000 }, {}, [HOURLY_DISPLAYED]).payTextWithoutAnnual).toEqual({ rows: 1, of: 1 });
    expect(emit(PAY_OFF, { sort: "salary" }, [HOURLY_DISPLAYED]).payTextWithoutAnnual).toEqual({ rows: 1, of: 1 });
  });
});

describe("the count and the page cannot describe different populations across the deploy window", () => {
  /* GUARDS THE 2026-07-25 DEFECT ARRIVING THROUGH THE DEPLOY RATHER THAN THROUGH
   * A MISSING PARAMETER. The stated-pay predicate now lives in an edge bundle and
   * in three SQL functions that ship down DIFFERENT PIPES, minutes to days apart,
   * with publishes known to skip functions outright. The page's rows come from
   * buildQuery; the headline count for those same paths comes from
   * count_jobs_capped. Whichever lands first, the two describe populations 33,240
   * rows apart, and nothing reports it: the SQL has accepted the parameter since
   * 20260826041500, so the old definition answers 200 with a narrower number and
   * no error. The cross-runtime guard cannot see this — it reads source files, not
   * deployed versions.
   *
   * WHAT THE COVER IS: cappedCount stands down for a stated-pay count the two SQL
   * versions could disagree about, and the caller falls through to the exact
   * buildQuery count, which is correct against BOTH versions — the same idiom the
   * multi-country deploy guard beside it already uses. It stands down only on an
   * UNCAPPED answer, because a capped one is published as "10,000+" under either
   * version (the new predicate is a superset), which is what keeps the fallback
   * bounded by the same ceiling the capped count exists to respect.
   *
   * PINNED BY STRUCTURE, NOT BY SPELLING: the stand-down must sit inside
   * cappedCount, after the row is read, and must be reachable — a gate written
   * before the RPC call would also skip the capped case it is required to keep. */
  it("the stated-pay count stands down from the RPC exactly where the two SQL versions could disagree", () => {
    const i = BOARD.indexOf("const cappedCount = async ()");
    expect(i, "cappedCount is gone — this guard would be vacuous").toBeGreaterThan(0);
    const fn = BOARD.slice(i, BOARD.indexOf("\n  };", i));
    const gate = /if \(applied\.hasStatedPay && row\.capped !== true\) return null;/.exec(fn);
    expect(
      gate,
      "cappedCount no longer stands down for a stated-pay count. Until verify-deploy 5y(b) shows migration 20260927034117 live, this RPC and buildQuery can bind different pay columns, and the headline then describes a population the page does not — remove this only with that section green",
    ).not.toBeNull();
    // AFTER the read, or the capped case it must preserve never happens.
    expect(fn.indexOf("const row = data[0]"), "the stand-down runs before the RPC's answer is read, so it also discards the capped answer it is supposed to keep")
      .toBeLessThan(fn.indexOf("applied.hasStatedPay && row.capped"));
    // The category rail must not print numbers taken over the other population
    // either. Since .91 it asks no RPC at all: a text query's chips are withheld
    // and the filter-only rail counts through buildQuery (L13-24).
    const rail = BOARD.slice(BOARD.indexOf("if (body.facetCounts === true) {"), BOARD.indexOf("facetSource: facetTokens ?"));
    expect(rail, "the category rail is missing").not.toBe("");
    expect(rail, "the category rail numbers a text search from the RPC again, so its chips can disagree with the page")
      .not.toMatch(/rpc\(/);
  });
});

describe("a superseded pay percentage survives only with its date", () => {
  /* GUARDS THE THREE-NUMBERS-FOR-ONE-FACT SHAPE on the page that renders the
   * controls. /explore is already forbidden to pin any of them; Jobs.tsx was not,
   * and it carried the retired 20.1% in three places — including the JSDoc of the
   * very field whose server value is now the pay field's share — while the
   * server's own table got a dated correction in the same change.
   *
   * TWO RULES, AND THE SECOND IS THE ONE THAT MATTERS. A percentage must not be
   * PINNED in code here (the page reads every share live and withholds it without
   * a stamp), and a retired figure may survive in prose ONLY beside the date it
   * was measured on — which is the project's own provenance rule, and the only
   * form in which 20.1% is not a false claim about today. Deleting the date is
   * what fails this. */
  it("Jobs.tsx pins no pay fraction and dates every retired one", () => {
    for (const stale of ["0.201", "0.129", "0.237", "0.283"]) {
      expect(JOBS, `${stale} is a dated snapshot of one pay column and must not be pinned in this page's code`)
        .not.toContain(stale);
    }
    // 150 CHARACTERS, NOT 400: the window has to be about the same SENTENCE, or a
    // dated paragraph four lines away satisfies it and deleting the date beside
    // the figure changes nothing — which is a guard that cannot go red.
    const dated = /20\d\d-\d\d-\d\d/;
    const hits = [...JOBS_RAW.matchAll(/20\.1%?/g)];
    expect(hits.length, "no 20.1% left in Jobs.tsx — if the history was deleted rather than dated, delete this case too").toBeGreaterThan(0);
    for (const m of hits) {
      const near = JOBS_RAW.slice(Math.max(0, m.index! - 150), m.index! + 150);
      expect(dated.test(near), `the retired 20.1% at offset ${m.index} carries no measurement date within 150 characters — a superseded figure with no date beside it is a claim about today, which is how "~4%" survived for months`)
        .toBe(true);
    }
  });
});

describe("the widening is disclosed on the page it happened on", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  /* GUARDS the blocker this sentence exists under. Every percentage beside it is
   * board-wide and is WITHHELD the moment the reader narrows the page outside the
   * family a clause belongs to — correct, and also why a narrowed stated-pay page
   * could say nothing at all about the gap it had just created. This figure is
   * counted from the rows the server served, so it is true of the page in front of
   * the reader however narrow it is.
   *
   * THE SECOND MOUNT IS WHAT MAKES THIS A TEST OF THE GATE AND NOT A COINCIDENCE.
   * A body carrying only pay keys still prints the board-wide clause (the reader
   * is looking at the whole board through that one filter, which is exactly the
   * context the sentence gives), so the first mount proves the two coexist. Add a
   * narrowing key from ANOTHER family — a country — and coverageStillBoardWide
   * withholds every percentage, and the per-page sentence must survive that: it is
   * the only pay figure a page in that state can honestly print. */
  it("the per-page gap prints on a narrowed page, where the board-wide figures cannot", async () => {
    mountWith(
      {
        payTextWithoutAnnual: { rows: 1, of: 2 },
        filterCoverage: { hasStatedPay: 0.283 },
        filterCoverageAt: new Date().toISOString(),
      },
      "/jobs?statedPay=1",
    );
    await waitFor(() => expect(text()).toContain("Painter and Decorator"), SLOW);
    await waitFor(() => expect(document.querySelector('[data-pay-gap="page"]')).not.toBeNull(), SLOW);
    const line = document.querySelector('[data-pay-gap="page"]')?.textContent ?? "";
    expect(line, "the sentence must carry the count it is about").toMatch(/\b1\b/);
    expect(line, "and the page size it is counted against").toMatch(/\b2\b/);
    // "AT LEAST" IS LOAD-BEARING. The count cannot see a figure we annualised but
    // could not convert to dollars (42 such rows board-wide, 2026-09-27T02:07:00Z),
    // so it is a floor on the uncomparable rows and must never be published as
    // the total.
    expect(line, "a count that cannot see part of its own population is published as a floor, never a total")
      .toMatch(/at least/i);
  });

  it("the per-page gap survives the narrowing that silences every percentage", async () => {
    mountWith(
      {
        payTextWithoutAnnual: { rows: 1, of: 2 },
        filterCoverage: { hasStatedPay: 0.283 },
        filterCoverageAt: new Date().toISOString(),
      },
      "/jobs?statedPay=1&country=GB",
    );
    await waitFor(() => expect(text()).toContain("Painter and Decorator"), SLOW);
    await waitFor(() => expect(document.querySelector('[data-pay-gap="page"]')).not.toBeNull(), SLOW);
    expect(
      document.querySelector('[data-coverage-scope="board"]'),
      "a country narrows outside the pay family, so no board-wide percentage may print — if one does, this case is no longer testing the gate",
    ).toBeNull();
    expect(document.querySelector('[data-pay-gap="page"]')?.textContent ?? "").toMatch(/at least/i);
  });

  it("no gap sentence when there is no gap", async () => {
    // A zero here is not news, and a line reading "0 of 60" on every ordinary
    // page teaches readers to skip the line that matters. The server omits the
    // field; the page must not invent a sentence from its absence.
    mountWith({ jobs: [ANNUALISED], total: 1 }, "/jobs");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(document.querySelector('[data-pay-gap="page"]')).toBeNull();
  });

  it("no gap sentence on an ordinary browse, even when the server sends the field", async () => {
    /* THE CASE THE THREE ABOVE COULD NOT FAIL. All of them either set a pay
     * param or served a page with no gap, so none of them exercised the state
     * this sentence actually shipped into: an ordinary browse, no pay control
     * touched, and a reply that carries the field anyway.
     *
     * THAT IS NOT A HYPOTHETICAL — IT IS THE DEPLOYED SERVER. A bundle older than
     * 2026-09-27 emits the field whenever any served row printed a rate it had
     * not annualised, which measured live at 10 of 20 default-shape pages spread
     * from offset 0 to 494,000 (24 rows of 1,176 served, 03:29:49Z-03:30:23Z). So
     * for the length of the deploy window the page would tell four readers in ten
     * that three controls they never used cannot compare part of what they are
     * looking at. The client gate is what stops that, which is why the client has
     * one at all rather than trusting the field's presence. */
    mountWith(
      { payTextWithoutAnnual: { rows: 19, of: 60 } },
      "/jobs",
    );
    await waitFor(() => expect(text()).toContain("Painter and Decorator"), SLOW);
    expect(
      document.querySelector('[data-pay-gap="page"]'),
      "the gap sentence printed on a page where no pay control is in use — it describes the pay floor, the pay ceiling and the pay order to a reader who touched none of them",
    ).toBeNull();
  });

  it("with a pay floor set, the page keeps quiet and the tooltip has already said it would", async () => {
    /* THE STATE THE PROMISE HAD TO BE QUALIFIED FOR. The floor, the ceiling and
     * the pay order bind a column generated from the annualised figure, so every
     * row they serve carries one, the gap count is structurally zero and the
     * server sends nothing. The tooltip promised "the page says how many" with no
     * condition, which was therefore false in exactly the state where the
     * exclusion bites. The fixture mirrors that: a floor in the URL and no field
     * in the reply. What must be true is both halves — nothing printed, and the
     * control's own sentence carrying the condition. */
    mountWith({ jobs: [ANNUALISED], total: 1 }, "/jobs?statedPay=1&salaryFloor=80000");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(document.querySelector('[data-pay-gap="page"]')).toBeNull();
    const tip = [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title") ?? "").join(" | ");
    expect(tip, "the states-pay tooltip promises a number the page cannot print once a pay floor is narrowing it")
      .toMatch(/but only while no pay floor/);
  });
});
