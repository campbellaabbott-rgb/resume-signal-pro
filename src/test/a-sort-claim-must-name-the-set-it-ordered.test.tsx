// A SORT CLAIM MUST NAME THE SET IT ORDERED.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────
// "Newest first" on a text search did not order the board by date. sort=newest
// sets `scoreRanked` false, so `deepPageable` is false and planRankedPage reads
// search_jobs at p_offset 0 with p_limit 200; the RPC orders by ts_rank_cd and
// clamps at 200 rows, and index.ts then date-sorts THOSE 200 in memory. So the
// page could only ever hold the 200 most RELEVANT rows — and the newest
// postings are the least likely to rank, which is exactly why they were the
// rows missing.
//
// MEASURED live against production with the anon key on 2026-09-26, before the
// fix (each body POSTed to /functions/v1/job-board):
//   {"action":"list","limit":60,"includeFacets":false,"q":"nurse",
//    "sort":"newest"}                -> 3 cards, hasMore false, nextOffset 200,
//                                      total 10000, countCapped true
//   the same body + groupSimilar:false -> 60 rows, 2 distinct employers
//   explain on the same body         -> scoreRanked false, deepPageable false,
//                                      plan {pLimit: 200, pOffset: 0}
//   {"action":"list","limit":1,"q":"nurse","sort":"newest",
//    "postedAfter":"2026-09-26T00:00:00+00:00"}  -> total 39, countCapped false
//   the same probe for q="engineer"              -> total 224
// 39 nurse postings and 224 engineer postings whose stated date is NEWER than
// the top card of a page labelled "Newest first", unreachable at every offset.
// Three cards under a headline of 10,000+, with the sort select reading "Newest
// first", the line under the search box reading "Sorted by newest first" and the
// hint beside the select reading "ordered by relevance to your search" — three
// statements on one screen and no two of them agreeing.
//
// ── THE PROPERTY THIS FILE GUARDS ───────────────────────────────────────────
// A page may print a sort claim only about the set the SERVER could apply that
// sort to. The server now says which set that was, as data:
//   sortScope "matchSet"        the database ordered every row the matcher
//                               selected (sortMatcher names it), so the order is
//                               true of the whole set and a plain offset pages
//                               it;
//   sortScope "relevanceWindow" the order was applied to the closest
//                               sortScopeRows rows and to nothing else.
// The client prints its claim FROM that field and never from the sort it asked
// for. Absent is treated as "window": an old deployed bundle (this project's
// documented >4.5MB deploy that serves the previous version while reporting
// success) then degrades to the weaker TRUE sentence instead of the false one.
//
// ── WHY BOTH HALVES ARE ASSERTED, AND WHY BEHAVIOURALLY ─────────────────────
// A server field nobody renders is the defect
// a-disclosure-nobody-renders-is-not-a-disclosure.test.ts exists for, and a
// client sentence with no server field behind it is the claim-drift defect. So
// this file asserts the whole chain — emitted, read, translated — and the
// sentences are asserted by MOUNTING the page, because a regex over JSX cannot
// tell a branch that renders from a branch that is dead.
//
// Source-level assertions read COMMENT-STRIPPED code through helpers/strip-
// comments: every docblock in this area necessarily quotes the identifiers and
// literals below, and a guard satisfied by an explanation is not a guard.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { pickRoute, RETRIEVER_FOR } from "../../supabase/functions/job-board/search-routing";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";

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

const ROOT = resolve(__dirname, "../..");
const FN_RAW = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const FN = codeOf(FN_RAW);
const JOBS_RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOBS = codeOf(JOBS_RAW);
const LOCALES = ["en", "en-GB", "es", "fr", "de", "pt", "nl", "hi", "tl"];
const SLOW = { timeout: 5000 } as const;

/** One row per card, in the shape rowToJob emits. */
const row = (i: number, company: string, title: string, posted: string) => ({
  id: `greenhouse:${company}:${i}`, source: "greenhouse", token: company, company,
  title, location: "Remote", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "remote", employmentType: null, experienceBand: null, minYears: null,
  category: "healthcare", department: null, remote: true,
  postedAt: posted, lastSeen: posted, recheckedAt: null, applyUrl: `https://x/${i}`,
});

/**
 * THE WINDOW SHAPE, exactly as production answered before the fix: three cards,
 * paging over, under a capped count of ten thousand.
 */
const WINDOW_BODY = {
  jobs: [
    row(1, "HealthCareersInSask", "Nurse A - Registered Nurse General Duty Nurse", "2026-09-26T00:00:00+00:00"),
    row(2, "HealthCareersInSask", "Nurse A - Registered Psych Nurse", "2026-09-25T00:00:00+00:00"),
    row(3, "CoxHealth", "Registered Nurse", "2026-09-24T00:00:00+00:00"),
  ],
  total: 10000, countCapped: true, hasMore: false, nextOffset: 200,
  ranked: true, sortScope: "relevanceWindow", sortScopeRows: 200,
  totalAllCompanies: 748074, companies: [], companiesCount: 0, categories: {},
  failedSources: [], failedCount: 0, refreshedAt: null,
};

/** The fixed shape: ordered in SQL over the whole title-match set, no total. */
const MATCH_SET_BODY = {
  jobs: Array.from({ length: 60 }, (_, i) =>
    row(100 + i, `employer${i}`, `Registered Nurse ${i}`, `2026-09-${String(26 - (i % 20)).padStart(2, "0")}T12:00:00+00:00`)),
  total: null, countUnavailable: true, hasMore: true, nextOffset: 60,
  sortScope: "matchSet", sortMatcher: "title", searchRoute: "NEWEST",
  totalAllCompanies: 748074, companies: [], companiesCount: 0, categories: {},
  failedSources: [], failedCount: 0, refreshedAt: null,
};

function mount(path: string, listBody: Record<string, unknown>) {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async () => ({ data: [] }));
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      // The widener probe. If it is ever reached on a sortWindow page this
      // returns a number the card must still not print — see the assertion.
      if (b.countOnly) return { data: { total: 748074 } };
      return { data: listBody };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";

describe("a sort claim must name the set it ordered", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  // ── THE SERVER HALF ───────────────────────────────────────────────────────

  it("a date-ordered search is ordered by the DATABASE, over the whole match set", () => {
    // The gate, and it must not be the ranked path's 200-row window.
    expect(FN, "newestTextSort is gone — a date sort is back to permuting a relevance window")
      .toMatch(/const newestTextSort = !countOnly && !!qText && newestFirst/);
    const i = FN.indexOf("if (newestTextSort) try {");
    expect(i, "the newestTextSort branch is declared and never entered").toBeGreaterThan(-1);
    const branch = FN.slice(i, i + 4000);
    // posted_at, NULLS LAST — never effective_posted, which is
    // coalesce(posted_at, first_seen) and would let OUR crawl stamp lead a page
    // labelled with the employer's date (57 of 60 rows, measured).
    expect(branch, "the order must be the employer's stated date, undated last")
      .toMatch(/\.order\("posted_at", \{ ascending: false, nullsFirst: false \}\)/);
    expect(branch, "ties must break on a stable key or page two repeats page one")
      .toMatch(/\.order\("id", \{ ascending: true \}\)/);
    // A plain offset into ONE ordering: anchoring at 0 is the bug being fixed.
    expect(branch, "the page must be an offset into the ordering, not a window read from 0")
      .toMatch(/\.range\(offset, offset \+ fetchLimit - 1\)/);
    expect(branch).not.toMatch(/\.range\(0,/);
    // And it must say which set it ordered.
    expect(branch).toMatch(/sortScope: "matchSet"/);
    expect(branch).toMatch(/sortMatcher: "title"/);
  });

  it("the employer route orders by the employer's own date and says which set it ordered", () => {
    /* THE EXIT THAT SAID NOTHING, AND THE ONE THE PAGE THEN GUESSED FOR.
     *
     * newestTextSort deliberately stands down for the company retriever (a title
     * matcher returns nothing for a company name), so an EMPLOYER-route query with
     * sort=newest fell to the routed exit — which ordered by `effective_posted`
     * with no date re-sort and published no sortScope at all. MEASURED live
     * 2026-09-26: q="Spectrum Health" + sort=newest served
     * workday:spectrumhealth~wd5~CorewellHealthCareers:R228442 with postedAt NULL
     * at position 1, above seven rows stamped 2026-09-25, under a sentence
     * claiming a date order and quoting a 200-row bound on a route whose window is
     * ROUTE_WINDOW = 400.
     *
     * Two properties, and the client-side cases below cannot see either: the ORDER
     * must follow the request, and the exit must NAME the set it ordered. Without
     * this case, deleting both leaves every rendered assertion green, because a
     * silent reply is exactly the shape those cases feed in on purpose.
     */
    // 1. The order follows the request for the company half.
    expect(
      FN,
      "the employer route no longer date-orders under sort=newest — it is back on effective_posted, our crawl stamp",
    ).toMatch(/const routedRead = newestFirst && routedRetriever === "company"\s*\?\s*rq\.order\("posted_at", \{ ascending: false, nullsFirst: false \}\)\s*:\s*rq\.order\("effective_posted", \{ ascending: false \}\);/);
    // 2. …and it says so on the wire, for that half only.
    expect(
      FN,
      "the routed exit stopped publishing sortScope, so the page has nothing to print its order claim from",
    ).toMatch(/\.\.\.\(newestFirst && routedRetriever === "company"\s*\?\s*\{ sortScope: "matchSet", sortMatcher: "company" \}/);
    // 3. And the OTHER retrievers stand down for a date sort rather than serving
    //    one silently: there the rows go through rerankWindow, and the ranked path
    //    below already answers that body with its real seam.
    expect(FN).toContain('const routedServesThisOrder = routedRetriever === "company" || !newestFirst;');
    expect(
      FN,
      "the routed block runs for a date sort on a retriever that does not date-order it",
    ).toMatch(/if \(!countOnly && routedServesThisOrder && \(routedRetriever === "company" \|\| routedRetriever === "simple"\)\) try \{/);
  });

  it("the branch stands down where a title matcher would serve the wrong rows, filtered or not", () => {
    /* EMPLOYER: those tokens are company names — q="Domino's" has no title
     * match. SYMBOL: q="c++" and q="c#" produce the identical tsquery ('c') and
     * only the scorer's literal-substring rule separates them, which cannot run
     * in SQL. deepPageable excludes both for the same measured reasons.
     *
     * WHY THIS IS A WALK AND NOT TWO `toContain` CALLS. It used to assert that
     * the gate's SOURCE contained the strings `routedRetriever !== "company"`
     * and `routeDecision.route !== "SYMBOL"` — and it was green while both were
     * DEAD CODE on every filtered body. `routeDecision` is hardcoded to
     * `{route:"BROWSE"}` whenever any filter is applied and RETRIEVER_FOR.BROWSE
     * is "browse", so with one country set neither comparison could ever be
     * false: the c++/c# collision (MEASURED live 2026-09-26 — both queries
     * returned total 1,430 with byte-identical title lists containing neither
     * symbol) would have been served date-ordered and published as the whole
     * title-match set. A guard that pins a spelling cannot see that; the property
     * is "the symbol and employer classes never reach this branch", so the test
     * runs the classifier the gate runs and holds the gate's own predicate to it,
     * BARE AND WITH FILTERS SET.
     */
    const gate = /const newestTextSort = [^;]*;/.exec(FN)?.[0] ?? "";
    expect(gate, "the newestTextSort gate was not found").not.toBe("");
    // The gate must read the query's OWN class, not the router's decision — the
    // router stands itself down under a filter, and a stand-down is not a class.
    expect(
      /routeDecision/.test(gate),
      "the gate reads routeDecision, which is BROWSE on every filtered body — both " +
        "exclusions are then dead code exactly where they are needed",
    ).toBe(false);

    // The predicate, re-expressed over the classifier: this is what the gate
    // computes, and `qClass` is pickRoute(qText) with no filter input at all.
    const reaches = (q: string) => {
      const c = pickRoute(q, EMPLOYER_ALIASES);
      return RETRIEVER_FOR[c.route] !== "company" && c.route !== "SYMBOL";
    };
    // SYMBOL, the measured collision. Bare and filtered are the SAME call now,
    // which is the point: the class cannot depend on the filter bar.
    for (const q of ["c++", "c#", "c++ developer"]) {
      expect(reaches(q), `q=${JSON.stringify(q)} must not reach the date branch`).toBe(false);
      expect(pickRoute(q, EMPLOYER_ALIASES).route, `q=${JSON.stringify(q)} is the SYMBOL class`).toBe("SYMBOL");
    }
    // EMPLOYER, drawn from the alias table itself rather than typed here, so a
    // renamed employer cannot quietly empty this case.
    const employerNames = Object.values(EMPLOYER_ALIASES).map((a) => a.name).slice(0, 12);
    expect(employerNames.length, "EMPLOYER_ALIASES is empty — this case would assert nothing").toBe(12);
    for (const name of employerNames) {
      expect(RETRIEVER_FOR[pickRoute(name, EMPLOYER_ALIASES).route], `${name} is an employer query`).toBe("company");
      expect(reaches(name), `q=${JSON.stringify(name)} must not reach the date branch`).toBe(false);
    }
    // And the classes that MUST reach it, or the branch is dead for its own purpose.
    for (const q of ["nurse", "registered nurse", "warehouse associate"]) {
      expect(reaches(q), `q=${JSON.stringify(q)} is an ordinary title search and must reach the date branch`).toBe(true);
    }
    // A zero-row read must FALL THROUGH, or a title-only miss costs the reader
    // the description tier and the fuzzy/semantic/location-split rescues.
    const i = FN.indexOf("if (newestTextSort) try {");
    expect(FN.slice(i, i + 4000)).toMatch(/Array\.isArray\(newRows\) && newRows\.length > 0/);
  });

  it("an expansion the branch matched on is disclosed, and the page renders it", () => {
    // The old page hid the alias line under `!searchNewestFirst`, which was
    // right while a date-sorted search ran no expansion. This branch binds the
    // SIMPLE route's expansion — that is what keeps q="rn" reaching "Registered
    // Nurse" on a date order — so the line must be emitted AND rendered, or the
    // reader sees rows their typed word does not appear in with nothing saying
    // why. Emitted per response, so it still cannot claim an expansion that did
    // not happen.
    const i = FN.indexOf("if (newestTextSort) try {");
    const branch = FN.slice(i, i + 4500);
    expect(branch, "the branch dropped alias expansion — q=rn stops reaching Registered Nurse")
      .toMatch(/newestExpand\.expansions\.length \? ftsSafe\(newestExpand\.q\) : ftsQuery\(qText\)/);
    expect(branch).toMatch(/\.\.\.\(newestExpand\.expansions\.length \? \{ aliases: newestExpand\.expansions \} : \{\}\)/);
    expect(JOBS, "the alias line is still hidden on a date-sorted page that expanded")
      .not.toMatch(/!searchNewestFirst && data\?\.aliases/);
    expect(JOBS).toMatch(/\{data\?\.aliases && data\.aliases\.length > 0 &&/);
  });

  it("the branch publishes no count, because the count it has describes another set", () => {
    // search_jobs' total is its title-tier count — a different matcher, with
    // company and department weighted into title_tsv and a description tier of
    // its own. Printing it over these rows is the one-body-two-answers defect.
    const i = FN.indexOf("if (newestTextSort) try {");
    const branch = FN.slice(i, i + 4000);
    expect(branch).toMatch(/total: null,/);
    expect(branch).toMatch(/countUnavailable: true,/);
    // The shape the client's type declares non-optional. The salary exit
    // shipped without these and every pay-sorted search rendered "Something
    // went wrong" on production.
    for (const k of ["categories:", "failedSources:", "failedCount:", "refreshedAt:", "totalAllCompanies:", "companies:", "companiesCount:"]) {
      expect(branch, `the exit omits ${k} — an exit that drops a promised field crashes the page`).toContain(k);
    }
    // The industry rail's numbers ride the SAME gate as every other exit —
    // withheld under a narrowing, never printed board-wide beside a narrowed
    // page. A bare `categories: {}` would blank the rail for choosing a sort.
    expect(branch).toMatch(/categories: visibleCategories\([^)]*unfiltered, applied\.category\)/);
  });

  it("a date order applied to a relevance window says so on the response", () => {
    // The other regime. When newestTextSort declines a body or falls through,
    // the ranked exit serves search_jobs' top `seam` date-sorted in memory —
    // and must name the window rather than let the page claim the match set.
    const i = FN.indexOf("nextOffset: poolExhausted ? RING_WINDOW");
    expect(i, "the ranked exit has moved").toBeGreaterThan(-1);
    const exit = FN.slice(Math.max(0, i - 3000), i);
    expect(exit).toMatch(
      /\.\.\.\(newestFirst\s*\?\s*\{ sortScope: "relevanceWindow", sortScopeRows: ringMerged \? RING_WINDOW : RANKED_WINDOW \}/,
    );
  });

  // ── THE CLIENT HALF ───────────────────────────────────────────────────────

  it("the widener burst is held off a page the order ended", () => {
    // Not a claim, a cost — and one this repo has already paid: the rate budget
    // fed by 36 functions and enforced by 6 was exhausted by ordinary board
    // browsing, which took upload and checkout down with it. On a sortWindow
    // page the terminal card renders the order and its remedy, so the two
    // countOnly probes that would build filter-relaxation buttons have no
    // reader. Asserted on the source because the probe is an effect: a render
    // test can only see the buttons it would have produced, and those are
    // exactly what this page no longer shows.
    const g = /const endTarget = listExhausted[^;]*;/.exec(JOBS)?.[0] ?? "";
    expect(g, "endTarget has moved or been renamed").not.toBe("");
    expect(g, "the widener burst can fire on a page the ORDER ended, for buttons nothing renders")
      .toContain("!endOrderWindowed");
    // And the two must agree on what that state is, or the gate guards a
    // different page from the one the card renders.
    expect(JOBS).toMatch(/const endOrderWindowed = [^;]*data\.sortScope === "relevanceWindow"/);
    expect(JOBS).toMatch(/: endOrderWindowed \? "sortWindow"/);
  });

  it("the page prints the strong date claim only where the server proved it", () => {
    // Every render of a whole-match-set sentence must sit behind the server's
    // own word for it. Read comment-stripped: the docblocks in this area name
    // both keys and the field.
    for (const key of ["jobsPage.sortedNewestWholeSet", "jobsPage.orderNewestWholeSet"]) {
      const at = JOBS.indexOf(key);
      expect(at, `${key} is not rendered anywhere`).toBeGreaterThan(-1);
      const before = JOBS.slice(Math.max(0, at - 400), at);
      expect(before, `${key} is printed without checking sortScope === "matchSet"`)
        .toContain('data?.sortScope === "matchSet"');
    }
    // The retired unqualified claim must be gone from the page AND from every
    // locale file — a locale value overrides an inline default, so deleting the
    // English default alone leaves nine translated copies rendering.
    expect(JOBS_RAW.includes('jobsPage.sortedNewest"'), "the unqualified date claim is back").toBe(false);
    for (const l of LOCALES) {
      const jp = (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8")) as {
        jobsPage?: Record<string, unknown>;
      }).jobsPage ?? {};
      expect(jp.sortedNewest, `${l}: the retired unqualified claim is still translated`).toBeUndefined();
      for (const k of [
        "sortedNewestWholeSet", "sortedNewestWindow", "orderNewestWholeSet", "orderNewestWindow",
        "endSortWindowTitle", "endSortWindowBody", "endSortWindowCta",
      ]) {
        expect(typeof jp[k], `${l}: jobsPage.${k} is missing`).toBe("string");
        expect(String(jp[k]).length, `${l}: jobsPage.${k} is empty`).toBeGreaterThan(10);
      }
      // The two order claims must differ, or one of the two states is lying.
      expect(jp.sortedNewestWholeSet, `${l}: both date-order sentences are the same`)
        .not.toBe(jp.sortedNewestWindow);
      // The window sentences must carry the placeholders the page interpolates,
      // or a translator drops the number and the claim loses its bound.
      expect(String(jp.sortedNewestWindow), `${l}: sortedNewestWindow lost {{n}}`).toContain("{{n}}");
      expect(String(jp.endSortWindowBody), `${l}: endSortWindowBody lost {{n}}`).toContain("{{n}}");
      // …and must NOT carry a server count: every figure on the terminal card
      // is on the shownCount basis, while `total` counts ungrouped rows and
      // disagrees with the page (a-list-that-ended-in-nothing's SERVER_COUNTS
      // rule, which this body was failing until it dropped its {{total}}).
      expect(String(jp.endSortWindowBody), `${l}: endSortWindowBody quotes a server total`).not.toContain("{{total}}");
    }
  });

  // ── BEHAVIOUR: THE SENTENCES THAT ACTUALLY RENDER ─────────────────────────

  it("behaviour: a windowed date order does not claim to be the newest of every match", async () => {
    mount("/jobs?q=nurse&sort=newest", WINDOW_BODY);
    await waitFor(() => expect(text()).toContain("Nurse A - Registered Nurse General Duty Nurse"), SLOW);
    // THE POSITIVE FIRST: the honest sentence is on screen, with its bound.
    expect(text(), "the window sentence is missing").toContain("Newest first within the closest 200 matches");
    expect(text()).toContain("not the newest of every match");
    // …and the unqualified claim is nowhere, in either place that used to make it.
    expect(text(), "the page still claims a plain date order").not.toContain("Sorted by newest first");
    expect(text(), "the hint beside the sort still claims relevance under a date sort")
      .not.toContain("ordered by relevance to your search");
  });

  it("behaviour: the end of a windowed order blames the order, not the search term", async () => {
    mount("/jobs?q=nurse&sort=newest", WINDOW_BODY);
    await waitFor(() => expect(text()).toContain("Registered Nurse"), SLOW);
    await waitFor(() => expect(text()).toContain("End of what"), SLOW);
    // The cause, named, with the two figures it is about.
    expect(text()).toContain("End of what “newest first” can reach — 3 openings shown");
    expect(text()).toContain("the closest 200 matches in date order");
    expect(text()).toContain("rather than at the end of everything that matches");
    // The remedy that works is offered…
    expect(screen.getAllByRole("button", { name: "Sort by relevance instead" }).length).toBeGreaterThan(0);
    // …and the one that does not is gone. This page held exactly one "filter" —
    // the query — so the old card said "That's a narrow set of filters" and
    // offered to delete a term matching over ten thousand postings.
    //
    // Asserted on the CARD, not on the document: `totalAllCompanies` is the
    // board-wide figure the hero prints on every page, and a document-wide
    // "not.toContain" would have been measuring the hero rather than the card —
    // a test that passes or fails for a reason that has nothing to do with the
    // property. The card is the ancestor that holds both the title and the
    // remedy button.
    const card = screen.getByText(/End of what/).closest("div");
    expect(card, "the terminal card has no container").not.toBeNull();
    const cardText = card?.textContent ?? "";
    expect(cardText).toContain("Sort by relevance instead");
    expect(cardText, "the card still blames the filters").not.toContain("That's a narrow set of filters");
    expect(cardText, "the card still offers to delete the search term").not.toContain("Remove “nurse”");
    expect(cardText, "a widener count reached the card").not.toContain("748,074");
    // No server count on this card at all — same rule, from the other side: the
    // match total belongs in the results summary, on its own basis.
    expect(cardText, "the card quotes the server's match count").not.toContain("10,000");
  });

  it("behaviour: an order the database applied to the whole set may say so", async () => {
    mount("/jobs?q=nurse&sort=newest", MATCH_SET_BODY);
    await waitFor(() => expect(text()).toContain("Registered Nurse 0"), SLOW);
    expect(text()).toContain("Sorted by newest first — every posting whose title matches");
    expect(text(), "the window sentence is printed over a whole-set order")
      .not.toContain("Newest first within the closest");
    // The headline and the rows now coexist in one sentence: no count is
    // published for this set, so none is printed — where the same control used
    // to put three cards under "of 10,000+".
    expect(text()).toContain("Showing 60 matching openings");
    expect(text()).not.toContain("10,000+");
  });

  it("behaviour: a server that says nothing states NO bound — the 200 was never measured", async () => {
    /* THIS CASE USED TO CODIFY THE DEFECT. It deleted sortScope/sortScopeRows
     * from the fixture and then asserted the page printed "Newest first within
     * the closest 200 matches" — so the guard REQUIRED a figure no response had
     * sent. 200 is not even the right order of magnitude for the exits that were
     * silent: the routed employer exit's window is ROUTE_WINDOW = 400 and its
     * blocks slide with the offset (MEASURED live 2026-09-26: q="accenture"
     * + sort=newest still served 5 rows with hasMore true at offsets 195, 250,
     * 380, 400 and 420).
     *
     * The >4.5MB deploy that serves the previous bundle is this project's
     * documented way to reach this state, so the page must degrade to a TRUE
     * sentence — and a sentence with no number in it is the only true one when
     * the reply measured none. */
    const { sortScope, sortScopeRows, ...silent } = WINDOW_BODY;
    expect(sortScope).toBe("relevanceWindow");
    expect(sortScopeRows).toBe(200);
    mount("/jobs?q=nurse&sort=newest", silent);
    await waitFor(() => expect(text()).toContain("Registered Nurse"), SLOW);
    expect(text(), "an absent disclosure let the strong whole-set claim through").not.toContain("Sorted by newest first");
    // THE POINT OF THE CASE: no fabricated bound, by any spelling.
    expect(text(), "a bound the response never sent reached the screen").not.toContain("within the closest");
    expect(text(), "the old hardcoded 200 is back").not.toMatch(/closest 200|closest 400/);
    // This reply still says `ranked`, so the honest sentence is the relevance one.
    expect(text()).toContain("Sorted by relevance");
  });

  it("behaviour: a window that does not state its size gets a sentence with no size in it", async () => {
    /* THE EXACT STATE THE `?? 200` LIVED IN, and the one my first two cases
     * missed. Both of them delete `sortScope` as well, which sends the page down a
     * different arm entirely — so restoring
     * `t("…sortedNewestWindow", { n: (data?.sortScopeRows ?? 200) })` left them
     * green. The fabrication is only reachable when the reply DOES say it ordered a
     * relevance window and does NOT say how big it was, which is a real shape: two
     * exits published the scope before they published the bound, and a stale bundle
     * can produce it at any time.
     *
     * So: sortScope present, sortScopeRows absent. The sentence must still name the
     * window — that part is measured — and must state no number, because none was.
     */
    const { sortScopeRows, ...noBound } = WINDOW_BODY;
    expect(sortScopeRows, "the fixture must really carry a bound for this case to remove").toBe(200);
    expect(noBound.sortScope, "the scope must stay, or this is the other case").toBe("relevanceWindow");
    mount("/jobs?q=nurse&sort=newest", noBound);
    await waitFor(() => expect(text()).toContain("Registered Nurse"), SLOW);
    // The window is still disclosed…
    expect(text()).toContain("Newest first among the closest matches this order could reach");
    expect(text()).toContain("not the newest of every match");
    // …with no bound, by any spelling. `?? 200` is what this line exists to catch.
    expect(text(), "a bound the reply never measured was printed").not.toContain("within the closest");
    expect(text(), "the hardcoded fallback is back").not.toMatch(/closest [\d,]+ matches/);
    // NOT a bare "200" check: the salary-ceiling options put "200k+ stated" in the
    // filter bar on every page, so that assertion fails on copy it is not about.
    // The bound only ever reaches a reader inside this sentence, so that is where
    // it is asserted absent (feedback_measure_like_with_like).
    expect(text(), "the retired default reached the order sentence").not.toMatch(/closest 200/);
  });

  it("behaviour: the terminal card obeys the same rule as the sentence above it", async () => {
    /* THE SECOND `?? 200`. The end-of-list card quoted the same invented bound in
     * its own sentence, so removing the fallback in one place and not the other
     * would have left the figure on screen one card lower. Reached by exhausting
     * the walk: hasMore false with a windowed order and a query. */
    const { sortScopeRows, ...noBound } = WINDOW_BODY;
    mount("/jobs?q=nurse&sort=newest", { ...noBound, hasMore: false });
    await waitFor(() => expect(text()).toContain("Registered Nurse"), SLOW);
    expect(text()).toContain("The board could only put the closest matches it could reach in date order");
    expect(text(), "the card invented a bound").not.toMatch(/closest [\d,]+ matches/);
    // And with a bound present it must print THAT number, not a default — the
    // mirror case, so deleting the numbered arm outright cannot pass.
    invoke.mockReset();
    document.body.innerHTML = "";
    mount("/jobs?q=nurse&sort=newest", { ...WINDOW_BODY, sortScopeRows: 137, hasMore: false });
    await waitFor(() => expect(text()).toContain("Registered Nurse"), SLOW);
    expect(text()).toContain("closest 137 matches");
    expect(text(), "the server said 137 and the page said 200").not.toContain("closest 200");
  });

  it("behaviour: the employer route with nothing on the wire prints no figure at all", async () => {
    /* THE EXACT LIVE SHAPE, and the one the reviewers measured: 2026-09-26,
     * {"action":"list","limit":20,"q":"Accenture","sort":"newest"} returned
     * searchRoute "EMPLOYER", reason "whole query matches employer Accenture",
     * sortScope undefined, ranked undefined, total null, totalAtLeast 400,
     * hasMore true. The page then printed "Newest first within the closest 200
     * matches this order can reach" directly under "Showing 20 of 400+ matching
     * openings" — two numbers from one response, one of them invented.
     *
     * The serving exit now date-orders and publishes sortScope; this case is the
     * floor under that fix, because a stale bundle or a future exit can be silent
     * again. Nothing may put a bound on screen that the reply did not carry, and
     * the sentence that does print must name WHOSE date the rows are in. */
    const employerSilent = {
      jobs: [
        row(1, "Accenture", "Procure to Pay Operations Associate", null),
        row(2, "Accenture", "Packaged App Development Associate", "2026-09-25T00:00:00+00:00"),
      ],
      total: null, totalAtLeast: 400, countCapped: false, hasMore: true, nextOffset: 20,
      searchRoute: "EMPLOYER", searchRouteReason: "whole query matches employer Accenture",
      companyMatched: "Accenture",
      totalAllCompanies: 748074, companies: [], companiesCount: 0, categories: {},
      failedSources: [], failedCount: 0, refreshedAt: null,
    };
    mount("/jobs?q=Accenture&sort=newest", employerSilent);
    await waitFor(() => expect(text()).toContain("Procure to Pay"), SLOW);
    expect(text(), "the invented bound is back").not.toContain("within the closest");
    expect(text(), "a hardcoded window size reached the screen").not.toMatch(/closest 200|closest 400/);
    expect(text(), "the windowed order claim printed over an unwindowed exit")
      .not.toContain("newest of the closest matches only");
    expect(text(), "a whole-set date claim over a reply that never said it ordered by date")
      .not.toContain("Sorted by newest first");
    // What it MUST say instead: our stamp, named as ours, and the employer named.
    expect(text()).toContain("Ordered by when we first saw each posting");
    expect(text()).toContain("every one of them is Accenture");
  });
});
