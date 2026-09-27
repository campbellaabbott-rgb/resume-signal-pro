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
 *       binds `salary_min_annual IS NOT NULL` while its tooltip promised
 *       "postings that publish a pay figure, whatever it is" — and the card
 *       renders "£14.80 per hour" in bold on the row it just excluded.
 *       Measured on a systematic 20-page walk of the live board (925 rows,
 *       offsets spread over the uncapped 746,871): 201 rows print a figure, 181
 *       carry an annual, so 20 of the 201 (10.0%) are invisible to the control
 *       while showing their rate; an independent 981-row walk the same day got
 *       39 of 338 (11.5%). Half carry a period and are reachable through "Paid
 *       hourly"; half state a bare range ("$37.62 to $54.90") and are reachable
 *       by neither. The exclusion itself is DELIBERATE and stays — salary-
 *       extract v7 refuses to invent a schedule for a part-time hourly rate
 *       after a $44/hr teacher was served at a $90k floor as 91,520 — so the
 *       fix is the sentence, not the predicate.
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
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { codeOf } from "./helpers/strip-comments";

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
    await waitFor(() => expect(text()).toContain("Staff Engineer"), { timeout: 5000 });
    await waitFor(() => expect(text()).toContain("approximate US dollars"), { timeout: 5000 });
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
    await waitFor(() => expect(text()).toContain("Staff Engineer"), { timeout: 5000 });
    await waitFor(() => expect(text()).toContain("only postings whose figure we can compare"), { timeout: 5000 });
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
   * evidence row — its rate is on screen and it is excluded — so the tooltip has
   * to name the class it cannot see, and point at the control that can reach
   * half of them. */
  it("the States-pay control does not promise a figure it cannot read", async () => {
    mountWith({}, "/jobs");
    await waitFor(() => expect(text()).toContain("Temporary Sales Assistant"), { timeout: 5000 });
    // The wage is on the page. That is the whole reason the old sentence was false.
    expect(text()).toContain("£14.80");
    const tips = titles();
    expect(tips, "the tooltip still promises any published figure, whatever it is").not.toContain("whatever it is");
    expect(tips, "the tooltip must say what it CAN read: a yearly figure").toContain("read as a yearly figure");
    expect(tips, "the tooltip must name the class it drops").toMatch(/hourly or per-shift/);
    expect(tips, "and must point at the control that reaches half of them").toContain("Paid hourly");
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
    expect(call, "the clause must name whose limit the fraction is").toContain("read as a yearly figure");
    expect(call, "the retired clause blamed employer silence for our own parse refusal").not.toContain("any pay at all");
    for (const f of ["en.json", "en-GB.json"]) {
      const v = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage.coverageStatedPay as string;
      expect(v, `${f} still reads "any pay at all"`).not.toMatch(/any pay at all/i);
      expect(v).toContain("yearly figure");
    }
    mountWith({ filterCoverage: { hasStatedPay: 0.235 } }, "/jobs?statedPay=1");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), { timeout: 5000 });
    expect(text(), "the retired clause must not reach a rendered page by any route").not.toContain("any pay at all");
  });

  /* GUARDS the floor's note, which quotes a dollar amount at the visitor: the
   * amount is compared against a converted figure, so it says so. */
  it("the floor's note says the dollar figure is a conversion, and dates it", async () => {
    mountWith({}, "/jobs?salaryFloor=60000");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), { timeout: 5000 });
    await waitFor(() => expect(text()).toContain("$60k+"), { timeout: 5000 });
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

  it("hasStatedPay still binds the annualised column, which is what the tooltip now describes", () => {
    expect(BOARD, "the hasStatedPay predicate moved — re-word jobsPage.statedPayTip and jobsPage.coverageStatedPay in all nine locales in the same change")
      .toContain('if (applied.hasStatedPay) q = q.not("salary_min_annual", "is", null);');
    expect(BOARD, "hasStatedPay must not bind salary_rank_usd: that would additionally require a convertible currency, which the control's name does not say")
      .not.toMatch(/applied\.hasStatedPay\) q = q\.not\("salary_rank_usd"/);
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
      expect(t.statedPayTip, `${f} jobsPage.statedPayTip does not name the hourly control that reaches the rows it drops`).toContain("{{hourly}}");
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
      for (const k of ["orderSalaryUsd", "orderSalaryStated", "statedPayTip", "salaryFloorTip", "coverageStatedPay"]) {
        expect(jp(f)[k], `${f} jobsPage.${k} is still the English string`).not.toBe(en[k]);
      }
    }
  });
});
