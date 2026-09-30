/**
 * THE PAY CONTROLS SAY WHAT THEY COMPARE.
 *
 * WHAT THIS GUARDS, AND WHY. Four controls on /jobs — the floor, the ceiling,
 * "States pay" and the pay sort — all compare a number the visitor never sees:
 * the posting's stated pay, annualised by our parser where it will, then
 * multiplied by an FX factor frozen since 2026-07-16 (`salary_rank_usd`). Every
 * sentence describing them was written as if the comparison were the posting's
 * own figure. Three concrete falsehoods came out of that, all three of them live
 * on 2026-09-26 and all three fixed here:
 *
 *   (a) THE BOARD PRINTED A WAGE AND CALLED THE POSTING SILENT. "States pay"
 *       bound `salary_min_annual IS NOT NULL` while its tooltip promised
 *       "postings that publish a pay figure, whatever it is" — and the card
 *       renders "£14.80 per hour" in bold on the row it just excluded.
 *       Measured on a systematic 20-page walk of the live board (925 rows,
 *       offsets spread over the uncapped 746,871): 201 rows print a figure, 181
 *       carry an annual, so 20 of the 201 (10.0%) are invisible to the control
 *       while showing their rate; an independent 981-row walk the same day got
 *       39 of 338 (11.5%).
 *
 *       ON 2026-09-26 THIS FILE CONCLUDED "the fix is the sentence, not the
 *       predicate", AND THAT WAS OVERRULED ON 2026-09-27. The reasoning it
 *       rested on — salary-extract refuses to invent a schedule for a part-time
 *       hourly rate, after a $44/hr teacher was served at a $90k floor as
 *       91,520 — is about COMPARING an amount, which is what the floor, the
 *       ceiling and the order do. The checkbox compares nothing; it asks whether
 *       the employer published a figure, and the answer to that does not depend
 *       on whether we were willing to multiply it by 2,080. So the predicate
 *       moved to the verbatim pay field in all four runtimes that answer it, the
 *       three comparing controls did NOT move, and the tooltip's apology is
 *       replaced by the disclosure the new divergence needs. Measured on
 *       complete country strata read row by row rather than sampled — IE 312
 *       rows with pay text against 282 with an annual, NZ 161 against 143 — and
 *       board-wide on one scan at 2026-09-27T02:07:00Z: 207,108 against 173,868
 *       of 733,190 servable rows, so 33,240 postings were being called silent
 *       while the board printed their wage.
 *   (b) THE COVERAGE LINE CHARGED EMPLOYERS FOR OUR OWN LIMIT. The same
 *       fraction was printed as "Employers state any pay at all on 23% of
 *       postings", which blames employer silence for the rows above.
 *   (c) ONE ORDER CAPTION DESCRIBED TWO DIFFERENT ORDERINGS AND WAS FALSE ON
 *       ONE. "ordered by stated salary floor — postings without stated pay sort
 *       last" is true of the browse sort (offset 200000 returns 10 of 10 rows
 *       with no annual) and false of a salary-sorted TEXT search, which takes
 *       the SALARY route and excludes `salary_rank_usd IS NULL` outright. That
 *       page printed the "sort last" clause a few hundred pixels above the
 *       server's own disclosure that those postings do not appear at all — two
 *       sentences on one screen, one of them a lie.
 *
 * WHY THESE ASSERTIONS AND NOT REQUEST BODIES. every-control-in-the-picture-
 * sends-what-it-names judges what each control SENDS, so a caption that
 * contradicts the response it describes passes it untouched. This file asserts
 * on the rendered sentence for a given response, which is the only place (c)
 * exists, plus a cross-runtime pin so the copy cannot outlive the predicate it
 * now describes.
 *
 * TEETH, PROVEN NOT ASSUMED (2026-09-26; each break applied, the file run, the
 * break reverted by inverse patch — the tree is shared with another lane, so the
 * restore is computed from the file as it stands, never from a snapshot). What
 * went red, by name:
 *   * caption collapsed back to one branch (orderSalaryUsd for both) ->
 *     "a salary-sorted search must not promise a tail it excludes" AND "the
 *     salary-sorted text search still excludes unpriced rows and still says so".
 *   * the old "whatever it is" statedPayTip restored in en.json ->
 *     "the States-pay control does not promise a figure it cannot read".
 *   * "any pay at all on {{pct}}%" restored in en.json ->
 *     "the coverage clause does not charge employers for what we could not
 *     annualise".
 *   * the server predicate widened to `salary_min_annual OR salary_period` ->
 *     "hasStatedPay still binds the annualised column, which is what the tooltip
 *     now describes", whose message tells the next author to move the copy.
 *   * `{{since}}` deleted from de.json's salaryFloorTip ->
 *     "no locale keeps a pay sentence that has lost its qualifier".
 *
 * THE 2026-09-27 REVISION, AND WHY TWO CASES WERE INVERTED RATHER THAN DELETED.
 * Two cases here REQUIRED the retired claim: one demanded the tooltip say it can
 * only read a yearly figure, and one demanded the server bind the annualised
 * column. That is the third of the four shapes of a guard that looks like it
 * works — a guard that must be edited for correct behaviour to ship teaches
 * people to edit guards — so each keeps its name and its job and now asserts the
 * claim the code actually makes. The cross-runtime case also grew a SECOND side:
 * it reads the live SQL as well as the edge builder, because this predicate now
 * has to agree across two runtimes, and a guard on one of them would pass while
 * the headline count and the page answered different questions. New teeth, each
 * break applied to the file as it stands and reverted by inverse patch:
 *   * the edge predicate reverted to the annualised column -> "hasStatedPay
 *     binds the employer's own pay field, which is what the tooltip now
 *     describes" AND "the edge predicate and the SQL predicate ask one question".
 *   * the predicate reverted in the MIGRATION only, edge left correct -> "the
 *     edge predicate and the SQL predicate ask one question" alone, which is the
 *     divergence these two files exist to prevent.
 *   * the filter-integrity sensor left reading the annualised column -> "the
 *     integrity sensor reads the column the predicate binds".
 *   * `{{order}}` deleted from de.json's statedPayTip -> "no locale keeps a pay
 *     sentence that has lost its qualifier".
 *
 * THE MIGRATION SCAN IS SHARED AND CACHED (src/test/helpers/live-sql.ts). It used
 * to be a local closure that re-read all 697 migration files once per function
 * per test; one run in five of the whole affected battery failed this file's
 * cross-runtime case and the identical tree passed on the next five, with no
 * cause ever captured. The helper reads the directory once per process and throws
 * a named error instead of returning an empty body, so a filesystem failure can
 * no longer arrive disguised as a deleted function.
 *
 * SEPARATELY, AND WORTH KNOWING BEFORE BELIEVING A RED RUN: this suite has
 * load-dependent failures that are not about pay at all. Running the ~99-file
 * affected battery at the default worker count on a busy machine timed out the
 * 5s waitFor mounts in a-sort-claim-must-name-the-set-it-ordered,
 * a-board-wide-count-under-a-narrowed-page, newest-first-must-order-by-date and
 * others — 27 tests on one run, 12 on the next, 0 on a third, from an unchanged
 * tree — and every one of them passes in isolation and at --maxWorkers=2. A red
 * jsdom mount under parallel load is a scheduling result; re-run the file alone
 * before reading it as a defect.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { codeOf } from "./helpers/strip-comments";
import { liveDefinitionOf } from "./helpers/live-sql";

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
import { SALARY_FX_PINNED_SINCE, vintageLabel } from "../pages/Jobs";

const root = resolve(__dirname, "../..");
const LOCALES = resolve(__dirname, "../i18n/locales");
/**
 * THE VINTAGE IS IMPORTED, NEVER RETYPED, AND THE READER'S FORM IS DERIVED.
 *
 * This file used to hold `const PINNED_SINCE = "2026-07-16"` — a fourth hand copy
 * of a date whose entire purpose is to MOVE when a migration re-issues the FX
 * factors. the-pinned-fx-table-cannot-drift-in-silence already pins
 * SALARY_FX_PINNED_SINCE to the newest migration that writes those rates, so a
 * refresh makes that guard fail and this one pass, which is the worst possible
 * split: the number moves in one runtime and a second guard keeps asserting the
 * old one is on screen. Importing the export makes the two move together.
 *
 * TWO FORMS, ONE SOURCE. The constant is ISO because the cross-runtime guard
 * parses it out of SQL; the page prints it through `vintageLabel` because an
 * en-US-shaped machine date inside Hindi or German prose is not localised copy.
 * So this file asserts on the LABEL, derived from the constant by the page's own
 * formatter — if either the constant or the formatting changes, the expectation
 * follows, and if the copy stops dating the rates at all the assertion still
 * fails. Asserting the raw ISO string here is what broke when the formatting
 * landed: the page was right and the test was pinning the unlocalised form.
 */
const PINNED_SINCE_LABEL = vintageLabel(SALARY_FX_PINNED_SINCE, "en");

/** An hourly-stated row of exactly the class "States pay" cannot see. */
const HOURLY_ROW = {
  id: "workday:fastretailing~wd3~store_staff_eu_Uniqlo:R00000004177581",
  source: "workday", token: "fastretailing~wd3~store_staff_eu_Uniqlo", company: "UNIQLO",
  title: "Temporary Sales Assistant - UNIQLO Kensington", location: "London", country: "GB",
  salary: "£14.80 per hour", salaryMinAnnual: null, salaryMaxAnnual: null,
  salaryPeriod: "hour", salaryCurrency: "GBP",
  workMode: null, employmentType: "part_time", experienceBand: null, minYears: null,
  category: "retail", department: null, agency: false,
  postedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), recheckedAt: null,
  applyUrl: "https://example.invalid/1", remote: false,
};
/** A priced row, so a pay-sorted page has something ranked on it. */
const PRICED_ROW = {
  ...HOURLY_ROW,
  id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
  title: "Staff Engineer", location: "Cambridge", salary: "$120,000 – $150,000",
  salaryMinAnnual: 120000, salaryMaxAnnual: 150000, salaryPeriod: "year", salaryCurrency: "USD",
  employmentType: "full_time", category: "engineering",
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
          jobs: [PRICED_ROW, HOURLY_ROW], totalAllCompanies: 2, companies: [], companiesCount: 0,
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
const text = () => document.body.textContent ?? "";
const titles = () => [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title") ?? "").join("\n");

// THE WAITING BUDGET, and why it is not a number chosen here: helpers/mount-
// budget.ts. This file had no shared constant -- inline five-second wait
// literals, level with vitest's default per-test budget of the same five
// seconds and so unreachable, in cases that chain two of them. A stuck wait
// was reported as a bare test timeout naming nothing. The slowest case
// measured 2048 ms on the 2026-09-30 loaded run.
vi.setConfig(MOUNT_TEST_BUDGET);

describe("the pay-sorted page describes the ordering it actually has", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  /* GUARDS (c), the browse half: the caption may keep its tail — offset 200000
   * of the live browse sort really does return unpriced rows — but it must name
   * the key it sorts on, which is a converted approximation and not "stated
   * salary floor". */
  it("a browse pay sort names approximate US dollars and keeps the tail it really has", async () => {
    mountWith({}, "/jobs?sort=salary");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(text()).toContain("approximate US dollars"), SLOW);
    expect(text()).toContain("sort last");
    expect(text(), "the caption dates the frozen rates it compares with, in the reader's own date form").toContain(PINNED_SINCE_LABEL);
    expect(text(), "the retired claim: the ordering is not on the posting's own stated floor").not.toContain("ordered by stated salary floor");
  });

  /* GUARDS (c), the search half: when the server says it excluded the unpriced
   * rows, the caption must not promise them at the end of the list. */
  it("a salary-sorted search must not promise a tail it excludes", async () => {
    mountWith(
      { salaryStatedOnly: true, total: null, countUnavailable: true, searchRoute: "SALARY", jobs: [PRICED_ROW] },
      "/jobs?q=nurse&sort=salary",
    );
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(text()).toContain("only postings whose figure we can compare"), SLOW);
    expect(text(), "the server excluded every unpriced row; the caption cannot say they sort last").not.toContain("sort last");
    // The server's own disclosure is still on the page, and now agrees with it.
    expect(text()).toContain("only roles that state a salary appear here");
    expect(text()).toContain("approximate US dollars");
  });
});

describe("a control that shows a wage does not call the posting silent", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  /* GUARDS (a): the promise on the checkbox. The row in the fixture is the live
   * evidence row — its rate is on screen, and until 2026-09-27 the control
   * excluded it. The predicate moved, so the tooltip no longer apologises for a
   * class it cannot see; what it must now carry is the NEW divergence, because
   * the checkbox became a superset of the three controls that compare amounts. */
  it("the States-pay control does not promise a figure it cannot read", async () => {
    mountWith({}, "/jobs");
    await waitFor(() => expect(text()).toContain("Temporary Sales Assistant"), SLOW);
    // The wage is on the page. That is the whole reason the old sentence was false.
    expect(text()).toContain("£14.80");
    const tips = titles();
    expect(tips, "the tooltip still promises any published figure, whatever it is").not.toContain("whatever it is");
    // THE INVERSION. This required "read as a yearly figure" — the apology the
    // old predicate owed — and that sentence is now FALSE: the control admits the
    // fixture row, whose rate we never annualised. It must say what it does bind.
    expect(tips, "the retired apology: the control no longer stops at a yearly figure")
      .not.toContain("read as a yearly figure");
    expect(tips, "the tooltip must name the field it binds — the employer's own pay field")
      .toMatch(/pay field carries a figure/);
    expect(tips, "and must name the hourly rates it now admits").toMatch(/hourly or per-shift/);
    expect(tips, "and must name the divergence it created: the amount-comparing controls did not move")
      .toMatch(/pay floor, the pay ceiling/);
  });

  /* GUARDS (b): the clause under the result count. The fraction is OUR
   * annualisation coverage, printed inside a sentence that begins "… employers
   * state", so the clause must name whose limit it is.
   *
   * PINNED AT THE RENDERER, NOT ONLY AT THE PARAGRAPH, and deliberately.
   * WHETHER the coverage paragraph prints on a given page is the filter-coverage
   * lane's business — coverageStillBoardWide() withholds every clause whose
   * family the page has narrowed, and the browse body now carries a narrowing
   * key outside the pay family — so a purely rendered assertion here would be a
   * guard on another lane's gate and would go red every time that gate moved.
   * The WORDING is this lane's, and it is pinned where it is written: the
   * comment-stripped renderer call, both English locales, and the page never
   * printing the retired clause. */
  it("the coverage clause does not charge employers for what we could not annualise", async () => {
    const page = codeOf(readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8"));
    const at = page.indexOf('fc.hasStatedPay === "number"');
    expect(at, "the hasStatedPay coverage clause is no longer rendered at all").toBeGreaterThan(0);
    const call = page.slice(at, at + 320);
    expect(call).toContain("jobsPage.coverageStatedPay");
    // THE CLAUSE FOLLOWS THE PREDICATE. It used to have to name whose limit the
    // fraction was ("a yearly figure"), because the fraction was OUR parse rate
    // under a line framed "Employers state …". The filter and the fraction both
    // moved to the employer's pay field on 2026-09-27, so the clause is now a
    // statement about what employers published and the apology is retired.
    expect(call, "the retired apology: this fraction is no longer our annualisation rate")
      .not.toContain("read as a yearly figure");
    expect(call, "the clause must describe the pay figure the employer published").toContain("pay figure");
    expect(call, "the retired clause blamed employer silence for our own parse refusal").not.toContain("any pay at all");
    for (const f of ["en.json", "en-GB.json"]) {
      const v = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage.coverageStatedPay as string;
      expect(v, `${f} still reads "any pay at all"`).not.toMatch(/any pay at all/i);
      expect(v, `${f} coverageStatedPay no longer names a pay figure`).toMatch(/pay figure/i);
      expect(v, `${f} still promises a yearly figure the filter no longer requires`).not.toMatch(/yearly figure/i);
    }
    mountWith({ filterCoverage: { hasStatedPay: 0.235 } }, "/jobs?statedPay=1");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(text(), "the retired clause must not reach a rendered page by any route").not.toContain("any pay at all");
  });

  /* GUARDS the floor's note, which quotes a dollar amount at the visitor: the
   * amount is compared against a converted figure, so it says so. */
  it("the floor's note says the dollar figure is a conversion, and dates it", async () => {
    mountWith({}, "/jobs?salaryFloor=60000");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(text()).toContain("$60k+"), SLOW);
    expect(text()).toContain("approximate US dollars");
    expect(text()).toContain(PINNED_SINCE_LABEL);
  });
});

describe("the copy cannot outlive the predicate it describes", () => {
  /* GUARDS the cross-runtime half (project_claim_drift): the sentences above are
   * true of ONE server predicate. The fix that would make the control see those
   * rows — a stored pay_stated boolean written by all four salary writers, plus
   * the matching row audit in filters.ts — changes that predicate, and on the day
   * it lands this copy becomes wrong in the other direction. Pinned from the
   * comment-stripped source so the docblocks quoting these very column names
   * cannot satisfy it. */
  const BOARD = codeOf(readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8"));

  it("hasStatedPay binds the employer's own pay field, which is what the tooltip now describes", () => {
    // INVERTED, NOT DELETED (2026-09-27). This case required the annualised
    // column — the predicate that made the board print a wage and call the
    // posting silent — so satisfying it was the same thing as shipping the
    // defect. It keeps its job: the copy above is true of ONE predicate, and this
    // is the pin that makes the copy and the predicate move together.
    expect(BOARD, "the hasStatedPay predicate moved — re-word jobsPage.statedPayTip and jobsPage.coverageStatedPay in all nine locales in the same change")
      .toContain('if (applied.hasStatedPay) q = q.not("salary", "is", null);');
    expect(BOARD, "the retired predicate: binding the annualised figure is what excluded 33,240 postings whose wage the card prints")
      .not.toMatch(/applied\.hasStatedPay\) q = q\.not\("salary_min_annual"/);
    expect(BOARD, "hasStatedPay must not bind salary_rank_usd: that would additionally require a convertible currency, which the control's name does not say")
      .not.toMatch(/applied\.hasStatedPay\) q = q\.not\("salary_rank_usd"/);
  });

  /* THE GUARD THAT EXISTS BECAUSE THIS PREDICATE LIVES IN TWO RUNTIMES.
   *
   * buildQuery answers a stated-pay request on the browse paths; p_pay_stated
   * answers the same request inside the ranked search, the capped COUNT and the
   * typo-rescue tier. Move one and not the others and the page headlines a number
   * counted over a different population — the 2026-07-25 p_work_mode defect,
   * which returned 30 rows that all had work_mode NULL under a request for
   * remote-only. That is why the fix was two files, and this is the case that
   * fails if they ever drift apart again.
   *
   * IT COMPARES DERIVED COLUMN NAMES, NOT FOUR HARDCODED LITERALS. A guard that
   * pins each side's spelling independently passes when both sides are pinned and
   * one of them is wrong; this one extracts the column each runtime actually
   * tests and asserts the SET has one member, so any divergence fails whichever
   * side moved. Read from the LATEST migration that defines each function — the
   * rule 20260901200000 exists to record — and comment-stripped, because a
   * migration explaining its own predicate would otherwise satisfy it. */
  it("the edge predicate and the SQL predicate ask one question", () => {
    const columns = new Map<string, string>();
    const edge = /applied\.hasStatedPay\) q = q\.not\("(\w+)", "is", null\)/.exec(BOARD);
    expect(edge, "no hasStatedPay predicate found in buildQuery — this guard would be vacuous").not.toBeNull();
    columns.set("buildQuery", edge![1]);
    // The two dynamic-SQL functions append a fixed predicate under a boolean
    // gate; the rescue tier is static SQL and writes the same test inline.
    for (const fn of ["search_jobs", "count_jobs_capped", "fuzzy_title_search"]) {
      const { file, body } = liveDefinitionOf(fn);
      expect(body, `${fn} has no live definition in supabase/migrations`).not.toBe("");
      // TOLERANT OF A STRICTER ARM, BECAUSE A GUARD THAT FAILS ON A CORRECT
      // CHANGE TEACHES PEOPLE TO EDIT GUARDS. What this case is for is the
      // COLUMN each runtime names; a later change that keeps the column and adds
      // a blank-string arm to the SQL (the asymmetry filterViolations documents)
      // is correct and must not turn this red. So the match ends at the column
      // and anything may follow it.
      const m = /p_pay_stated IS TRUE THEN filters := filters \|\| ' AND p\.(\w+) IS NOT NULL/.exec(body)
        ?? /p_pay_stated IS NOT TRUE OR p\.(\w+) IS NOT NULL/.exec(body);
      expect(m, `${fn} (live in ${file}) binds p_pay_stated to no column — a filter an RPC cannot see is a filter it IGNORES`).not.toBeNull();
      columns.set(`${fn} (${file})`, m![1]);
    }
    const distinct = [...new Set(columns.values())];
    expect(
      distinct.length,
      `the four runtimes that answer "states pay" disagree about which column states it, so a page and its own headline count describe different populations — ${
        [...columns].map(([k, v]) => `${k}: ${v}`).join("; ")
      }`,
    ).toBe(1);
    expect(distinct[0], "all four now bind the employer's verbatim pay field").toBe("salary");
  });

  /* THE SENSOR IS PART OF THE PREDICATE'S BLAST RADIUS. filterViolations is what
   * turns "an RPC ignored this filter" into a reported incident; pointed at the
   * old column it would have flagged every one of the 33,240 newly-admitted rows
   * as a violation, unsampled, and an integrity channel that floods is one
   * somebody switches off. */
  it("the integrity sensor reads the column the predicate binds", () => {
    const FILTERS = codeOf(readFileSync(resolve(root, "supabase/functions/job-board/filters.ts"), "utf8"));
    const m = /a\.hasStatedPay && \(typeof r\.(\w+) !== "string"/.exec(FILTERS);
    expect(m, "no hasStatedPay row audit found in filterViolations").not.toBeNull();
    const edge = /applied\.hasStatedPay\) q = q\.not\("(\w+)", "is", null\)/.exec(BOARD);
    expect(m![1], "the row audit and the query test must name the same column").toBe(edge![1]);
    expect(FILTERS, "the retired audit reported a legitimately-admitted row as a violation")
      .not.toMatch(/a\.hasStatedPay && r\.salaryMinAnnual == null/);
  });

  it("the floor and the ceiling still compare the converted column the copy names", () => {
    expect(BOARD).toContain('q.gte("salary_rank_usd", applied.salaryFloor)');
    expect(BOARD).toContain('q.lte("salary_rank_usd", applied.salaryCeiling)');
  });

  it("the salary-sorted text search still excludes unpriced rows and still says so", () => {
    // Both halves of caption (c): the exclusion, and the flag the page splits on.
    expect(BOARD).toContain('.not("salary_rank_usd", "is", null)');
    expect(BOARD, "salaryStatedOnly is the flag the caption branches on; without it the page cannot tell the two orderings apart")
      .toContain("salaryStatedOnly: true");
    const page = codeOf(readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8"));
    expect(page, "the order caption no longer branches on the server's flag").toMatch(
      /data\?\.salaryStatedOnly[\s\S]{0,200}jobsPage\.orderSalaryStated/,
    );
  });
});

describe("every language says it, or no language does", () => {
  const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
  const jp = (f: string) => JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as Record<string, string>;

  it("there are nine locales", () => {
    expect(files.length).toBe(9);
  });

  /* GUARDS the half-landed locale pass, which is the reason this repository mints
   * a new key rather than editing one in place: a locale VALUE beats an inline
   * English default, so an English-only fix leaves eight languages making the
   * claim the page stopped making. These five strings were edited in place
   * BECAUSE all nine landed in the same change, and this case is what makes that
   * safe — the marker each string must carry is language-neutral. */
  it("no locale keeps a pay sentence that has lost its qualifier", () => {
    for (const f of files) {
      const t = jp(f);
      for (const k of ["salaryFloorTip", "salaryCeilingTip", "salaryFloorNote", "orderSalaryUsd", "orderSalaryStated"]) {
        expect(t[k], `${f} jobsPage.${k} does not carry {{since}} — this language does not date the frozen rates`).toContain("{{since}}");
      }
      // THE MARKER MOVED WITH THE SENTENCE. statedPayTip used to interpolate the
      // HOURLY control's name, because that control was the workaround for the
      // rows this checkbox dropped; the checkbox reaches them itself now, so the
      // apology and its placeholder are both retired. What the sentence must
      // still carry is the control it is NOT a superset of, by the same
      // language-neutral mechanism: a placeholder cannot be dropped in
      // translation without dropping a placeholder.
      expect(t.statedPayTip, `${f} jobsPage.statedPayTip does not name the pay order it cannot promise — this language does not disclose the gap`).toContain("{{order}}");
      // TWICE, AND THE SECOND ONE IS THE QUALIFIER. The tip promises the page
      // will say how many postings the three comparing controls cannot rank, and
      // the page CANNOT keep that promise once one of them is narrowing: the gap
      // is counted over SERVED rows, and a floor, a ceiling or the pay order
      // leaves every served row carrying a yearly figure, so the count is
      // structurally zero and nothing prints. The qualifier carries the pay
      // order's own name, so a translation that drops the condition drops a
      // placeholder — the same language-neutral mechanism as the line above,
      // because prose cannot be checked in nine languages and a placeholder can.
      expect(
        t.statedPayTip.split("{{order}}").length - 1,
        `${f} jobsPage.statedPayTip names the pay order once, so this language promises "the page says how many" without the condition under which the page can say it`,
      ).toBeGreaterThanOrEqual(2);
      expect(t.statedPayTip, `${f} jobsPage.statedPayTip still points at the hourly control as a workaround for rows this filter now admits`).not.toContain("{{hourly}}");
      expect(t.payNotComparable, `${f} jobsPage.payNotComparable lost the row count`).toContain("{{rows}}");
      expect(t.payNotComparable, `${f} jobsPage.payNotComparable lost the page size it counts against`).toContain("{{of}}");
      expect(t.salaryFloorNote, `${f} jobsPage.salaryFloorNote lost the amount`).toContain("{{amount}}");
      expect(t.coverageStatedPay, `${f} jobsPage.coverageStatedPay lost the percentage`).toContain("{{pct}}");
      expect(Object.keys(t), `${f} still carries the retired jobsPage.orderSalary`).not.toContain("orderSalary");
      expect(typeof t.orderSalaryUsd).toBe("string");
      expect(typeof t.orderSalaryStated).toBe("string");
    }
  });

  it("the two new captions are translated, not copied through", () => {
    const en = jp("en.json");
    for (const f of files) {
      if (f === "en.json" || f === "en-GB.json") continue;
      for (const k of ["orderSalaryUsd", "orderSalaryStated", "statedPayTip", "salaryFloorTip", "coverageStatedPay", "payNotComparable"]) {
        expect(jp(f)[k], `${f} jobsPage.${k} is still the English string`).not.toBe(en[k]);
      }
    }
  });
});
